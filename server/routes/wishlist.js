import { Router } from 'express';
import { pool, query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, int } from '../utils/http.js';
import { CARD_COLS, withDiscount } from './products.js';

const router = Router();
router.use(requireAuth);

router.get('/ids', asyncHandler(async (req, res) => {
  const rows = await query('SELECT product_id FROM wishlist WHERE user_id = ?', [req.user.id]);
  res.json({ ids: rows.map((r) => r.product_id) });
}));

router.get('/', asyncHandler(async (req, res) => {
  const rows = await query(
    `SELECT ${CARD_COLS} FROM wishlist w JOIN products p ON p.id = w.product_id
      WHERE w.user_id = ? AND p.is_active = 1 ORDER BY w.created_at DESC`,
    [req.user.id]
  );
  res.json({ items: rows.map(withDiscount) });
}));

router.post('/:productId', asyncHandler(async (req, res) => {
  const id = int(req.params.productId, 'productId', { min: 1 });
  await pool.query('INSERT IGNORE INTO wishlist (user_id, product_id) SELECT ?, id FROM products WHERE id = ?', [req.user.id, id]);
  res.status(201).json({ ok: true });
}));

router.delete('/:productId', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM wishlist WHERE user_id = ? AND product_id = ?', [req.user.id, int(req.params.productId, 'productId', { min: 1 })]);
  res.json({ ok: true });
}));

export default router;
