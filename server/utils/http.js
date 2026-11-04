export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Express 4 does not catch rejected promises, so wrap async handlers. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const missing = (v) => v === undefined || v === null || String(v).trim() === '';

export function str(value, field, { min = 1, max = 255, optional = false } = {}) {
  if (missing(value)) {
    if (optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const s = String(value).trim();
  if (s.length < min || s.length > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max} characters`);
  }
  return s;
}

export function int(value, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (missing(value)) {
    if (optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a whole number${Number.isFinite(min) ? ` of at least ${min}` : ''}${Number.isFinite(max) ? ` (max ${max})` : ''}`);
  }
  return n;
}

export function num(value, field, { min = -Infinity, max = Infinity, optional = false } = {}) {
  if (missing(value)) {
    if (optional) return null;
    throw new HttpError(400, `${field} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be a number between ${min} and ${max}`);
  }
  return Math.round(n * 100) / 100;
}

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

export function email(value, field = 'Email') {
  const s = str(value, field, { max: 190 }).toLowerCase();
  if (!isEmail(s)) throw new HttpError(400, `${field} is not a valid email address`);
  return s;
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Escape % and _ so user input is matched literally inside LIKE. */
export const likeEscape = (s) => s.replace(/[\\%_]/g, '\\$&');

// Money is calculated in integer cents to avoid floating point errors.
export const toCents = (n) => Math.round(Number(n) * 100);
export const fromCents = (c) => c / 100;

export const slugify = (s) =>
  String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'item';
