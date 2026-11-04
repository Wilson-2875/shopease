import { Router } from 'express';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { pool } from '../config/db.js';
import { env } from '../config/env.js';
import { asyncHandler, HttpError, email, esc, str } from '../utils/http.js';
import { sendMail } from '../services/emailService.js';

const router = Router();
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many messages. Please try again later.' } });

router.post('/support', limiter, asyncHandler(async (req, res) => {
  const name = str(req.body.name, 'Name', { max: 100 });
  const mail = email(req.body.email);
  const subject = str(req.body.subject, 'Subject', { max: 150 });
  const message = str(req.body.message, 'Message', { min: 10, max: 5000 });
  await pool.query('INSERT INTO support_tickets (user_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)', [req.user?.id || null, name, mail, subject, message]);
  if (env.supportEmail) {
    sendMail({ to: env.supportEmail, subject: `[Support] ${subject}`, html: `<p><strong>${esc(name)}</strong> (${esc(mail)})</p><p>${esc(message).replace(/\n/g, '<br>')}</p>` });
  }
  res.status(201).json({ ok: true });
}));

/* ---------------- Newsletter ---------------- */

export const unsubscribeToken = (mail) => crypto.createHmac('sha256', env.jwtSecret).update(mail).digest('hex').slice(0, 32);

router.post('/newsletter', limiter, asyncHandler(async (req, res) => {
  await pool.query('INSERT IGNORE INTO newsletter_subscribers (email) VALUES (?)', [email(req.body.email)]);
  res.status(201).json({ ok: true });
}));

router.get('/newsletter/unsubscribe', asyncHandler(async (req, res) => {
  const mail = String(req.query.email || '').toLowerCase();
  const given = Buffer.from(String(req.query.token || ''));
  const expected = Buffer.from(unsubscribeToken(mail));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(400, 'Invalid unsubscribe link');
  await pool.query('DELETE FROM newsletter_subscribers WHERE email = ?', [mail]);
  res.type('html').send(`<p style="font-family:sans-serif">You have been unsubscribed. <a href="/">Back to the shop</a></p>`);
}));

export default router;
