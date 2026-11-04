import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler, HttpError, int, num, str, slugify, esc } from '../utils/http.js';
import { changeStatus, getOrderDetail, markOrderPaid } from '../services/orderService.js';
import { sendMail, sendStatusUpdate } from '../services/emailService.js';
import { unsubscribeToken } from './support.js';

const router = Router();
router.use(requireAdmin);

const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'uploads', 'products');
fs.mkdirSync(uploadDir, { recursive: true });

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    // The extension comes from the verified mime type, never from the user's file name.
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${EXT[file.mimetype]}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new HttpError(400, 'Only JPG, PNG or WebP images are allowed'))),
});

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stops spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/* ---------------------------- Dashboard ---------------------------- */

router.get('/stats', asyncHandler(async (_req, res) => {
  const [[sales]] = await pool.query("SELECT COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders FROM orders WHERE payment_status = 'paid'");
  const [[customers]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'customer'");
  const [[products]] = await pool.query('SELECT COUNT(*) AS n, COALESCE(SUM(stock <= ?), 0) AS low FROM products WHERE is_active = 1', [env.lowStockThreshold]);
  const [byStatus] = await pool.query('SELECT status, COUNT(*) AS n FROM orders GROUP BY status');
  const [recent] = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.total, o.created_at, u.name AS customer_name
       FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.id DESC LIMIT 8`
  );
  res.json({ revenue: sales.revenue, paidOrders: sales.orders, customers: customers.n, products: products.n, lowStock: products.low, lowStockThreshold: env.lowStockThreshold, byStatus, recent });
}));

router.get('/reports/sales', asyncHandler(async (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : new Date().toISOString().slice(0, 10);
  const from = isDate(req.query.from) ? req.query.from : new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  const range = "o.payment_status = 'paid' AND o.created_at >= ? AND o.created_at < DATE_ADD(?, INTERVAL 1 DAY)";

  const [daily] = await pool.query(
    `SELECT DATE_FORMAT(o.created_at, '%Y-%m-%d') AS day, COUNT(*) AS orders, SUM(o.total) AS revenue
       FROM orders o WHERE ${range} GROUP BY day ORDER BY day`, [from, to]);
  const [top] = await pool.query(
    `SELECT oi.product_id, oi.name, SUM(oi.quantity) AS units, SUM(oi.price * oi.quantity) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${range}
      GROUP BY oi.product_id, oi.name ORDER BY revenue DESC LIMIT 10`, [from, to]);

  if (req.query.format === 'csv') {
    const lines = [['Date', 'Orders', `Revenue (${env.currency})`], ...daily.map((d) => [d.day, d.orders, d.revenue.toFixed(2)]), [], ['Top products'], ['Product', 'Units', 'Revenue'], ...top.map((t) => [t.name, t.units, Number(t.revenue).toFixed(2)])];
    res.type('text/csv').attachment(`sales-${from}-to-${to}.csv`).send(lines.map((l) => l.map(csvCell).join(',')).join('\n'));
    return;
  }
  res.json({ from, to, daily, top, totals: { orders: daily.reduce((s, d) => s + d.orders, 0), revenue: daily.reduce((s, d) => s + Number(d.revenue), 0) } });
}));

/* ---------------------------- Products & inventory ---------------------------- */

function parseProduct(b) {
  const image = str(b.image, 'Image path', { max: 255, optional: true });
  if (image && !/^[\w\-./]+$/.test(image)) throw new HttpError(400, 'Image path contains invalid characters');
  if (image && image.includes('..')) throw new HttpError(400, 'Image path is not allowed');
  return {
    fields: {
      name: str(b.name, 'Name'),
      description: str(b.description, 'Description', { max: 5000, optional: true }),
      brand: str(b.brand, 'Brand', { max: 100, optional: true }),
      keywords: str(b.keywords, 'Keywords', { max: 500, optional: true }),
      category_id: int(b.category_id, 'Category', { min: 1, optional: true }),
      price: num(b.price, 'Price', { min: 0, max: 99999999 }),
      previous_price: num(b.previous_price, 'Previous price', { min: 0, max: 99999999, optional: true }),
      stock: int(b.stock, 'Stock', { min: 0, max: 1000000 }),
      is_active: ['0', 'false', false, 0].includes(b.is_active) ? 0 : 1,
    },
    image,
  };
}

router.get('/products', asyncHandler(async (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (req.query.q) {
    where.push('(p.name LIKE ? OR p.brand LIKE ?)');
    const like = `%${String(req.query.q).replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like);
  }
  if (req.query.low === '1') { where.push('p.stock <= ?'); params.push(env.lowStockThreshold); }
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 200`, params);
  res.json({ products: rows, lowStockThreshold: env.lowStockThreshold });
}));

router.post('/products', upload.single('image'), asyncHandler(async (req, res) => {
  const { fields, image } = parseProduct(req.body);
  fields.image = req.file ? `uploads/products/${req.file.filename}` : image;
  const [r] = await pool.query('INSERT INTO products SET ?', [fields]);
  res.status(201).json({ id: r.insertId });
}));

router.put('/products/:id', upload.single('image'), asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const { fields, image } = parseProduct(req.body);
  if (req.file) fields.image = `uploads/products/${req.file.filename}`;
  else if (image) fields.image = image;
  const [r] = await pool.query('UPDATE products SET ? WHERE id = ?', [fields, id]);
  if (!r.affectedRows) throw new HttpError(404, 'Product not found');
  res.json({ ok: true });
}));

// Products that appear in past orders cannot be deleted, so "delete" archives them (hidden from the shop).
router.delete('/products/:id', asyncHandler(async (req, res) => {
  await pool.query('UPDATE products SET is_active = 0 WHERE id = ?', [int(req.params.id, 'id', { min: 1 })]);
  res.json({ ok: true });
}));

/* ---------------------------- Categories ---------------------------- */

router.post('/categories', asyncHandler(async (req, res) => {
  const name = str(req.body.name, 'Name', { max: 100 });
  const parent = int(req.body.parent_id, 'Parent', { min: 1, optional: true });
  await pool.query('INSERT INTO categories (parent_id, name, slug) VALUES (?, ?, ?)', [parent, name, slugify(name)]);
  res.status(201).json({ ok: true });
}));

router.put('/categories/:id', asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const parent = int(req.body.parent_id, 'Parent', { min: 1, optional: true });
  if (parent === id) throw new HttpError(400, 'A category cannot be its own parent');
  await pool.query('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?', [str(req.body.name, 'Name', { max: 100 }), parent, id]);
  res.json({ ok: true });
}));

router.delete('/categories/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id = ?', [int(req.params.id, 'id', { min: 1 })]);
  res.json({ ok: true });
}));

/* ---------------------------- Orders ---------------------------- */

const STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];

router.get('/orders', asyncHandler(async (req, res) => {
  const where = ['1 = 1'];
  const params = [];
  if (STATUSES.includes(req.query.status)) { where.push('o.status = ?'); params.push(req.query.status); }
  if (req.query.q) {
    const like = `%${String(req.query.q).replace(/[\\%_]/g, '\\$&')}%`;
    where.push('(o.order_number LIKE ? OR u.email LIKE ? OR u.name LIKE ?)');
    params.push(like, like, like);
  }
  const [rows] = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_method, o.total, o.created_at, u.name AS customer_name, u.email AS customer_email
       FROM orders o JOIN users u ON u.id = o.user_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT 100`, params);
  res.json({ orders: rows });
}));

router.get('/orders/:id', asyncHandler(async (req, res) => {
  const order = await getOrderDetail(int(req.params.id, 'id', { min: 1 }));
  if (!order) throw new HttpError(404, 'Order not found');
  res.json({ order });
}));

router.put('/orders/:id/status', asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const status = String(req.body.status || '');
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');
  const note = str(req.body.note, 'Note', { max: 255, optional: true });
  const trackingNumber = str(req.body.trackingNumber, 'Tracking number', { max: 80, optional: true });
  await changeStatus(id, status, note, { trackingNumber });
  const order = await getOrderDetail(id);
  sendStatusUpdate(order);
  res.json({ order });
}));

router.post('/orders/:id/mark-paid', asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  await markOrderPaid(id, 'Payment confirmed by admin');
  res.json({ order: await getOrderDetail(id) });
}));

/* ---------------------------- Customers ---------------------------- */

router.get('/customers', asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.q) {
    const like = `%${String(req.query.q).replace(/[\\%_]/g, '\\$&')}%`;
    where = 'WHERE u.name LIKE ? OR u.email LIKE ?';
    params.push(like, like);
  }
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at, COUNT(o.id) AS orders,
            COALESCE(SUM(CASE WHEN o.payment_status = 'paid' THEN o.total END), 0) AS spent
       FROM users u LEFT JOIN orders o ON o.user_id = u.id ${where} GROUP BY u.id ORDER BY u.id DESC LIMIT 200`, params);
  res.json({ customers: rows });
}));

/* ---------------------------- Coupons ---------------------------- */

function parseCoupon(b) {
  const code = str(b.code, 'Code', { min: 3, max: 40 }).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) throw new HttpError(400, 'Code may only contain letters, numbers, - and _');
  const type = b.type === 'fixed' ? 'fixed' : 'percent';
  const value = num(b.value, 'Value', { min: 0.01, max: type === 'percent' ? 100 : 99999999 });
  const expires = str(b.expires_at, 'Expiry', { max: 10, optional: true });
  if (expires && !isDate(expires)) throw new HttpError(400, 'Expiry must be a date (YYYY-MM-DD)');
  return {
    code, type, value,
    min_order: num(b.min_order, 'Minimum order', { min: 0, optional: true }) ?? 0,
    max_uses: int(b.max_uses, 'Max uses', { min: 1, optional: true }),
    expires_at: expires,
    is_active: ['0', 'false', false, 0].includes(b.is_active) ? 0 : 1,
  };
}

router.get('/coupons', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query("SELECT id, code, type, value, min_order, max_uses, used_count, DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires_at, is_active FROM coupons ORDER BY id DESC");
  res.json({ coupons: rows });
}));
router.post('/coupons', asyncHandler(async (req, res) => {
  await pool.query('INSERT INTO coupons SET ?', [parseCoupon(req.body)]);
  res.status(201).json({ ok: true });
}));
router.put('/coupons/:id', asyncHandler(async (req, res) => {
  await pool.query('UPDATE coupons SET ? WHERE id = ?', [parseCoupon(req.body), int(req.params.id, 'id', { min: 1 })]);
  res.json({ ok: true });
}));
router.delete('/coupons/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM coupons WHERE id = ?', [int(req.params.id, 'id', { min: 1 })]);
  res.json({ ok: true });
}));

/* ---------------------------- Support & newsletter ---------------------------- */

router.get('/support', asyncHandler(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM support_tickets ORDER BY status = \'open\' DESC, id DESC LIMIT 200');
  res.json({ tickets: rows });
}));
router.put('/support/:id', asyncHandler(async (req, res) => {
  await pool.query('UPDATE support_tickets SET status = ? WHERE id = ?', [req.body.status === 'closed' ? 'closed' : 'open', int(req.params.id, 'id', { min: 1 })]);
  res.json({ ok: true });
}));

router.get('/newsletter', asyncHandler(async (_req, res) => {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM newsletter_subscribers');
  res.json({ subscribers: n });
}));
router.post('/newsletter/send', asyncHandler(async (req, res) => {
  const subject = str(req.body.subject, 'Subject', { max: 150 });
  const body = str(req.body.body, 'Message', { max: 10000 });
  const [subs] = await pool.query('SELECT email FROM newsletter_subscribers');
  let sent = 0;
  for (const { email } of subs) {
    const unsub = `${env.appUrl}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubscribeToken(email)}`;
    const ok = await sendMail({ to: email, subject, html: `<div>${esc(body).replace(/\n/g, '<br>')}</div><hr><p style="font-size:12px"><a href="${unsub}">Unsubscribe</a></p>` });
    if (ok) sent++;
  }
  res.json({ recipients: subs.length, sent, note: env.smtp.host ? null : 'SMTP is not configured, so emails were only logged to the console.' });
}));

export default router;
