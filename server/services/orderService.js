import crypto from 'node:crypto';
import { pool, withTransaction } from '../config/db.js';
import { HttpError, int, toCents, fromCents } from '../utils/http.js';
import { validateAddress } from '../utils/address.js';

const PAYMENT_METHODS = ['card', 'mpesa', 'paypal', 'bank_transfer'];

/** Validate the cart sent by the client and merge duplicate products. */
export function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Your cart is empty');
  if (items.length > 50) throw new HttpError(400, 'Too many different items in the cart');
  const merged = new Map();
  for (const raw of items) {
    const productId = int(raw?.productId, 'productId', { min: 1 });
    const quantity = int(raw?.quantity, 'quantity', { min: 1, max: 99 });
    merged.set(productId, Math.min(99, (merged.get(productId) || 0) + quantity));
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Calculates an order from the database. Prices ALWAYS come from the products table, never from the browser.
 * `db` is the pool or a transaction connection. With lock = true the product rows are locked (FOR UPDATE).
 */
export async function priceOrder(db, { items, couponCode, deliveryOptionId }, { lock = false } = {}) {
  const lines = normalizeItems(items);
  const [products] = await db.query(
    `SELECT id, name, price, image, stock, is_active FROM products WHERE id IN (?) ${lock ? 'FOR UPDATE' : ''}`,
    [lines.map((l) => l.productId)]
  );
  const byId = new Map(products.map((p) => [p.id, p]));

  let subtotal = 0;
  const priced = lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p || !p.is_active) throw new HttpError(409, 'An item in your cart is no longer available');
    if (p.stock < l.quantity) {
      throw new HttpError(409, p.stock > 0 ? `Only ${p.stock} left of "${p.name}"` : `"${p.name}" is out of stock`);
    }
    const lineCents = toCents(p.price) * l.quantity;
    subtotal += lineCents;
    return { productId: p.id, name: p.name, image: p.image, price: p.price, quantity: l.quantity, lineTotal: fromCents(lineCents) };
  });

  let discount = 0;
  let coupon = null;
  if (couponCode && String(couponCode).trim()) {
    const code = String(couponCode).trim().toUpperCase();
    const [rows] = await db.query(
      'SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at >= CURDATE())',
      [code]
    );
    const c = rows[0];
    if (!c) throw new HttpError(400, 'That coupon code is not valid');
    if (c.max_uses !== null && c.used_count >= c.max_uses) throw new HttpError(400, 'That coupon has been fully redeemed');
    if (subtotal < toCents(c.min_order)) {
      throw new HttpError(400, `This coupon needs an order of at least ${Number(c.min_order).toFixed(2)}`);
    }
    discount = c.type === 'percent' ? Math.round((subtotal * Number(c.value)) / 100) : Math.min(toCents(c.value), subtotal);
    coupon = { id: c.id, code: c.code };
  }

  let shipping = 0;
  let delivery = null;
  if (deliveryOptionId !== undefined && deliveryOptionId !== null && deliveryOptionId !== '') {
    const [d] = await db.query('SELECT id, name, days, price FROM delivery_options WHERE id = ?', [
      int(deliveryOptionId, 'deliveryOptionId', { min: 1 }),
    ]);
    if (!d[0]) throw new HttpError(400, 'Choose a valid delivery option');
    delivery = d[0];
    shipping = toCents(d[0].price);
  }

  return {
    lines: priced,
    subtotal: fromCents(subtotal),
    discount: fromCents(discount),
    shipping: fromCents(shipping),
    total: fromCents(subtotal - discount + shipping),
    coupon,
    delivery,
  };
}

async function resolveAddress(conn, userId, body) {
  if (body.addressId) {
    const [rows] = await conn.query('SELECT * FROM addresses WHERE id = ? AND user_id = ?', [
      int(body.addressId, 'addressId', { min: 1 }),
      userId,
    ]);
    const a = rows[0];
    if (!a) throw new HttpError(400, 'Choose a delivery address');
    return { fullName: a.full_name, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postal_code, country: a.country };
  }
  const a = validateAddress(body.address);
  if (body.saveAddress) {
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?', [userId]);
    await conn.query(
      'INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, region, postal_code, country, is_default) VALUES (?)',
      [[userId, a.label, a.fullName, a.phone, a.line1, a.line2, a.city, a.region, a.postalCode, a.country, n === 0 ? 1 : 0]]
    );
  }
  return a;
}

const makeOrderNumber = () => `ORD-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

/** Creates the order, its items and reserves stock - all in one transaction. */
export async function createOrder(user, body) {
  if (!PAYMENT_METHODS.includes(body.paymentMethod)) throw new HttpError(400, 'Choose a payment method');
  if (!body.deliveryOptionId) throw new HttpError(400, 'Choose a delivery option');

  return withTransaction(async (conn) => {
    const priced = await priceOrder(conn, body, { lock: true });
    const a = await resolveAddress(conn, user.id, body);

    const [res] = await conn.query(
      `INSERT INTO orders (order_number, user_id, payment_method, subtotal, discount, shipping, total, coupon_code,
         delivery_option_id, delivery_days, ship_name, ship_phone, ship_line1, ship_line2, ship_city, ship_region,
         ship_postal_code, ship_country) VALUES (?)`,
      [[makeOrderNumber(), user.id, body.paymentMethod, priced.subtotal, priced.discount, priced.shipping, priced.total,
        priced.coupon?.code || null, priced.delivery.id, priced.delivery.days, a.fullName, a.phone, a.line1, a.line2,
        a.city, a.region, a.postalCode, a.country]]
    );
    const orderId = res.insertId;

    await conn.query('INSERT INTO order_items (order_id, product_id, name, price, quantity, image) VALUES ?', [
      priced.lines.map((l) => [orderId, l.productId, l.name, l.price, l.quantity, l.image]),
    ]);

    for (const l of priced.lines) {
      const [r] = await conn.query('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [l.quantity, l.productId, l.quantity]);
      if (r.affectedRows !== 1) throw new HttpError(409, `"${l.name}" just sold out`);
    }
    if (priced.coupon) {
      const [r] = await conn.query(
        'UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)',
        [priced.coupon.id]
      );
      if (r.affectedRows !== 1) throw new HttpError(400, 'That coupon has just been fully redeemed');
    }
    await conn.query('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)', [orderId, 'pending', 'Order placed']);
    return loadBasic(conn, orderId);
  });
}

async function loadBasic(conn, orderId) {
  const [rows] = await conn.query('SELECT id, order_number, total, payment_method FROM orders WHERE id = ?', [orderId]);
  return rows[0];
}

/** Full order with items, history and payments. Pass userId to restrict to that customer's own orders. */
export async function getOrderDetail(orderId, userId = null) {
  const params = userId ? [orderId, userId] : [orderId];
  const [orders] = await pool.query(
    `SELECT o.*, u.name AS customer_name, u.email AS customer_email, d.name AS delivery_name
       FROM orders o JOIN users u ON u.id = o.user_id LEFT JOIN delivery_options d ON d.id = o.delivery_option_id
      WHERE o.id = ? ${userId ? 'AND o.user_id = ?' : ''}`,
    params
  );
  if (!orders[0]) return null;
  const [items] = await pool.query('SELECT product_id, name, price, quantity, image FROM order_items WHERE order_id = ?', [orderId]);
  const [history] = await pool.query('SELECT status, note, created_at FROM order_status_history WHERE order_id = ? ORDER BY id', [orderId]);
  const [payments] = await pool.query('SELECT method, provider_ref, amount, status, created_at FROM payments WHERE order_id = ? ORDER BY id', [orderId]);
  return { ...orders[0], items, history, payments };
}

/** Put the stock of every item in an order back on the shelf. */
async function restoreStock(conn, orderId) {
  await conn.query(
    'UPDATE products p JOIN order_items oi ON oi.product_id = p.id SET p.stock = p.stock + oi.quantity WHERE oi.order_id = ?',
    [orderId]
  );
}

/** Change an order's status (and optionally tracking number / payment status), recording it in the history. */
export async function changeStatus(orderId, status, note = null, { trackingNumber = null, paymentStatus = null } = {}) {
  return withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    const order = rows[0];
    if (!order) throw new HttpError(404, 'Order not found');
    if (order.status === 'cancelled') throw new HttpError(409, 'Cancelled orders cannot be changed');

    let newPaymentStatus = paymentStatus || order.payment_status;
    if (status === 'cancelled') {
      await restoreStock(conn, orderId);
      if (order.coupon_code) await conn.query('UPDATE coupons SET used_count = GREATEST(used_count - 1, 0) WHERE code = ?', [order.coupon_code]);
      if (order.payment_status === 'paid') newPaymentStatus = 'refunded';
    }
    await conn.query(
      'UPDATE orders SET status = ?, payment_status = ?, tracking_number = COALESCE(?, tracking_number) WHERE id = ?',
      [status, newPaymentStatus, trackingNumber, orderId]
    );
    if (order.status !== status || note) {
      await conn.query('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)', [orderId, status, note]);
    }
  });
}

/** Mark an order as paid. Safe to call twice (webhooks are often delivered more than once). */
export async function markOrderPaid(orderId, note = 'Payment received') {
  await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT status, payment_status FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    const o = rows[0];
    if (!o || o.payment_status === 'paid' || o.status === 'cancelled') return;
    await conn.query("UPDATE orders SET payment_status = 'paid', status = IF(status = 'pending', 'paid', status) WHERE id = ?", [orderId]);
    await conn.query("UPDATE payments SET status = 'succeeded' WHERE order_id = ? AND status = 'pending'", [orderId]);
    await conn.query('INSERT INTO order_status_history (order_id, status, note) VALUES (?, ?, ?)', [orderId, 'paid', note]);
  });
}
