import { api } from './api.js';
import { getCart, clearCart } from './cart.js';
import { formatMoney } from './money.js';
import { initPage, state, $, esc, toast } from './ui.js';

const root = $('#checkout');
const METHODS = { card: 'Credit or debit card', mpesa: 'M-Pesa', paypal: 'PayPal', bank_transfer: 'Bank transfer' };
let addresses = [];
let options = [];
let couponCode = '';
let quote = null;

if (await initPage({ title: 'Checkout', requireAuth: true })) start().catch((e) => { root.innerHTML = `<div class="notice error">${esc(e.message)}</div>`; });

async function start() {
  if (!getCart().length) { location.href = '/cart.html'; return; }
  [{ addresses }, { options }] = await Promise.all([api('/addresses'), api('/delivery-options')]);
  const { config, user } = state;
  const methods = config.payments;
  if (!methods.length) throw new Error('No payment methods are enabled. Set PAYMENT_METHODS in .env.');

  const addrHtml = addresses.map((a, i) => `<label class="option"><input type="radio" name="addr" value="${a.id}" ${a.is_default || (i === 0 && !addresses.some((x) => x.is_default)) ? 'checked' : ''}>
      <span class="grow"><strong>${esc(a.full_name)}</strong>${a.label ? ` (${esc(a.label)})` : ''}<br><span class="muted small">${esc(a.line1)}${a.line2 ? `, ${esc(a.line2)}` : ''}, ${esc(a.city)}${a.region ? `, ${esc(a.region)}` : ''}, ${esc(a.country)} &middot; ${esc(a.phone)}</span></span></label>`).join('');

  root.innerHTML = `<form id="co-form" class="checkout-layout" novalidate><div>
    <section class="panel"><h2>1. Delivery address</h2>
      ${addrHtml}
      <label class="option"><input type="radio" name="addr" value="new" ${addresses.length ? '' : 'checked'}><span class="grow"><strong>Use a new address</strong></span></label>
      <div id="new-addr" class="form-grid ${addresses.length ? 'hidden' : ''}" style="margin-top:12px">
        <div class="field"><label for="a-name">Full name</label><input id="a-name" name="fullName" value="${esc(user.name)}" autocomplete="name"></div>
        <div class="field"><label for="a-phone">Phone</label><input id="a-phone" name="phone" value="${esc(user.phone || '')}" autocomplete="tel"></div>
        <div class="field full"><label for="a-l1">Address</label><input id="a-l1" name="line1" autocomplete="address-line1"></div>
        <div class="field full"><label for="a-l2">Apartment, suite, landmark (optional)</label><input id="a-l2" name="line2" autocomplete="address-line2"></div>
        <div class="field"><label for="a-city">City / town</label><input id="a-city" name="city" autocomplete="address-level2"></div>
        <div class="field"><label for="a-region">County / state</label><input id="a-region" name="region"></div>
        <div class="field"><label for="a-zip">Postal code</label><input id="a-zip" name="postalCode" autocomplete="postal-code"></div>
        <div class="field"><label for="a-country">Country</label><input id="a-country" name="country" value="${esc(config.defaultCountry)}" autocomplete="country-name"></div>
        <label class="check full"><input type="checkbox" name="saveAddress" checked> Save this address to my account</label>
      </div></section>
    <section class="panel"><h2>2. Delivery</h2>
      ${options.map((o, i) => `<label class="option"><input type="radio" name="delivery" value="${o.id}" ${i === 0 ? 'checked' : ''}><span class="grow"><strong>${esc(o.name)}</strong> <span class="muted">(${o.days} ${o.days === 1 ? 'day' : 'days'})</span></span><strong>${o.price > 0 ? formatMoney(o.price) : 'Free'}</strong></label>`).join('')}</section>
    <section class="panel"><h2>3. Payment</h2>
      ${methods.map((m, i) => `<label class="option"><input type="radio" name="method" value="${m}" ${i === 0 ? 'checked' : ''}><span class="grow"><strong>${METHODS[m]}</strong></span></label>`).join('')}
      <div id="pay-card" class="hidden">${config.cardMode === 'form' ? `
        <div class="notice warn small">Simulator mode: no real money is charged. Test with <strong>4242 4242 4242 4242</strong>, any future expiry and any 3-digit code. Never type a real card number here.</div>
        <div class="form-grid">
          <div class="field full"><label for="c-num">Card number</label><input id="c-num" name="cardNumber" inputmode="numeric" autocomplete="off" maxlength="23"></div>
          <div class="field"><label for="c-exp">Expiry (MM/YY)</label><input id="c-exp" name="expiry" placeholder="MM/YY" autocomplete="off" maxlength="5"></div>
          <div class="field"><label for="c-cvc">Security code</label><input id="c-cvc" name="cvc" inputmode="numeric" autocomplete="off" maxlength="4"></div>
        </div>` : '<p class="muted">You will be taken to our payment partner\'s secure page to enter your card details.</p>'}</div>
      <div id="pay-mpesa" class="hidden"><div class="field"><label for="m-phone">M-Pesa phone number</label><input id="m-phone" name="mpesaPhone" inputmode="tel" value="${esc(user.phone || '')}" placeholder="0712345678"></div>
        <p class="muted small">You will get a prompt on your phone to enter your M-Pesa PIN.</p></div>
      <div id="pay-paypal" class="hidden"><p class="muted">You will be redirected to PayPal to approve the payment.</p></div>
      <div id="pay-bank_transfer" class="hidden"><p>${esc(config.bankDetails || 'Bank details will be shown after you place the order.')}</p>
        <p class="muted small">Use your order number as the payment reference. We ship once the payment is confirmed.</p></div>
    </section></div>
    <aside class="panel summary"><h2>Order summary</h2><div id="lines"></div>
      <div class="field" style="margin-top:12px"><label for="coupon">Coupon code</label><div class="row" style="flex-wrap:nowrap"><input id="coupon" autocomplete="off"><button class="btn btn-outline btn-sm" type="button" id="apply">Apply</button></div><span class="small" id="coupon-msg" role="status"></span></div>
      <dl id="totals"></dl>
      <p class="form-error" id="error" role="alert"></p>
      <button class="btn btn-block" id="place" type="submit">Place order</button></aside></form>`;

  const form = $('#co-form');
  const showPayPane = () => {
    const m = form.method.value;
    Object.keys(METHODS).forEach((k) => $(`#pay-${k}`)?.classList.toggle('hidden', k !== m));
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'addr') $('#new-addr').classList.toggle('hidden', form.addr.value !== 'new');
    if (e.target.name === 'method') showPayPane();
    if (e.target.name === 'delivery') refreshQuote();
  });
  $('#apply').addEventListener('click', () => { couponCode = $('#coupon').value.trim(); refreshQuote(true); });
  form.addEventListener('submit', place);
  showPayPane();
  refreshQuote();
}

async function refreshQuote(fromCoupon = false) {
  const form = $('#co-form');
  const msg = $('#coupon-msg');
  try {
    quote = await api('/orders/quote', { method: 'POST', body: { items: getCart(), couponCode, deliveryOptionId: form.delivery.value } });
    if (fromCoupon) msg.textContent = quote.couponCode ? `Coupon ${quote.couponCode} applied` : '';
    $('#error').textContent = '';
  } catch (err) {
    if (fromCoupon) { msg.textContent = err.message; couponCode = ''; return refreshQuote(); }
    $('#error').textContent = err.message;
    return;
  }
  $('#lines').innerHTML = quote.lines.map((l) => `<div class="row between small"><span>${esc(l.name)} &times; ${l.quantity}</span><span class="price">${formatMoney(l.lineTotal)}</span></div>`).join('');
  $('#totals').innerHTML = `<dt>Subtotal</dt><dd>${formatMoney(quote.subtotal)}</dd>
    ${quote.discount > 0 ? `<dt>Discount</dt><dd>-${formatMoney(quote.discount)}</dd>` : ''}
    <dt>Delivery</dt><dd>${quote.shipping > 0 ? formatMoney(quote.shipping) : 'Free'}</dd>
    <dt class="total">Total</dt><dd class="total">${formatMoney(quote.total)}</dd>`;
}

async function place(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const err = $('#error');
  const btn = $('#place');
  err.textContent = '';
  const method = form.method.value;
  const body = { items: getCart(), couponCode, deliveryOptionId: form.delivery.value, paymentMethod: method, payment: {} };

  if (form.addr.value === 'new') {
    body.address = Object.fromEntries(['fullName', 'phone', 'line1', 'line2', 'city', 'region', 'postalCode', 'country'].map((k) => [k, form[k].value]));
    body.saveAddress = form.saveAddress.checked;
  } else {
    body.addressId = Number(form.addr.value);
  }
  if (method === 'card' && state.config.cardMode === 'form') body.payment = { cardNumber: form.cardNumber.value, expiry: form.expiry.value, cvc: form.cvc.value };
  if (method === 'mpesa') body.payment = { mpesaPhone: form.mpesaPhone.value };

  btn.disabled = true;
  btn.textContent = 'Placing order...';
  try {
    const { order, payment } = await api('/orders', { method: 'POST', body });
    clearCart();
    if (payment.redirectUrl) { location.href = payment.redirectUrl; return; }
    location.href = `/order.html?id=${order.id}&placed=1`;
  } catch (ex) {
    err.textContent = ex.message;
    toast(ex.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Place order';
    err.scrollIntoView({ block: 'center' });
  }
}
