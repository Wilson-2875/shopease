import { Router } from 'express';
import { pool } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError, int } from '../utils/http.js';
import { changeStatus, createOrder, getOrderDetail, priceOrder } from '../services/orderService.js';
import { startPayment } from '../services/paymentService.js';
import { sendOrderConfirmation } from '../services/emailService.js';

const router = Router();

// Price preview used by the checkout page. Public so the cart can show totals too.
router.post('/quote', asyncHandler(async (req, res) => {
  const { lines, subtotal, discount, shipping, total, coupon } = await priceOrder(pool, req.body);
  res.json({ lines, subtotal, discount, shipping, total, couponCode: coupon?.code || null });
}));

router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const order = await createOrder(req.user, req.body);

  let result;
  try {
    result = await startPayment(order, req.body.paymentMethod, req.body.payment);
  } catch (err) {
    await changeStatus(order.id, 'cancelled', 'Payment could not be started', { paymentStatus: 'failed' });
    throw err;
  }
  if (result.status === 'failed') {
    await changeStatus(order.id, 'cancelled', result.message || 'Payment failed', { paymentStatus: 'failed' });
    throw new HttpError(402, result.message || 'Payment failed. Your card was not charged.');
  }

  const full = await getOrderDetail(order.id, req.user.id);
  sendOrderConfirmation(req.user, full); // fire and forget
  res.status(201).json({
    order: full,
    payment: { status: result.status, redirectUrl: result.redirectUrl || null, message: result.message || null },
  });
}));

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT o.id, o.order_number, o.status, o.payment_status, o.payment_method, o.total, o.created_at,
            (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count,
            (SELECT image FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image
       FROM orders o WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 100`,
    [req.user.id]
  );
  res.json({ orders: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const order = await getOrderDetail(int(req.params.id, 'id', { min: 1 }), req.user.role === 'admin' ? null : req.user.id);
  if (!order) throw new HttpError(404, 'Order not found');
  res.json({ order });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const id = int(req.params.id, 'id', { min: 1 });
  const order = await getOrderDetail(id, req.user.id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (!['pending', 'paid', 'processing'].includes(order.status)) throw new HttpError(409, 'This order can no longer be cancelled');
  await changeStatus(id, 'cancelled', 'Cancelled by customer');
  res.json({ order: await getOrderDetail(id, req.user.id) });
}));

export default router;
