import { api } from './api.js';
import { initPage, state, $, esc, productCard, bindProductActions } from './ui.js';

const grid = $('#grid');
const form = $('#filter-form');
const FILTER_KEYS = ['category', 'minPrice', 'maxPrice', 'brand', 'minRating', 'inStock', 'onSale'];
let loadToken = 0;

function currentParams() { return new URLSearchParams(location.search); }

function fillFormFromUrl() {
  const p = currentParams();
  form.category.value = p.get('category') || '';
  form.minPrice.value = p.get('minPrice') || '';
  form.maxPrice.value = p.get('maxPrice') || '';
  form.minRating.value = p.get('minRating') || '';
  form.inStock.checked = p.get('inStock') === '1';
  form.onSale.checked = p.get('onSale') === '1';
  const brands = (p.get('brand') || '').split(',');
  form.querySelectorAll('input[name=brand]').forEach((b) => { b.checked = brands.includes(b.value); });
  $('#sort').value = p.get('sort') || 'featured';
}

function pushParams(mutate) {
  const p = currentParams();
  mutate(p);
  history.pushState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
  load();
}

async function load() {
  const token = ++loadToken;
  const p = currentParams();
  grid.innerHTML = '<p class="muted">Loading products...</p>';
  try {
    const data = await api(`/products?${p.toString()}&limit=12`);
    if (token !== loadToken) return; // a newer request replaced this one
    const q = p.get('q');
    $('#results-title').textContent = q ? `Results for "${q}"` : 'All products';
    $('#count').textContent = `${data.total} ${data.total === 1 ? 'product' : 'products'}`;
    grid.innerHTML = data.items.length
      ? data.items.map(productCard).join('')
      : '<div class="empty" style="grid-column:1/-1"><h3>No products match</h3><p>Try removing a filter or searching for something else.</p></div>';
    renderPagination(data.page, data.pages);
    const filtered = [...p.keys()].some((k) => k !== 'page' && k !== 'sort');
    $('#recommended').classList.toggle('hidden', filtered);
  } catch (err) {
    grid.innerHTML = `<div class="notice error" style="grid-column:1/-1">${esc(err.message)}</div>`;
  }
}

function renderPagination(page, pages) {
  const nav = $('#pagination');
  if (pages <= 1) { nav.innerHTML = ''; return; }
  nav.innerHTML = Array.from({ length: pages }, (_, i) => i + 1)
    .map((n) => `<button data-page="${n}" ${n === page ? 'aria-current="true"' : ''} aria-label="Page ${n}">${n}</button>`).join('');
}

async function loadRecommended() {
  try {
    const { personal, items } = await api('/products/recommended');
    if (!items.length) return;
    $('#recommended').innerHTML = `<h2 class="section-title" style="margin-top:0">${personal ? 'Picked for you' : 'Top deals right now'}</h2>
      <div class="grid-products" style="margin-bottom:28px">${items.slice(0, 4).map(productCard).join('')}</div>`;
  } catch { /* recommendations are optional */ }
}

async function loadFilters() {
  const [{ categories }, meta] = await Promise.all([api('/categories'), api('/products/meta')]);
  $('#f-category').insertAdjacentHTML('beforeend', categories.map((c) =>
    `<option value="${esc(c.slug)}">${esc(c.name)}</option>` +
    c.children.map((k) => `<option value="${esc(k.slug)}">&nbsp;&nbsp;${esc(k.name)}</option>`).join('')).join(''));
  $('#f-brands').innerHTML = meta.brands.length
    ? meta.brands.map((b) => `<label class="check"><input type="checkbox" name="brand" value="${esc(b)}"> ${esc(b)}</label>`).join('')
    : '<p class="muted small">No brands yet</p>';
  form.minPrice.placeholder = `Min (${Math.floor(meta.minPrice)})`;
  form.maxPrice.placeholder = `Max (${Math.ceil(meta.maxPrice)})`;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  pushParams((p) => {
    FILTER_KEYS.forEach((k) => p.delete(k));
    p.delete('page');
    for (const k of ['category', 'minPrice', 'maxPrice', 'minRating']) if (form[k].value) p.set(k, form[k].value);
    if (form.inStock.checked) p.set('inStock', '1');
    if (form.onSale.checked) p.set('onSale', '1');
    const brands = [...form.querySelectorAll('input[name=brand]:checked')].map((b) => b.value);
    if (brands.length) p.set('brand', brands.join(','));
  });
});
$('#reset').addEventListener('click', () => { pushParams((p) => { [...p.keys()].forEach((k) => p.delete(k)); }); fillFormFromUrl(); });
$('#sort').addEventListener('change', (e) => pushParams((p) => { p.set('sort', e.target.value); p.delete('page'); }));
$('#pagination').addEventListener('click', (e) => {
  const b = e.target.closest('[data-page]');
  if (b) { pushParams((p) => p.set('page', b.dataset.page)); window.scrollTo({ top: 0 }); }
});
window.addEventListener('popstate', () => { fillFormFromUrl(); load(); });

bindProductActions(document.body);

if (await initPage({ title: 'Shop' })) {
  if (window.innerWidth < 900) $('#filters').open = false;
  await loadFilters();
  fillFormFromUrl();
  load();
  loadRecommended();
  void state;
}
