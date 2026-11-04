import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError, int, str } from '../utils/http.js';

const router = Router();

router.get('/product/:id', asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const [reviews] = await pool.query(
    `SELECT r.id, r.rating, r.title, r.comment, r.created_at, SUBSTRING_INDEX(u.name, ' ', 1) AS author,
            EXISTS(SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
                    WHERE o.user_id = r.user_id AND oi.product_id = r.product_id AND o.status <> 'cancelled') AS verified
       FROM reviews r JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 50`,
    [id]
  );
  const [spread] = await pool.query('SELECT rating, COUNT(*) AS n FROM reviews WHERE product_id = ? GROUP BY rating', [id]);
  res.json({ reviews: reviews.map((r) => ({ ...r, verified: !!r.verified })), spread });
}));

// One review per customer per product; posting again edits it.
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const productId = int(req.body.productId, 'productId', { min: 1 });
  const rating = int(req.body.rating, 'Rating', { min: 1, max: 5 });
  const title = str(req.body.title, 'Title', { max: 100, optional: true });
  const comment = str(req.body.comment, 'Review', { max: 2000, optional: true });

  const [p] = await pool.query('SELECT id FROM products WHERE id = ?', [productId]);
  if (!p[0]) throw new HttpError(404, 'Product not found');

  await pool.query(
    `INSERT INTO reviews (product_id, user_id, rating, title, comment) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = ?, title = ?, comment = ?`,
    [productId, req.user.id, rating, title, comment, rating, title, comment]
  );
  await pool.query(
    `UPDATE products SET rating_avg = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE product_id = ?),
                         rating_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ?) WHERE id = ?`,
    [productId, productId, productId]
  );
  res.status(201).json({ ok: true });
}));

export default router;
