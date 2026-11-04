// Shared page setup: header, footer, chat helper, toasts and product cards.
import { api } from './api.js';
import { setCurrency, formatMoney } from './money.js';
import { addToCart, renderCartQuantity } from './cart.js';
import { answerQuestion } from './faq.js';

export const state = { user: null, config: null, wishlist: new Set() };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const imgSrc = (p) => (p ? `/${String(p).replace(/^\/+/, '')}` : '/images/placeholder.svg');
export const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
export const fmtDateTime = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const label = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Only allow redirects to pages on this site. */
export const safeNext = (next) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export function toast(message, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.append(box); }
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), 3800);
}

export function stars(avg, count) {
  const pct = Math.max(0, Math.min(100, (Number(avg) / 5) * 100));
  const text = count ? `<span class="muted small">(${count})</span>` : '';
  return `<span class="stars" role="img" aria-label="${Number(avg).toFixed(1)} out of 5 stars"><span style="width:${pct}%"></span></span> ${text}`;
}

export function productCard(p) {
  const wished = state.wishlist.has(p.id);
  const out = p.stock < 1;
  return `<article class="card">
    <a class="card-img" href="/product.html?id=${p.id}" tabindex="-1" aria-hidden="true">
      <img loading="lazy" src="${imgSrc(p.image)}" alt="">
      ${p.discount_percent ? `<span class="badge">-${p.discount_percent}%</span>` : ''}
    </a>
    <button class="wish ${wished ? 'on' : ''}" data-wish="${p.id}" aria-pressed="${wished}" aria-label="${wished ? 'Remove from' : 'Add to'} wishlist">&#9829;</button>
    <div class="card-body">
      <a class="card-title" href="/product.html?id=${p.id}">${esc(p.name)}</a>
      ${p.rating_count > 0 || p.rating_avg > 0 ? `<div>${stars(p.rating_avg, p.rating_count)}</div>` : ''}
      <div class="price"><strong>${formatMoney(p.price)}</strong>${p.previous_price > p.price ? `<s>${formatMoney(p.previous_price)}</s>` : ''}</div>
      ${!out && p.stock <= 5 ? `<span class="small" style="color:var(--warn)">Only ${p.stock} left</span>` : ''}
      <button class="btn btn-sm" data-add="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Out of stock' : 'Add to cart'}</button>
    </div>
  </article>`;
}

/** Makes "Add to cart" and wishlist hearts work inside any container (uses event delegation). */
export function bindProductActions(container) {
  container.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      addToCart(add.dataset.add, 1);
      toast('Added to cart');
      return;
    }
    const heart = e.target.closest('[data-wish]');
    if (heart) {
      if (!state.user) { location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
      const id = Number(heart.dataset.wish);
      const on = state.wishlist.has(id);
      try {
        await api(`/wishlist/${id}`, { method: on ? 'DELETE' : 'POST' });
        on ? state.wishlist.delete(id) : state.wishlist.add(id);
        heart.classList.toggle('on', !on);
        heart.setAttribute('aria-pressed', String(!on));
        toast(on ? 'Removed from wishlist' : 'Saved to wishlist');
        container.dispatchEvent(new CustomEvent('wishlist:changed', { detail: { id, on: !on }, bubbles: true }));
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

/** Call once at the top of every page. Returns the shared state (or null if the visitor was redirected). */
export async function initPage({ title = '', requireAuth = false, requireAdmin = false } = {}) {
  // Local fallback image when a product photo is missing (inline onerror handlers are blocked by the CSP).
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t.tagName === 'IMG' && !t.dataset.fallback) { t.dataset.fallback = '1'; t.src = '/images/placeholder.svg'; }
  }, true);

  try {
    const [config, me] = await Promise.all([api('/config'), api('/auth/me')]);
    state.config = config;
    state.user = me.user;
    setCurrency(config.currency);
  } catch (err) {
    document.body.innerHTML = `<main class="container"><div class="notice error"><strong>The store could not load.</strong> ${esc(err.message)}</div></main>`;
    return null;
  }
  const here = encodeURIComponent(location.pathname + location.search);
  if (requireAuth && !state.user) { location.href = `/login.html?next=${here}`; return null; }
  if (requireAdmin && state.user?.role !== 'admin') { location.href = state.user ? '/' : `/login.html?next=${here}`; return null; }
  if (state.user) {
    try { state.wishlist = new Set((await api('/wishlist/ids')).ids); } catch { /* wishlist is optional */ }
  }
  document.title = title ? `${title} - ${state.config.storeName}` : state.config.storeName;
  renderHeader();
  renderFooter();
  renderChat();
  renderCartQuantity();
  window.addEventListener('storage', renderCartQuantity); // cart changed in another tab
  return state;
}

function renderHeader() {
  const { user, config } = state;
  const q = new URLSearchParams(location.search).get('q') || '';
  const el = $('#app-header');
  el.innerHTML = `<header class="site-header"><div class="container header-row">
      <a class="brand" href="/">${esc(config.storeName)}</a>
      <form class="search" action="/" method="get" role="search">
        <label class="sr-only" for="q">Search products</label>
        <input id="q" name="q" type="search" placeholder="Search products" value="${esc(q)}"><button type="submit">Search</button>
      </form>
      <button class="nav-toggle" aria-expanded="false" aria-controls="nav">Menu</button>
      <nav id="nav" class="nav" aria-label="Main">
        <a href="/">Shop</a><a href="/support.html">Support</a>
        ${user
          ? `<a href="/account.html">${esc(user.name.split(' ')[0])}'s account</a>${user.role === 'admin' ? '<a href="/admin.html">Admin</a>' : ''}<button class="link-btn" id="logout" style="color:#fff">Sign out</button>`
          : '<a href="/login.html">Sign in</a><a class="btn btn-sm" href="/register.html">Create account</a>'}
        <a class="cart-link" href="/cart.html">Cart <span class="cart-count js-cart-quantity">0</span></a>
      </nav></div></header>
    <div class="cat-bar"><div class="container" id="cat-bar"></div></div>`;
  const toggle = $('.nav-toggle', el);
  toggle.addEventListener('click', () => {
    const open = $('#nav').classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  $('#logout', el)?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    location.href = '/';
  });
  api('/categories').then(({ categories }) => {
    const active = new URLSearchParams(location.search).get('category');
    $('#cat-bar').innerHTML = `<a href="/" class="${!active && location.pathname === '/' ? 'active' : ''}">All products</a>` +
      categories.map((c) => `<a href="/?category=${esc(c.slug)}" class="${active === c.slug ? 'active' : ''}">${esc(c.name)}</a>`).join('');
  }).catch(() => {});
}

function renderFooter() {
  const { config } = state;
  $('#app-footer').innerHTML = `<footer class="site-footer"><div class="container">
    <div class="footer-grid">
      <div><h3>${esc(config.storeName)}</h3><p>Everyday essentials for the home, wardrobe and kitchen, delivered to your door.</p></div>
      <div><h3>Shop</h3><a href="/">All products</a><a href="/?onSale=1">Deals</a><a href="/cart.html">Cart</a></div>
      <div><h3>Help</h3><a href="/support.html">Contact &amp; FAQ</a><a href="/account.html#orders">Track an order</a><a href="/privacy.html">Privacy policy</a></div>
      <div><h3>Get offers by email</h3>
        <form id="newsletter-form"><label class="sr-only" for="nl-email">Email address</label><input id="nl-email" type="email" placeholder="you@example.com" required><button class="btn btn-sm" type="submit">Subscribe</button></form>
        <p class="small" id="nl-msg" role="status"></p></div>
    </div>
    <p class="copyright">&copy; ${new Date().getFullYear()} ${esc(config.storeName)}. All rights reserved.</p></div></footer>`;
  $('#newsletter-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/newsletter', { method: 'POST', body: { email: $('#nl-email').value } });
      $('#nl-msg').textContent = 'Thanks for subscribing!';
      e.target.reset();
    } catch (err) { $('#nl-msg').textContent = err.message; }
  });
}

function renderChat() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<button class="btn chat-fab" aria-expanded="false" aria-controls="chat">Chat with us</button>
    <section class="chat hidden" id="chat" aria-label="Chat helper">
      <header>Quick help</header>
      <div class="chat-log" id="chat-log" aria-live="polite"><div class="msg">Hi! Ask about delivery, payment, returns or tracking.</div></div>
      <form id="chat-form"><label class="sr-only" for="chat-input">Your question</label><input id="chat-input" placeholder="Type your question" autocomplete="off"><button class="btn btn-sm">Send</button></form>
    </section>`;
  document.body.append(wrap);
  const fab = $('.chat-fab');
  const panel = $('#chat');
  fab.addEventListener('click', () => {
    const open = panel.classList.toggle('hidden') === false;
    fab.setAttribute('aria-expanded', String(open));
    if (open) $('#chat-input').focus();
  });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    const log = $('#chat-log');
    log.insertAdjacentHTML('beforeend', `<div class="msg me">${esc(text)}</div>`);
    const a = answerQuestion(text);
    log.insertAdjacentHTML('beforeend', `<div class="msg">${esc(a.text)}${a.link ? ` <a href="${a.link.href}">${esc(a.link.label)}</a>` : ''}</div>`);
    input.value = '';
    log.scrollTop = log.scrollHeight;
  });
}
