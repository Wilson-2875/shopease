import 'dotenv/config';

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: num(process.env.PORT, 3000),
  appUrl: (process.env.APP_URL || `http://localhost:${num(process.env.PORT, 3000)}`).replace(/\/+$/, ''),
  trustProxy: process.env.TRUST_PROXY === '1',
  storeName: process.env.STORE_NAME || 'ShopEase',
  currency: (process.env.CURRENCY || 'KES').toUpperCase(),
  defaultCountry: process.env.DEFAULT_COUNTRY || '',
  lowStockThreshold: num(process.env.LOW_STOCK_THRESHOLD, 5),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'shopease',
  },

  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  paymentMode: process.env.PAYMENT_MODE === 'live' ? 'live' : 'simulator',
  paymentMethods: (process.env.PAYMENT_METHODS || 'card,mpesa,paypal,bank_transfer')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ['card', 'mpesa', 'paypal', 'bank_transfer'].includes(s)),
  bankDetails: process.env.BANK_DETAILS || '',

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  mpesa: {
    env: process.env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
    consumerKey: process.env.MPESA_CONSUMER_KEY || '',
    consumerSecret: process.env.MPESA_CONSUMER_SECRET || '',
    shortcode: process.env.MPESA_SHORTCODE || '',
    passkey: process.env.MPESA_PASSKEY || '',
  },
  paypal: {
    env: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    secret: process.env.PAYPAL_SECRET || '',
    currency: (process.env.PAYPAL_CURRENCY || 'USD').toUpperCase(),
    rate: num(process.env.PAYPAL_RATE, 1) || 1,
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  mailFrom: process.env.MAIL_FROM || 'ShopEase <no-reply@localhost>',
  supportEmail: process.env.SUPPORT_EMAIL || '',
  supportPhone: process.env.SUPPORT_PHONE || '',
    whatsappNumber: (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),
};

if (!env.jwtSecret || env.jwtSecret.startsWith('change-me')) {
  if (env.isProd) {
    throw new Error('JWT_SECRET must be set to a long random value in production.');
  }
  console.warn('[warn] JWT_SECRET is not set. Using an insecure development secret.');
  env.jwtSecret = 'insecure-development-secret';
}
