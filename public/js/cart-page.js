import { api } from './api.js';
import { getCart, removeFromCart, updateQuantity } from './cart.js';
import { formatMoney } from './money.js';
import { initPage, $, esc, imgSrc, toast } from './ui.js';

const root = $('#cart');

async function render() {
  const cart = getCart();
  if (!cart.length) {
    root.innerHTML = '<div class="empty"><h2>Your cart is empty</h2><p>Browse the shop and add something you like.</p><a class="btn" href="/">Start shopping</a></div>';
    return;
  }
  const { items } = await api(`/products/by-ids?ids=${cart.map((i) => i.productId).join(',')}`);
  const byId = new Map(items.map((p) => [p.id, p]));

  // Remove products that were deleted or archived since they were added.
  const gone = cart.filter((i) => !byId.has(i.productId));
  gone.forEach((i) => removeFromCart(i.productId));
  if (gone.length) toast('Some items are no longer available and were removed', 'error');

  const lines = getCart().map((i) => ({ ...i, p: byId.get(i.productId) }));
  if (!lines.length) return render();
  let subtotal = 0;
  let problem = false;
  const rows = lines.map(({ productId, quantity, p }) => {
    const over = quantity > p.stock;
    if (over || p.stock < 1) problem = true;
    subtotal += p.price * quantity;
    return `<div class="cart-row" data-id="${productId}">
      <img src="${imgSrc(p.image)}" alt="">
      <div><a href="/product.html?id=${p.id}"><strong>${esc(p.name)}</strong></a>
        <div class="price muted">${formatMoney(p.price)} each</div>
        ${over ? `<div class="small" style="color:var(--sale)">${p.stock > 0 ? `Only ${p.stock} available` : 'Out of stock'}</div>` : ''}
        <div class="row" style="margin-top:8px">
          <div class="qty"><button type="button" data-step="-1" aria-label="Decrease quantity">&minus;</button><input type="number" min="1" max="99" value="${quantity}" aria-label="Quantity for ${esc(p.name)}"><button type="button" data-step="1" aria-label="Increase quantity">+</button></div>
          <button class="link-btn small" data-remove>Remove</button></div></div>
      <div class="line-total price"><strong>${formatMoney(p.price * quantity)}</strong></div></div>`;
  }).join('');

  root.innerHTML = `<div class="cart-layout">
    <section class="panel">${rows}</section>
    <aside class="panel summary"><h2>Order summary</h2>
      <dl><dt>Subtotal</dt><dd>${formatMoney(subtotal)}</dd><dt>Delivery</dt><dd>Chosen at checkout</dd></dl>
      <p class="muted small">Coupons are applied at checkout.</p>
      ${problem ? '<p class="form-error">Fix the highlighted items to continue.</p>' : ''}
      <a class="btn btn-block ${problem ? 'hidden' : ''}" href="/checkout.html">Proceed to checkout</a></aside></div>`;
}

root.addEventListener('click', (e) => {
  const row = e.target.closest('.cart-row');
  if (!row) return;
  const id = Number(row.dataset.id);
  if (e.target.closest('[data-remove]')) { removeFromCart(id); render(); return; }
  const step = e.target.closest('[data-step]');
  if (step) {
    const input = $('input', row);
    updateQuantity(id, Number(input.value) + Number(step.dataset.step));
    render();
  }
});
root.addEventListener('change', (e) => {
  const row = e.target.closest('.cart-row');
  if (row && e.target.matches('input')) { updateQuantity(Number(row.dataset.id), parseInt(e.target.value, 10)); render(); }
});

if (await initPage({ title: 'Cart' })) {
  render().catch((err) => { root.innerHTML = `<div class="notice error">${esc(err.message)}</div>`; });
}
