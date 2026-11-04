import { env } from '../config/env.js';

export const notFound = (_req, res) => res.status(404).json({ error: 'Not found' });

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON in request body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Image is too large (max 2 MB)' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That value already exists' });

  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 && env.isProd ? 'Something went wrong. Please try again.' : err.message,
  });
}
