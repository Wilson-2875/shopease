import { api } from './api.js';
import { formatMoney } from './money.js';
import { initPage, state, $, $$, esc, imgSrc, label, fmtDate, toast, productCard, bindProductActions } from './ui.js';

const content = $('#tab-content');
const tabs = { orders, profile, addresses, wishlist };
let editing = null; // address being edited

function show(name) {
  if (!tabs[name]) name = 'orders';
  $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  history.replaceState(null, '', `#${name}`);
  Promise.resolve(tabs[name]()).catch((err) => { content.innerHTML = `<div class="notice error">${esc(err.message)}</div>`; });
}

async function orders() {
  const { orders: list } = await api('/orders');
  content.innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Order</th><th>Date</th><th>Status</th><th>Payment</th><th class="num">Total</th><th></th></tr></thead><tbody>
    ${list.map((o) => `<tr><td><img class="thumb" src="${imgSrc(o.image)}" alt=""></td><td><strong>${esc(o.order_number)}</strong><br><span class="muted small">${o.item_count} item${o.item_count === 1 ? '' : 's'}</span></td><td>${fmtDate(o.created_at)}</td>
      <td><span class="status ${o.status}">${label(o.status)}</span></td><td><span class="status ${o.payment_status}">${label(o.payment_status)}</span></td><td class="num">${formatMoney(o.total)}</td><td><a class="btn btn-sm btn-outline" href="/order.html?id=${o.id}">Track</a></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty"><h2>No orders yet</h2><a class="btn" href="/">Start shopping</a></div>';
}

function profile() {
  const u = state.user;
  content.innerHTML = `<div class="shop-layout" style="grid-template-columns:1fr 1fr">
    <form class="panel" id="profile-form"><h2>Your details</h2>
      <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${esc(u.name)}" required></div>
      <div class="field"><label for="p-email">Email</label><input id="p-email" value="${esc(u.email)}" disabled></div>
      <div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone" value="${esc(u.phone || '')}"></div>
      <p class="form-error" id="p-error" role="alert"></p><button class="btn">Save changes</button></form>
    <form class="panel" id="pw-form"><h2>Change password</h2>
      <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" name="currentPassword" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">New password</label><input id="pw-new" name="newPassword" type="password" autocomplete="new-password" required></div>
      <p class="form-error" id="pw-error" role="alert"></p><button class="btn">Update password</button></form></div>`;
  $('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { user } = await api('/auth/profile', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      Object.assign(state.user, user);
      toast('Profile saved');
    } catch (err) { $('#p-error').textContent = err.message; }
  });
  $('#pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/auth/password', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
      e.target.reset();
      $('#pw-error').textContent = '';
      toast('Password updated');
    } catch (err) { $('#pw-error').textContent = err.message; }
  });
}

async function addresses() {
  const { addresses: list } = await api('/addresses');
  const a = editing || {};
  content.innerHTML = `<div class="shop-layout" style="grid-template-columns:1fr 1fr">
    <section>${list.length ? list.map((x) => `<div class="panel"><strong>${esc(x.full_name)}</strong>${x.label ? ` (${esc(x.label)})` : ''} ${x.is_default ? '<span class="status paid">Default</span>' : ''}
      <p class="muted">${esc(x.line1)}${x.line2 ? `, ${esc(x.line2)}` : ''}<br>${esc(x.city)}${x.region ? `, ${esc(x.region)}` : ''} ${esc(x.postal_code || '')}<br>${esc(x.country)} &middot; ${esc(x.phone)}</p>
      <div class="row"><button class="btn btn-sm btn-outline" data-edit='${esc(JSON.stringify(x))}'>Edit</button><button class="btn btn-sm btn-outline" data-del="${x.id}">Delete</button></div></div>`).join('') : '<div class="empty">No saved addresses yet.</div>'}</section>
    <form class="panel" id="addr-form"><h2>${a.id ? 'Edit address' : 'Add an address'}</h2><div class="form-grid">
      <div class="field"><label for="ad-name">Full name</label><input id="ad-name" name="fullName" value="${esc(a.full_name || state.user.name)}" required></div>
      <div class="field"><label for="ad-phone">Phone</label><input id="ad-phone" name="phone" value="${esc(a.phone || state.user.phone || '')}" required></div>
      <div class="field full"><label for="ad-l1">Address</label><input id="ad-l1" name="line1" value="${esc(a.line1 || '')}" required></div>
      <div class="field full"><label for="ad-l2">Apartment, suite, landmark (optional)</label><input id="ad-l2" name="line2" value="${esc(a.line2 || '')}"></div>
      <div class="field"><label for="ad-city">City / town</label><input id="ad-city" name="city" value="${esc(a.city || '')}" required></div>
      <div class="field"><label for="ad-region">County / state</label><input id="ad-region" name="region" value="${esc(a.region || '')}"></div>
      <div class="field"><label for="ad-zip">Postal code</label><input id="ad-zip" name="postalCode" value="${esc(a.postal_code || '')}"></div>
      <div class="field"><label for="ad-country">Country</label><input id="ad-country" name="country" value="${esc(a.country || state.config.defaultCountry)}" required></div>
      <div class="field"><label for="ad-label">Label (Home, Work...)</label><input id="ad-label" name="label" value="${esc(a.label || '')}"></div>
      <label class="check full"><input type="checkbox" name="isDefault" ${a.is_default ? 'checked' : ''}> Make this my default address</label></div>
      <p class="form-error" id="ad-error" role="alert"></p><div class="row"><button class="btn">${a.id ? 'Save address' : 'Add address'}</button>${a.id ? '<button type="button" class="btn btn-outline" id="ad-cancel">Cancel</button>' : ''}</div></form></div>`;
  content.onclick = async (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) { editing = JSON.parse(edit.dataset.edit); addresses(); }
    if (e.target.id === 'ad-cancel') { editing = null; addresses(); }
    if (del && confirm('Delete this address?')) { await api(`/addresses/${del.dataset.del}`, { method: 'DELETE' }); addresses(); }
  };
  $('#addr-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.isDefault = e.target.isDefault.checked;
    try {
      await api(a.id ? `/addresses/${a.id}` : '/addresses', { method: a.id ? 'PUT' : 'POST', body });
      editing = null;
      toast('Address saved');
      addresses();
    } catch (err) { $('#ad-error').textContent = err.message; }
  });
}

async function wishlist() {
  const { items } = await api('/wishlist');
  content.innerHTML = items.length ? `<div class="grid-products">${items.map(productCard).join('')}</div>` : '<div class="empty"><h2>Your wishlist is empty</h2><p>Tap the heart on any product to save it here.</p><a class="btn" href="/">Browse products</a></div>';
}

content.onclick = null;
bindProductActions(content);
content.addEventListener('wishlist:changed', () => { if (location.hash === '#wishlist') wishlist(); });

if (await initPage({ title: 'My account', requireAuth: true })) {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  show(location.hash.slice(1) || 'orders');
}
