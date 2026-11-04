import { Router } from 'express';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { asyncHandler } from '../utils/http.js';

const router = Router();

// Public settings the browser needs (never put secrets here).
router.get('/config', (_req, res) => {
  res.json({
    storeName: env.storeName,
    currency: env.currency,
    defaultCountry: env.defaultCountry,
    payments: env.paymentMethods,
    cardMode: env.paymentMode === 'live' ? 'redirect' : 'form',
    simulator: env.paymentMode !== 'live',
    bankDetails: env.bankDetails,
    supportEmail: env.supportEmail,
    supportPhone: env.supportPhone,
  });
});

router.get('/categories', asyncHandler(async (_req, res) => {
  const rows = await query('SELECT id, parent_id, name, slug FROM categories ORDER BY name');
  const ids = new Set(rows.map((r) => r.id));
  const roots = rows
    .filter((r) => !r.parent_id || !ids.has(r.parent_id))
    .map((r) => ({ ...r, children: rows.filter((c) => c.parent_id === r.id) }));
  res.json({ categories: roots });
}));

router.get('/delivery-options', asyncHandler(async (_req, res) => {
  res.json({ options: await query('SELECT id, name, days, price FROM delivery_options ORDER BY days DESC') });
}));

export default router;
