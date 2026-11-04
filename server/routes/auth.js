import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from '../config/db.js';
import { issueSession, clearSession, requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError, str, email } from '../utils/http.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Used so that "unknown email" and "wrong password" take the same time to answer.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

function password(v) {
  const s = String(v ?? '');
  if (s.length < 8 || s.length > 100 || !/[A-Za-z]/.test(s) || !/\d/.test(s)) {
    throw new HttpError(400, 'Password must be at least 8 characters and include a letter and a number');
  }
  return s;
}

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const name = str(req.body.name, 'Name', { max: 100 });
  const mail = email(req.body.email);
  const pw = password(req.body.password);
  const phone = str(req.body.phone, 'Phone', { min: 7, max: 30, optional: true });

  const [exists] = await pool.query('SELECT id FROM users WHERE email = ?', [mail]);
  if (exists.length) throw new HttpError(409, 'An account with this email already exists');

  const hash = await bcrypt.hash(pw, 12);
  const [r] = await pool.query('INSERT INTO users (name, email, password_hash, phone) VALUES (?, ?, ?, ?)', [name, mail, hash, phone]);
  const user = { id: r.insertId, name, email: mail, phone, role: 'customer' };
  issueSession(res, user);
  res.status(201).json({ user });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const mail = email(req.body.email);
  const pw = String(req.body.password ?? '');
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [mail]);
  const u = rows[0];
  const ok = await bcrypt.compare(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) throw new HttpError(401, 'Incorrect email or password');
  const user = { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role };
  issueSession(res, user);
  res.json({ user });
}));

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => res.json({ user: req.user || null }));

router.put('/profile', requireAuth, asyncHandler(async (req, res) => {
  const name = str(req.body.name, 'Name', { max: 100 });
  const phone = str(req.body.phone, 'Phone', { min: 7, max: 30, optional: true });
  await pool.query('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone, req.user.id]);
  res.json({ user: { ...req.user, name, phone } });
}));

router.put('/password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(req.body.currentPassword ?? ''), rows[0].password_hash))) {
    throw new HttpError(400, 'Your current password is incorrect');
  }
  const hash = await bcrypt.hash(password(req.body.newPassword), 12);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
  res.json({ ok: true });
}));

export default router;
