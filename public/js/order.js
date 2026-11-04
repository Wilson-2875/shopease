import { api } from './api.js';
import { formatMoney } from './money.js';
import { initPage, state, $, esc, imgSrc, label, fmtDateTime, toast } from './ui.js';

const root = $('#order');
const params = new URLSearchParams(location.search);
const id = Number(params.get('id'));
const STEPS = [['pending', 'Placed'], ['paid', 'Paid'], ['processing', 'Processing'], ['shipped', 'Shipped'], ['delivered', 'Delivered']];
let polls = 0;
let timer = null;

if (await initPage({ title: 'Order', requireAuth: true })) load();

async function load() {
  try {
    if (!id) throw new Error('Order not found');
    const { order } = await api(`/orders/${id}`);
    render(order);
    // Card, M-Pesa and PayPal confirmations arrive from the provider a few seconds later, so check again.
    const waiting = order.status === 'pending' && order.payment_status === 'unpaid' && order.payment_method !== 'bank_transfer';
    clearTimeout(timer);
    if (waiting && polls++ < 24) timer = setTimeout(load, 5000);
  } catch (err) {
    root.innerHTML = `<div class="empty"><h1>${esc(err.message)}</h1><a class="btn" href="/account.html#orders">My orders</a></div>`;
  }
}

function render(o) {
  const cancelled = o.status === 'cancelled';
  const reached = STEPS.findIndex(([s]) => s === o.status);
  const payNote = o.payment_status === 'paid' ? ''
    : o.payment_method === 'bank_transfer' ? `<div class="notice warn"><strong>Waiting for your bank transfer.</strong><br>${esc(state.config.bankDetails)}<br>Reference: <strong>${esc(o.order_number)}</strong> &middot; Amount: <strong>${formatMoney(o.total)}</strong></div>`
    : o.status === 'pending' ? `<div class="notice warn"><strong>Waiting for payment confirmation...</strong> This page updates automatically. For M-Pesa, enter your PIN on your phone.</div>` : '';

  root.innerHTML = `
    ${params.get('placed') ? `<div class="notice"><strong>Thank you! Your order has been placed.</strong> We sent the details to ${esc(o.customer_email)}.</div>` : ''}
    <div class="row between"><div><h1 style="margin:0">Order ${esc(o.order_number)}</h1><p class="muted">Placed ${fmtDateTime(o.created_at)}</p></div>
      <div><span class="status ${o.status}">${label(o.status)}</span> <span class="status ${o.payment_status}">${label(o.payment_status)}</span></div></div>
    ${payNote}
    <section class="panel">
      ${cancelled ? '<p><strong>This order was cancelled.</strong></p>' : `<ol class="timeline" aria-label="Order progress">${STEPS.map(([s, t], i) => `<li class="${i <= reached ? 'done' : ''}">${t}</li>`).join('')}</ol>`}
      ${o.tracking_number ? `<p style="margin-top:16px">Tracking number: <strong>${esc(o.tracking_number)}</strong></p>` : ''}
      ${!cancelled && o.status !== 'delivered' && o.delivery_days ? `<p class="muted small">Estimated delivery: ${o.delivery_days} ${o.delivery_days === 1 ? 'day' : 'days'} after dispatch (${esc(o.delivery_name || '')}).</p>` : ''}
    </section>
    <div class="cart-layout">
      <section class="panel"><h2>Items</h2>${o.items.map((i) => `<div class="cart-row"><img src="${imgSrc(i.image)}" alt=""><div><a href="/product.html?id=${i.product_id}">${esc(i.name)}</a><div class="muted small">Qty ${i.quantity} &times; ${formatMoney(i.price)}</div></div><div class="line-total price">${formatMoney(i.price * i.quantity)}</div></div>`).join('')}</section>
      <aside class="stack">
        <div class="panel summary" style="position:static"><h3>Summary</h3><dl><dt>Subtotal</dt><dd>${formatMoney(o.subtotal)}</dd>${o.discount > 0 ? `<dt>Discount${o.coupon_code ? ` (${esc(o.coupon_code)})` : ''}</dt><dd>-${formatMoney(o.discount)}</dd>` : ''}<dt>Delivery</dt><dd>${o.shipping > 0 ? formatMoney(o.shipping) : 'Free'}</dd><dt class="total">Total</dt><dd class="total">${formatMoney(o.total)}</dd></dl>
          <p class="muted small" style="margin-top:10px">Paid with ${esc(label(o.payment_method))}</p></div>
        <div class="panel"><h3>Delivering to</h3><p>${esc(o.ship_name)}<br>${esc(o.ship_line1)}${o.ship_line2 ? `<br>${esc(o.ship_line2)}` : ''}<br>${esc(o.ship_city)}${o.ship_region ? `, ${esc(o.ship_region)}` : ''} ${esc(o.ship_postal_code || '')}<br>${esc(o.ship_country)}<br>${esc(o.ship_phone)}</p></div>
        <div class="panel"><h3>History</h3><ul class="history">${o.history.map((h) => `<li><strong>${label(h.status)}</strong>${h.note ? ` - ${esc(h.note)}` : ''}<br><span class="muted small">${fmtDateTime(h.created_at)}</span></li>`).join('')}</ul></div>
        ${['pending', 'paid', 'processing'].includes(o.status) ? '<button class="btn btn-outline btn-danger" id="cancel" style="color:#fff">Cancel order</button>' : ''}
      </aside></div>`;

  $('#cancel')?.addEventListener('click', async () => {
    if (!confirm('Cancel this order? Items go back into stock.')) return;
    try { await api(`/orders/${o.id}/cancel`, { method: 'POST' }); toast('Order cancelled'); load(); } catch (err) { toast(err.message, 'error'); }
  });
}
