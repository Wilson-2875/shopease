import { api } from './api.js';
import { addToCart } from './cart.js';
import { initPage, state, $, $$, esc, imgSrc, stars, productCard, bindProductActions, toast, fmtDate } from './ui.js';
import { formatMoney } from './money.js';

const root = $('#product');
const id = Number(new URLSearchParams(location.search).get('id'));

bindProductActions(document.body);
if (await initPage({ title: 'Product' })) {
  try {
    if (!id) throw new Error('Product not found');
    const [{ product: p }, rel, rev] = await Promise.all([api(`/products/${id}`), api(`/products/${id}/related`), api(`/reviews/product/${id}`)]);
    document.title = `${p.name} - ${state.config.storeName}`;
    render(p, rel, rev);
  } catch (err) {
    root.innerHTML = `<div class="empty"><h1>${esc(err.message)}</h1><a class="btn" href="/">Back to the shop</a></div>`;
  }
}

function render(p, rel, rev) {
  const out = p.stock < 1;
  const wished = state.wishlist.has(p.id);
  root.innerHTML = `
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Shop</a>${p.category_slug ? ` / <a href="/?category=${esc(p.category_slug)}">${esc(p.category_name)}</a>` : ''}</nav>
    <div class="product-layout">
      <div class="product-img"><img src="${imgSrc(p.image)}" alt="${esc(p.name)}"></div>
      <div>
        <h1>${esc(p.name)}</h1>
        ${p.brand ? `<p class="muted">by ${esc(p.brand)}</p>` : ''}
        ${p.rating_count > 0 ? `<p>${stars(p.rating_avg, p.rating_count)} <span class="muted small">${Number(p.rating_avg).toFixed(1)} out of 5</span></p>` : '<p class="muted small">No reviews yet</p>'}
        <p class="product-price price">${formatMoney(p.price)} ${p.previous_price > p.price ? `<s class="muted" style="font-size:1rem;font-weight:400">${formatMoney(p.previous_price)}</s> <span class="status cancelled">-${p.discount_percent}%</span>` : ''}</p>
        <p>${esc(p.description || '')}</p>
        <p>${out ? '<strong style="color:var(--sale)">Out of stock</strong>' : p.stock <= 5 ? `<strong style="color:var(--warn)">Only ${p.stock} left</strong>` : '<strong style="color:var(--ok)">In stock</strong>'}</p>
        <div class="row" style="margin:16px 0">
          <div class="qty"><button type="button" id="minus" aria-label="Decrease quantity">&minus;</button><input id="qty" type="number" value="1" min="1" max="${Math.min(p.stock, 99)}" aria-label="Quantity"><button type="button" id="plus" aria-label="Increase quantity">+</button></div>
          <button class="btn" id="add" ${out ? 'disabled' : ''}>Add to cart</button>
          <button class="btn btn-outline" data-wish="${p.id}" aria-pressed="${wished}">${wished ? '&#9829; Saved' : '&#9825; Save for later'}</button>
        </div>
      </div>
    </div>
    <section><h2>Customer reviews</h2><div id="reviews"></div></section>
    ${rel.related.length ? `<h2 class="section-title">You might also like</h2><div class="grid-products">${rel.related.map(productCard).join('')}</div>` : ''}
    ${rel.alsoBought.length ? `<h2 class="section-title">Customers also bought</h2><div class="grid-products">${rel.alsoBought.map(productCard).join('')}</div>` : ''}`;

  const qty = $('#qty');
  const clamp = () => { qty.value = Math.max(1, Math.min(Number(qty.max) || 1, parseInt(qty.value, 10) || 1)); };
  $('#minus').onclick = () => { qty.value = Number(qty.value) - 1; clamp(); };
  $('#plus').onclick = () => { qty.value = Number(qty.value) + 1; clamp(); };
  qty.onchange = clamp;
  $('#add').onclick = () => { clamp(); addToCart(p.id, Number(qty.value)); toast(`Added ${qty.value} to cart`); };
  // The heart button here is outside bindProductActions' .wish, so give it a matching label after toggling.
  $('[data-wish].btn', root).addEventListener('click', (e) => setTimeout(() => {
    const on = state.wishlist.has(p.id);
    e.target.innerHTML = on ? '&#9829; Saved' : '&#9825; Save for later';
  }, 400));
  renderReviews(p, rev);
}

function renderReviews(p, rev) {
  const box = $('#reviews');
  const list = rev.reviews.length
    ? rev.reviews.map((r) => `<article class="review">
        <div>${stars(r.rating)} <strong>${esc(r.title || '')}</strong></div>
        <p>${esc(r.comment || '')}</p>
        <p class="muted small">${esc(r.author)} &middot; ${fmtDate(r.created_at)}${r.verified ? ' &middot; Verified purchase' : ''}</p></article>`).join('')
    : '<p class="muted">Be the first to review this product.</p>';
  const formHtml = state.user
    ? `<form id="review-form" class="panel" style="margin-top:16px"><h3>Write a review</h3>
        <div class="rating-input" role="radiogroup" aria-label="Rating">
          ${[5, 4, 3, 2, 1].map((n) => `<input type="radio" id="r${n}" name="rating" value="${n}" ${n === 5 ? 'checked' : ''}><label for="r${n}" title="${n} stars">&#9733;</label>`).join('')}
        </div>
        <div class="field"><label for="rv-title">Headline</label><input id="rv-title" name="title" maxlength="100"></div>
        <div class="field"><label for="rv-comment">Your review</label><textarea id="rv-comment" name="comment"></textarea></div>
        <p class="form-error" id="rv-error" role="alert"></p><button class="btn" type="submit">Post review</button></form>`
    : `<p style="margin-top:16px"><a href="/login.html?next=${encodeURIComponent(location.pathname + location.search)}">Sign in</a> to write a review.</p>`;
  box.innerHTML = list + formHtml;
  $('#review-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/reviews', { method: 'POST', body: { productId: p.id, rating: Number(f.rating.value), title: f.title.value, comment: f.comment.value } });
      toast('Thanks for your review!');
      const [{ product }, fresh] = await Promise.all([api(`/products/${p.id}`), api(`/reviews/product/${p.id}`)]);
      render(product, await api(`/products/${p.id}/related`), fresh);
    } catch (err) { $('#rv-error').textContent = err.message; }
  });
  void $$;
}
