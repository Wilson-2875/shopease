import { Router } from 'express';
import { pool, query } from '../config/db.js';
import { asyncHandler, HttpError, int, likeEscape } from '../utils/http.js';

const router = Router();

export const CARD_COLS = `p.id, p.name, p.brand, p.price, p.previous_price, p.image, p.stock, p.rating_avg, p.rating_count`;

export const withDiscount = (p) => ({
  ...p,
  discount_percent: p.previous_price && p.previous_price > p.price ? Math.round(((p.previous_price - p.price) / p.previous_price) * 100) : 0,
});

async function resolveCategory(value) {
  if (/^\d+$/.test(String(value))) return Number(value);
  const rows = await query('SELECT id FROM categories WHERE slug = ?', [String(value)]);
  return rows[0]?.id ?? null;
}

const SORTS = {
  newest: 'p.id DESC',
  price_asc: 'p.price ASC',
  price_desc: 'p.price DESC',
  rating: 'p.rating_avg DESC, p.rating_count DESC',
  discount: 'COALESCE((p.previous_price - p.price) / NULLIF(p.previous_price, 0), 0) DESC',
  featured: 'p.id ASC',
};

// GET /api/products?q=&category=&brand=&minPrice=&maxPrice=&minRating=&inStock=1&onSale=1&sort=&page=&limit=
router.get('/', asyncHandler(async (req, res) => {
  const where = ['p.is_active = 1'];
  const params = [];

  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push('(p.name LIKE ? OR p.description LIKE ? OR p.brand LIKE ? OR p.keywords LIKE ?)');
    params.push(like, like, like, like);
  }
  if (req.query.category) {
    const id = await resolveCategory(req.query.category);
    if (id) {
      where.push('p.category_id IN (SELECT id FROM categories WHERE id = ? OR parent_id = ?)');
      params.push(id, id);
    } else {
      where.push('1 = 0');
    }
  }
  if (req.query.brand) {
    const brands = String(req.query.brand).split(',').map((b) => b.trim()).filter(Boolean).slice(0, 20);
    if (brands.length) {
      where.push('p.brand IN (?)');
      params.push(brands);
    }
  }
  const minPrice = Number(req.query.minPrice);
  const maxPrice = Number(req.query.maxPrice);
  if (req.query.minPrice !== undefined && req.query.minPrice !== '' && Number.isFinite(minPrice)) { where.push('p.price >= ?'); params.push(minPrice); }
  if (req.query.maxPrice !== undefined && req.query.maxPrice !== '' && Number.isFinite(maxPrice)) { where.push('p.price <= ?'); params.push(maxPrice); }
  const minRating = Number(req.query.minRating);
  if (req.query.minRating && Number.isFinite(minRating)) { where.push('p.rating_avg >= ?'); params.push(minRating); }
  if (req.query.inStock === '1') where.push('p.stock > 0');
  if (req.query.onSale === '1') where.push('p.previous_price > p.price');

  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const orderBy = SORTS[req.query.sort] || SORTS.featured;
  const whereSql = where.join(' AND ');

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM products p WHERE ${whereSql}`, params);
  const [rows] = await pool.query(
    `SELECT ${CARD_COLS}, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]
  );
  res.json({ items: rows.map(withDiscount), total, page, pages: Math.max(1, Math.ceil(total / limit)) });
}));

// Brands and price range for the filter sidebar
router.get('/meta', asyncHandler(async (_req, res) => {
  const brands = await query('SELECT DISTINCT brand FROM products WHERE is_active = 1 AND brand IS NOT NULL ORDER BY brand');
  const [range] = await query('SELECT MIN(price) AS min, MAX(price) AS max FROM products WHERE is_active = 1');
  res.json({ brands: brands.map((b) => b.brand), minPrice: range?.min ?? 0, maxPrice: range?.max ?? 0 });
}));

// Personalised for signed-in customers (categories they bought from), top deals for everyone else
router.get('/recommended', asyncHandler(async (req, res) => {
  let rows = [];
  if (req.user) {
    rows = await query(
      `SELECT ${CARD_COLS} FROM products p
        WHERE p.is_active = 1 AND p.stock > 0
          AND p.category_id IN (SELECT DISTINCT p2.category_id FROM order_items oi JOIN orders o ON o.id = oi.order_id
                                 JOIN products p2 ON p2.id = oi.product_id WHERE o.user_id = ?)
          AND p.id NOT IN (SELECT oi.product_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ?)
        ORDER BY p.rating_avg DESC, p.rating_count DESC LIMIT 8`,
      [req.user.id, req.user.id]
    );
  }
  const personal = rows.length > 0;
  if (!personal) {
    rows = await query(
      `SELECT ${CARD_COLS} FROM products p WHERE p.is_active = 1 AND p.stock > 0 AND p.previous_price > p.price
        ORDER BY (p.previous_price - p.price) / p.previous_price DESC LIMIT 8`
    );
  }
  res.json({ personal, items: rows.map(withDiscount) });
}));

// Used by the cart page to show current prices and stock for what is in the browser's cart
router.get('/by-ids', asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
  if (!ids.length) return res.json({ items: [] });
  const rows = await query(`SELECT ${CARD_COLS} FROM products p WHERE p.is_active = 1 AND p.id IN (?)`, [ids]);
  res.json({ items: rows.map(withDiscount) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const rows = await query(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug FROM products p
       LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.is_active = 1`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, 'Product not found');
  res.json({ product: withDiscount(rows[0]) });
}));

router.get('/:id/related', asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const related = await query(
    `SELECT ${CARD_COLS} FROM products p
      WHERE p.is_active = 1 AND p.id <> ? AND p.category_id = (SELECT category_id FROM products WHERE id = ?)
      ORDER BY p.rating_count DESC, p.id LIMIT 4`,
    [id, id]
  );
  const alsoBought = await query(
    `SELECT ${CARD_COLS} FROM order_items a
       JOIN order_items b ON b.order_id = a.order_id AND b.product_id <> a.product_id
       JOIN products p ON p.id = b.product_id
      WHERE a.product_id = ? AND p.is_active = 1
      GROUP BY p.id ORDER BY COUNT(*) DESC LIMIT 4`,
    [id]
  );
  res.json({ related: related.map(withDiscount), alsoBought: alsoBought.map(withDiscount) });
}));

export default router;
