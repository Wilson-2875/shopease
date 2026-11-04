import { Router } from 'express';
import { pool, query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError, int } from '../utils/http.js';
import { validateAddress } from '../utils/address.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ addresses: await query('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [req.user.id]) });
}));

async function save(req, id = null) {
  const a = validateAddress(req.body);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?', [req.user.id]);
  const makeDefault = !!req.body.isDefault || (id === null && n === 0);
  if (makeDefault) await pool.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [req.user.id]);
  const cols = [a.label, a.fullName, a.phone, a.line1, a.line2, a.city, a.region, a.postalCode, a.country];
  if (id === null) {
    await pool.query(
      'INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, region, postal_code, country, is_default) VALUES (?)',
      [[req.user.id, ...cols, makeDefault ? 1 : 0]]
    );
  } else {
    const [r] = await pool.query(
      `UPDATE addresses SET label = ?, full_name = ?, phone = ?, line1 = ?, line2 = ?, city = ?, region = ?, postal_code = ?, country = ?,
              is_default = IF(?, 1, is_default) WHERE id = ? AND user_id = ?`,
      [...cols, makeDefault ? 1 : 0, id, req.user.id]
    );
    if (!r.affectedRows) throw new HttpError(404, 'Address not found');
  }
}

router.post('/', asyncHandler(async (req, res) => {
  await save(req);
  res.status(201).json({ ok: true });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  await save(req, int(req.params.id, 'id', { min: 1 }));
  res.json({ ok: true });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM addresses WHERE id = ? AND user_id = ?', [int(req.params.id, 'id', { min: 1 }), req.user.id]);
  res.json({ ok: true });
}));

export default router;
