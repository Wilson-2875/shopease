import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { HttpError } from '../utils/http.js';

const COOKIE = 'token';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
  res.cookie(COOKIE, token, {
    httpOnly: true, // not readable by JavaScript, which limits the damage of XSS
    sameSite: 'lax', // blocks cross-site POSTs (CSRF)
    secure: env.isProd, // HTTPS only in production
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export const clearSession = (res) => res.clearCookie(COOKIE, { path: '/' });

/** Loads req.user from the cookie, if there is a valid one. Never fails the request. */
export async function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  let userId;
  try {
    userId = jwt.verify(token, env.jwtSecret).sub;
  } catch {
    return next(); // expired or tampered token: treat as signed out
  }
  try {
    const rows = await query('SELECT id, name, email, phone, role FROM users WHERE id = ?', [userId]);
    req.user = rows[0] || null;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in to continue'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Admin access required'));
  next();
}
