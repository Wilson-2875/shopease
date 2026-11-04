/**
 * Payment layer. Every method returns { status: 'paid' | 'pending' | 'failed', reference, redirectUrl, message, meta }.
 *
 *  PAYMENT_MODE=simulator  -> no real money moves; used for development and demos.
 *  PAYMENT_MODE=live       -> Stripe Checkout (card), M-Pesa STK Push, PayPal Orders v2. Needs the keys in .env.
 *
 * Card numbers are only ever inspected in memory by the simulator and are never logged or stored (only the last 4 digits).
 */
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { pool } from '../config/db.js';
import { HttpError, toCents } from '../utils/http.js';
import { markOrderPaid } from './orderService.js';

const live = () => env.paymentMode === 'live';
const failed = (message) => ({ status: 'failed', message });
const simRef = (prefix) => `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

export async function startPayment(order, method, details = {}) {
  const handlers = { card, mpesa, paypal, bank_transfer: bankTransfer };
  const handler = handlers[method];
  if (!handler || !env.paymentMethods.includes(method)) throw new HttpError(400, 'That payment method is not available');

  const result = await handler(order, details || {});
  const dbStatus = result.status === 'paid' ? 'pending' : result.status === 'failed' ? 'failed' : 'pending';
  await pool.query('INSERT INTO payments (order_id, method, provider_ref, amount, status, details) VALUES (?, ?, ?, ?, ?, ?)', [
    order.id, method, result.reference || null, order.total, dbStatus, JSON.stringify(result.meta || {}),
  ]);
  if (result.status === 'paid') await markOrderPaid(order.id, 'Payment received');
  return result;
}

/* ------------------------------ Card ------------------------------ */

function luhn(num) {
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = Number(num[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

async function card(order, d) {
  if (live()) return stripeCheckout(order);

  const number = String(d.cardNumber || '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(number) || !luhn(number)) return failed('That card number is not valid');
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(d.expiry || '').trim());
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return failed('Enter the expiry date as MM/YY');
  const endOfMonth = new Date(2000 + Number(m[2]), Number(m[1]), 1);
  if (endOfMonth <= new Date()) return failed('That card has expired');
  if (!/^\d{3,4}$/.test(String(d.cvc || ''))) return failed('Enter the 3 or 4 digit security code');
  if (number === '4000000000000002') return failed('Your card was declined (simulator test card)');

  return { status: 'paid', reference: simRef('SIM-CARD'), meta: { last4: number.slice(-4), simulated: true } };
}

async function stripeCheckout(order) {
  if (!env.stripe.secretKey) throw new HttpError(500, 'Card payments are not configured');
  const body = new URLSearchParams({
    mode: 'payment',
    success_url: `${env.appUrl}/order.html?id=${order.id}&paid=1`,
    cancel_url: `${env.appUrl}/order.html?id=${order.id}`,
    client_reference_id: String(order.id),
    'metadata[order_id]': String(order.id),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': env.currency.toLowerCase(),
    'line_items[0][price_data][unit_amount]': String(toCents(order.total)),
    'line_items[0][price_data][product_data][name]': `Order ${order.order_number}`,
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new HttpError(502, data?.error?.message || 'Card payment provider error');
  return { status: 'pending', reference: data.id, redirectUrl: data.url, message: 'Redirecting to secure card payment...' };
}

/** Verifies the Stripe-Signature header and returns the parsed event. */
export function verifyStripeEvent(raw, header) {
  if (!env.stripe.webhookSecret) throw new HttpError(500, 'Stripe webhook is not configured');
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) throw new HttpError(400, 'Missing signature');
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) throw new HttpError(400, 'Signature timestamp too old');
  const expected = crypto.createHmac('sha256', env.stripe.webhookSecret).update(`${parts.t}.${raw.toString('utf8')}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new HttpError(400, 'Invalid signature');
  return JSON.parse(raw.toString('utf8'));
}

/* ------------------------------ M-Pesa ------------------------------ */

export function normalizeKenyanPhone(p) {
  const digits = String(p || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}

const mpesaBase = () => (env.mpesa.env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke');

async function mpesaToken() {
  const auth = Buffer.from(`${env.mpesa.consumerKey}:${env.mpesa.consumerSecret}`).toString('base64');
  const res = await fetch(`${mpesaBase()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` } });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new HttpError(502, 'Could not reach M-Pesa. Please try again.');
  return data.access_token;
}

async function mpesa(order, d) {
  const phone = normalizeKenyanPhone(d.mpesaPhone);
  if (!phone) return failed('Enter a valid M-Pesa number, for example 0712345678');
  if (!live()) {
    return { status: 'paid', reference: simRef('SIM-MPESA'), meta: { phone: `${phone.slice(0, 5)}****${phone.slice(-2)}`, simulated: true } };
  }
  if (!env.mpesa.consumerKey || !env.mpesa.shortcode || !env.mpesa.passkey) throw new HttpError(500, 'M-Pesa is not configured');

  const token = await mpesaToken();
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14); // YYYYMMDDHHmmss
  const password = Buffer.from(`${env.mpesa.shortcode}${env.mpesa.passkey}${timestamp}`).toString('base64');
  const res = await fetch(`${mpesaBase()}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BusinessShortCode: env.mpesa.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(order.total),
      PartyA: phone,
      PartyB: env.mpesa.shortcode,
      PhoneNumber: phone,
      CallBackURL: `${env.appUrl}/api/payments/mpesa/callback`,
      AccountReference: order.order_number.slice(0, 12),
      TransactionDesc: `Order ${order.order_number}`.slice(0, 20),
    }),
  });
  const data = await res.json();
  if (data.ResponseCode === '0') {
    return { status: 'pending', reference: data.CheckoutRequestID, message: 'Check your phone and enter your M-Pesa PIN to pay.', meta: { merchantRequestId: data.MerchantRequestID } };
  }
  return failed(data.errorMessage || data.ResponseDescription || 'M-Pesa could not start the payment');
}

/* ------------------------------ PayPal ------------------------------ */

const paypalBase = () => (env.paypal.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

async function paypalToken() {
  const auth = Buffer.from(`${env.paypal.clientId}:${env.paypal.secret}`).toString('base64');
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new HttpError(502, 'Could not reach PayPal. Please try again.');
  return data.access_token;
}

async function paypal(order) {
  if (!live()) return { status: 'paid', reference: simRef('SIM-PAYPAL'), meta: { simulated: true } };
  if (!env.paypal.clientId || !env.paypal.secret) throw new HttpError(500, 'PayPal is not configured');

  const token = await paypalToken();
  const res = await fetch(`${paypalBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: order.order_number,
        amount: { currency_code: env.paypal.currency, value: (order.total / env.paypal.rate).toFixed(2) },
      }],
      application_context: {
        return_url: `${env.appUrl}/api/payments/paypal/return?orderId=${order.id}`,
        cancel_url: `${env.appUrl}/order.html?id=${order.id}`,
        user_action: 'PAY_NOW',
      },
    }),
  });
  const data = await res.json();
  const approve = data.links?.find((l) => l.rel === 'approve' || l.rel === 'payer-action');
  if (!res.ok || !approve) throw new HttpError(502, 'PayPal could not start the payment');
  return { status: 'pending', reference: data.id, redirectUrl: approve.href, message: 'Redirecting to PayPal...' };
}

/** Called when the customer returns from PayPal. Captures the money and marks the order paid. */
export async function capturePaypal(orderId, paypalOrderId) {
  const [rows] = await pool.query("SELECT id FROM payments WHERE order_id = ? AND provider_ref = ? AND method = 'paypal'", [orderId, paypalOrderId]);
  if (!rows[0]) throw new HttpError(400, 'Unknown PayPal payment');
  const token = await paypalToken();
  const res = await fetch(`${paypalBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (data.status === 'COMPLETED') await markOrderPaid(orderId, 'PayPal payment captured');
}

/* ------------------------------ Bank transfer ------------------------------ */

async function bankTransfer(order) {
  return {
    status: 'pending',
    reference: order.order_number,
    message: `Pay by bank transfer using the reference ${order.order_number}. We process your order as soon as the payment is confirmed.`,
    meta: {},
  };
}
