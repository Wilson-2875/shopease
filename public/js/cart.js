// Browser cart, adapted from the original cart.js.
// It only stores { productId, quantity }. Prices are ALWAYS re-read from the server, so the browser cannot change them.
const KEY = 'Mara_cart';
const MAX_QTY = 99;

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(data) ? data.filter((i) => Number.isInteger(i?.productId) && Number.isInteger(i?.quantity) && i.quantity > 0) : [];
  } catch {
    return [];
  }
}

let cart = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* storage full or blocked: cart still works for this page */ }
  renderCartQuantity();
  window.dispatchEvent(new CustomEvent('cart:changed'));
}

export const getCart = () => cart.map((i) => ({ ...i }));

export function addToCart(productId, quantity = 1) {
  const id = Number(productId);
  const qty = Math.max(1, Math.min(MAX_QTY, Number(quantity) || 1));
  const match = cart.find((i) => i.productId === id);
  if (match) match.quantity = Math.min(MAX_QTY, match.quantity + qty);
  else cart.push({ productId: id, quantity: qty });
  save();
}

export function removeFromCart(productId) {
  cart = cart.filter((i) => i.productId !== Number(productId));
  save();
}

/** Sets an exact quantity. Invalid numbers are ignored and 0 removes the item. */
export function updateQuantity(productId, newQuantity) {
  const qty = Number(newQuantity);
  if (!Number.isInteger(qty) || qty < 0) return;
  if (qty === 0) return removeFromCart(productId);
  const item = cart.find((i) => i.productId === Number(productId));
  if (item) {
    item.quantity = Math.min(MAX_QTY, qty);
    save();
  }
}

export function clearCart() {
  cart = [];
  save();
}

export const calculateCartQuantity = () => cart.reduce((sum, i) => sum + i.quantity, 0);

/** Updates the little number on the cart link in the header. */
export function renderCartQuantity() {
  document.querySelectorAll('.js-cart-quantity').forEach((el) => { el.textContent = calculateCartQuantity(); });
}
