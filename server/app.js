import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { attachUser } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.js';
import metaRoutes from './routes/meta.js';
import productRoutes from './routes/products.js';
import reviewRoutes from './routes/reviews.js';
import wishlistRoutes from './routes/wishlist.js';
import addressRoutes from './routes/addresses.js';
import orderRoutes from './routes/orders.js';
import paymentRoutes, { stripeWebhook } from './routes/payments.js';
import supportRoutes from './routes/support.js';
import adminRoutes from './routes/admin.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
fs.mkdirSync(path.join(publicDir, 'uploads', 'products'), { recursive: true });

const app = express();
app.disable('x-powered-by');
if (env.trustProxy) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'blob:'],
        // The default directive breaks plain-http localhost in some browsers, so only enable it in production.
        'upgrade-insecure-requests': env.isProd ? [] : null,
      },
    },
  })
);

// Stripe signs the raw body, so this route must come before express.json().
app.post('/api/payments/stripe/webhook', ...stripeWebhook);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Basic CSRF defence on top of SameSite cookies: browsers send Origin on cross-site writes.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Cross-origin request blocked' });
    } catch {
      return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
  }
  next();
});

app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Please slow down.' } }));
app.use('/api', attachUser);

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', metaRoutes);
app.use('/api', supportRoutes);
app.use('/api', notFound);

app.use(express.static(publicDir, { extensions: ['html'], maxAge: env.isProd ? '1d' : 0 }));
app.use((_req, res) => res.status(404).sendFile(path.join(publicDir, '404.html')));
app.use(errorHandler);

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(`\nCould not connect to MySQL (${env.db.host}:${env.db.port}, database "${env.db.database}").`);
  console.error(`Reason: ${err.message}`);
  console.error('Check DB_* values in .env, make sure MySQL is running, and run: npm run db:setup\n');
  process.exit(1);
}

app.listen(env.port, () => {
  console.log(`${env.storeName} running at ${env.appUrl}  (payments: ${env.paymentMode})`);
});
