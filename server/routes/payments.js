// Webhooks and return URLs called by payment providers (not by our own front end).
import express, { Router } from 'express';
import { pool } from '../config/db.js';
import { asyncHandler, HttpError, int, toCents } from '../utils/http.js';
import { capturePaypal, verifyStripeEvent } from '../services/paymentService.js';
import { changeStatus, markOrderPaid } from '../services/orderService.js';

const router = Router();

// Stripe needs the raw request body to verify its signature, so app.js mounts this BEFORE express.json().
export const stripeWebhook = [
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const event = verifyStripeEvent(req.body, req.headers['stripe-signature']);
    const session = event.data?.object;
    if (event.type === 'checkout.session.completed' && session?.payment_status === 'paid') {
      const orderId = Number(session.metadata?.order_id);
      const [rows] = await pool.query('SELECT total FROM orders WHERE id = ?', [orderId]);
      if (rows[0] && toCents(rows[0].total) === session.amount_total) {
        await markOrderPaid(orderId, 'Card payment confirmed');
      } else {
        console.error(`Stripe amount mismatch for order ${orderId}`);
      }
    }
    res.json({ received: true });
  }),
];

// Safaricom calls this after the customer enters (or cancels) the M-Pesa PIN.
router.post('/mpesa/callback', asyncHandler(async (req, res) => {
  const cb = req.body?.Body?.stkCallback;
  if (cb?.CheckoutRequestID) {
    const [rows] = await pool.query(
      "SELECT p.id, p.order_id, o.total FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.provider_ref = ? AND p.method = 'mpesa'",
      [cb.CheckoutRequestID]
    );
    const payment = rows[0];
    if (payment) {
      if (cb.ResultCode === 0) {
        const paid = cb.CallbackMetadata?.Item?.find((i) => i.Name === 'Amount')?.Value;
        if (Number(paid) >= Math.ceil(payment.total)) await markOrderPaid(payment.order_id, 'M-Pesa payment confirmed');
        else console.error(`M-Pesa amount mismatch for order ${payment.order_id}`);
      } else {
        await pool.query("UPDATE payments SET status = 'failed' WHERE id = ?", [payment.id]);
        await changeStatus(payment.order_id, 'cancelled', `M-Pesa payment not completed: ${String(cb.ResultDesc || '').slice(0, 150)}`, { paymentStatus: 'failed' }).catch(() => {});
      }
    }
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}));

// The customer lands here after approving the payment on PayPal.
router.get('/paypal/return', asyncHandler(async (req, res) => {
  const orderId = int(req.query.orderId, 'orderId', { min: 1 });
  const token = String(req.query.token || '');
  if (!token) throw new HttpError(400, 'Missing PayPal token');
  await capturePaypal(orderId, token);
  res.redirect(`/order.html?id=${orderId}&paid=1`);
}));

export default router;
