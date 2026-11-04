import { api } from './api.js';
import { formatMoney } from './money.js';
import { initPage, state, $, $$, esc, imgSrc, label, fmtDate, fmtDateTime, toast } from './ui.js';

const content = $('#content');
const STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'];
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const opts = (list, sel) => list.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`).join('');
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (err) { toast(err.message, 'error'); } };

async function categoryOptions() {
  const { categories } = await api('/categories');
  return categories.flatMap((c) => [[c.id, c.name], ...c.children.map((k) => [k.id, `${c.name} > ${k.name}`])]);
}

/* ------------------------------ Dashboard ------------------------------ */
async function dashboard() {
  const s = await api('/admin/stats');
  content.innerHTML = `<div class="stats">
      <div class="stat"><span class="muted">Revenue (paid)</span><b>${formatMoney(s.revenue)}</b></div>
      <div class="stat"><span class="muted">Paid orders</span><b>${s.paidOrders}</b></div>
      <div class="stat"><span class="muted">Customers</span><b>${s.customers}</b></div>
      <div class="stat"><span class="muted">Active products</span><b>${s.products}</b></div>
      <div class="stat"><span class="muted">Low stock (&le; ${s.lowStockThreshold})</span><b style="color:${s.lowStock ? 'var(--sale)' : 'inherit'}">${s.lowStock}</b></div></div>
    <div class="panel"><div class="row between"><h2>Sales report</h2>
      <form class="row" id="report-form"><label>From <input type="date" name="from" value="${daysAgo(29)}"></label><label>To <input type="date" name="to" value="${today()}"></label>
        <button class="btn btn-sm">Update</button><a class="btn btn-sm btn-outline" id="csv" href="#">Download CSV</a></form></div>
      <div id="report"></div></div>
    <div class="panel"><h2>Orders by status</h2><div class="row">${s.byStatus.map((x) => `<span class="status ${x.status}">${label(x.status)}: ${x.n}</span>`).join('') || '<span class="muted">No orders yet</span>'}</div></div>
    <div class="panel"><h2>Recent orders</h2>${simpleTable(['Order', 'Customer', 'Date', 'Status', 'Total'], s.recent.map((o) => [esc(o.order_number), esc(o.customer_name), fmtDate(o.created_at), `<span class="status ${o.status}">${label(o.status)}</span>`, formatMoney(o.total)]))}</div>`;
  const form = $('#report-form');
  const run = safe(async () => {
    const q = `from=${form.from.value}&to=${form.to.value}`;
    $('#csv').href = `/api/admin/reports/sales?${q}&format=csv`;
    const r = await api(`/admin/reports/sales?${q}`);
    const max = Math.max(1, ...r.daily.map((d) => Number(d.revenue)));
    $('#report').innerHTML = `<p><strong>${formatMoney(r.totals.revenue)}</strong> from ${r.totals.orders} paid orders</p>
      ${r.daily.length ? `<div class="bars" role="img" aria-label="Daily revenue">${r.daily.map((d) => `<div title="${d.day}: ${formatMoney(d.revenue)}" style="height:${Math.max(2, (Number(d.revenue) / max) * 100)}%"></div>`).join('')}</div>` : '<p class="muted">No paid orders in this period.</p>'}
      ${r.top.length ? `<h3>Top products</h3>${simpleTable(['Product', 'Units', 'Revenue'], r.top.map((t) => [esc(t.name), t.units, formatMoney(t.revenue)]))}` : ''}`;
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  run();
}

function simpleTable(head, rows) {
  if (!rows.length) return '<p class="muted">Nothing to show yet.</p>';
  return `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ------------------------------ Orders ------------------------------ */
async function orders() {
  content.innerHTML = `<form class="row" id="o-filter" style="margin-bottom:14px"><select name="status" aria-label="Status"><option value="">All statuses</option>${opts(STATUSES.map((s) => [s, label(s)]))}</select>
    <input name="q" placeholder="Order number, name or email" style="max-width:300px" aria-label="Search orders"><button class="btn btn-sm">Filter</button></form>
    <div id="o-list"></div><div id="o-detail"></div>`;
  const list = safe(async () => {
    const f = $('#o-filter');
    const { orders: rows } = await api(`/admin/orders?status=${encodeURIComponent(f.status.value)}&q=${encodeURIComponent(f.q.value)}`);
    $('#o-list').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th>Status</th><th>Payment</th><th class="num">Total</th><th></th></tr></thead><tbody>
      ${rows.map((o) => `<tr><td><strong>${esc(o.order_number)}</strong></td><td>${esc(o.customer_name)}<br><span class="muted small">${esc(o.customer_email)}</span></td><td>${fmtDate(o.created_at)}</td>
        <td><span class="status ${o.status}">${label(o.status)}</span></td><td>${label(o.payment_method)}<br><span class="status ${o.payment_status}">${label(o.payment_status)}</span></td><td class="num">${formatMoney(o.total)}</td><td><button class="btn btn-sm" data-open="${o.id}">Manage</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No orders found.</p>';
  });
  $('#o-filter').addEventListener('submit', (e) => { e.preventDefault(); list(); });
  $('#o-list').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) openOrder(b.dataset.open); });
  list();
}

const openOrder = safe(async (id) => {
  const { order: o } = await api(`/admin/orders/${id}`);
  const box = $('#o-detail');
  box.innerHTML = `<div class="panel" style="margin-top:18px"><div class="row between"><h2>Order ${esc(o.order_number)}</h2><span class="muted">${fmtDateTime(o.created_at)}</span></div>
    <div class="shop-layout" style="grid-template-columns:1fr 1fr">
      <div><h3>Items</h3>${o.items.map((i) => `<div class="row"><img class="thumb" src="${imgSrc(i.image)}" alt=""><span>${esc(i.name)} &times; ${i.quantity}</span><strong style="margin-left:auto">${formatMoney(i.price * i.quantity)}</strong></div>`).join('')}
        <p style="margin-top:10px">Subtotal ${formatMoney(o.subtotal)} &middot; Discount ${formatMoney(o.discount)} &middot; Shipping ${formatMoney(o.shipping)}<br><strong>Total ${formatMoney(o.total)}</strong> (${label(o.payment_method)}, ${label(o.payment_status)})</p>
        <h3>Ship to</h3><p>${esc(o.ship_name)}, ${esc(o.ship_phone)}<br>${esc(o.ship_line1)} ${esc(o.ship_line2 || '')}<br>${esc(o.ship_city)} ${esc(o.ship_region || '')} ${esc(o.ship_postal_code || '')}, ${esc(o.ship_country)}</p></div>
      <form id="status-form"><h3>Update order</h3>
        <div class="field"><label for="st">Status</label><select id="st" name="status">${opts(STATUSES.map((s) => [s, label(s)]), o.status)}</select></div>
        <div class="field"><label for="trk">Tracking number</label><input id="trk" name="trackingNumber" value="${esc(o.tracking_number || '')}"></div>
        <div class="field"><label for="nt">Note for the history (optional)</label><input id="nt" name="note"></div>
        <div class="row"><button class="btn">Save and email customer</button>${o.payment_status !== 'paid' && o.status !== 'cancelled' ? '<button type="button" class="btn btn-outline" id="mark-paid">Mark as paid</button>' : ''}</div>
        <h3 style="margin-top:16px">History</h3><ul class="history">${o.history.map((h) => `<li><strong>${label(h.status)}</strong>${h.note ? ` - ${esc(h.note)}` : ''} <span class="muted small">${fmtDateTime(h.created_at)}</span></li>`).join('')}</ul></form></div></div>`;
  box.scrollIntoView({ behavior: 'smooth' });
  $('#status-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    await api(`/admin/orders/${id}/status`, { method: 'PUT', body });
    toast('Order updated');
    orders();
    setTimeout(() => openOrder(id), 100);
  }));
  $('#mark-paid')?.addEventListener('click', safe(async () => {
    if (!confirm('Confirm that you received this payment?')) return;
    await api(`/admin/orders/${id}/mark-paid`, { method: 'POST' });
    toast('Marked as paid');
    openOrder(id);
  }));
});

/* ------------------------------ Products & stock ------------------------------ */
async function products() {
  const cats = await categoryOptions();
  content.innerHTML = `<div class="row between" style="margin-bottom:14px"><form class="row" id="p-filter"><input name="q" placeholder="Search products" aria-label="Search products" style="max-width:260px">
      <label class="check"><input type="checkbox" name="low"> Low stock only</label><button class="btn btn-sm">Filter</button></form><button class="btn" id="new-product">New product</button></div>
    <div id="p-form-box"></div><div id="p-list"></div>`;
  let threshold = 5;
  const list = safe(async () => {
    const f = $('#p-filter');
    const r = await api(`/admin/products?q=${encodeURIComponent(f.q.value)}&low=${f.low.checked ? 1 : 0}`);
    threshold = r.lowStockThreshold;
    window.__products = new Map(r.products.map((p) => [p.id, p]));
    $('#p-list').innerHTML = r.products.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Product</th><th>Category</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th><th></th></tr></thead><tbody>
      ${r.products.map((p) => `<tr><td><img class="thumb" src="${imgSrc(p.image)}" alt=""></td><td><strong>${esc(p.name)}</strong><br><span class="muted small">${esc(p.brand || '')}</span></td><td>${esc(p.category_name || '-')}</td><td class="num">${formatMoney(p.price)}</td>
        <td class="num" style="${p.stock <= threshold ? 'color:var(--sale);font-weight:700' : ''}">${p.stock}</td><td>${p.is_active ? '<span class="status paid">Active</span>' : '<span class="status cancelled">Archived</span>'}</td>
        <td><button class="btn btn-sm btn-outline" data-edit="${p.id}">Edit</button> ${p.is_active ? `<button class="btn btn-sm btn-outline" data-archive="${p.id}">Archive</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No products found.</p>';
  });
  const form = (p = {}) => {
    $('#p-form-box').innerHTML = `<form class="panel" id="p-form" enctype="multipart/form-data"><h2>${p.id ? 'Edit product' : 'New product'}</h2><div class="form-grid">
      <div class="field full"><label for="pf-name">Name</label><input id="pf-name" name="name" value="${esc(p.name || '')}" required></div>
      <div class="field"><label for="pf-brand">Brand</label><input id="pf-brand" name="brand" value="${esc(p.brand || '')}"></div>
      <div class="field"><label for="pf-cat">Category</label><select id="pf-cat" name="category_id"><option value="">None</option>${opts(cats, p.category_id)}</select></div>
      <div class="field"><label for="pf-price">Price</label><input id="pf-price" name="price" type="number" step="0.01" min="0" value="${p.price ?? ''}" required></div>
      <div class="field"><label for="pf-prev">Previous price (for the discount badge)</label><input id="pf-prev" name="previous_price" type="number" step="0.01" min="0" value="${p.previous_price ?? ''}"></div>
      <div class="field"><label for="pf-stock">Stock</label><input id="pf-stock" name="stock" type="number" min="0" step="1" value="${p.stock ?? 0}" required></div>
      <div class="field"><label for="pf-kw">Search keywords (comma separated)</label><input id="pf-kw" name="keywords" value="${esc(p.keywords || '')}"></div>
      <div class="field full"><label for="pf-desc">Description</label><textarea id="pf-desc" name="description">${esc(p.description || '')}</textarea></div>
      <div class="field"><label for="pf-img">Upload image (JPG, PNG or WebP, max 2 MB)</label><input id="pf-img" name="image" type="file" accept="image/jpeg,image/png,image/webp"></div>
      <div class="field"><label for="pf-path">...or existing image path</label><input id="pf-path" name="imagePath" value="${esc(p.image || '')}" placeholder="images/products/example.jpg"></div>
      <label class="check full"><input type="checkbox" name="active" ${p.is_active === 0 ? '' : 'checked'}> Visible in the shop</label></div>
      <p class="form-error" id="pf-error" role="alert"></p><div class="row"><button class="btn">${p.id ? 'Save changes' : 'Create product'}</button><button class="btn btn-outline" type="button" id="pf-cancel">Cancel</button></div></form>`;
    $('#p-form').scrollIntoView({ behavior: 'smooth' });
    $('#pf-cancel').onclick = () => { $('#p-form-box').innerHTML = ''; };
    $('#p-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const fd = new FormData();
      ['name', 'brand', 'category_id', 'price', 'previous_price', 'stock', 'keywords', 'description'].forEach((k) => fd.append(k, f[k].value));
      fd.append('is_active', f.active.checked ? '1' : '0');
      if (f.image.files[0]) fd.append('image', f.image.files[0]);
      else if (f.imagePath.value.trim()) fd.append('image', f.imagePath.value.trim());
      try {
        await api(p.id ? `/admin/products/${p.id}` : '/admin/products', { method: p.id ? 'PUT' : 'POST', form: fd });
        toast('Product saved');
        $('#p-form-box').innerHTML = '';
        list();
      } catch (err) { $('#pf-error').textContent = err.message; }
    });
  };
  $('#p-filter').addEventListener('submit', (e) => { e.preventDefault(); list(); });
  $('#new-product').onclick = () => form();
  $('#p-list').addEventListener('click', safe(async (e) => {
    const ed = e.target.closest('[data-edit]');
    const ar = e.target.closest('[data-archive]');
    if (ed) form(window.__products.get(Number(ed.dataset.edit)));
    if (ar && confirm('Archive this product? It will be hidden from the shop but kept in past orders.')) {
      await api(`/admin/products/${ar.dataset.archive}`, { method: 'DELETE' });
      list();
    }
  }));
  list();
}

/* ------------------------------ Categories ------------------------------ */
async function categories() {
  const { categories: tree } = await api('/categories');
  const flat = tree.flatMap((c) => [[c, null], ...c.children.map((k) => [k, c])]);
  content.innerHTML = `<div class="shop-layout" style="grid-template-columns:1fr 340px">
    <div>${simpleTable(['Category', 'Parent', ''], flat.map(([c, parent]) => [`${parent ? '&nbsp;&nbsp;&rdsh; ' : ''}<strong>${esc(c.name)}</strong>`, esc(parent?.name || '-'),
      `<button class="btn btn-sm btn-outline" data-rename="${c.id}" data-name="${esc(c.name)}" data-parent="${c.parent_id || ''}">Rename</button> <button class="btn btn-sm btn-outline" data-del="${c.id}">Delete</button>`]))}</div>
    <form class="panel" id="c-form"><h2>Add category</h2><div class="field"><label for="c-name">Name</label><input id="c-name" name="name" required></div>
      <div class="field"><label for="c-parent">Parent (optional)</label><select id="c-parent" name="parent_id"><option value="">None (top level)</option>${opts(tree.map((c) => [c.id, c.name]))}</select></div><button class="btn">Add category</button></form></div>`;
  $('#c-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await api('/admin/categories', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast('Category added');
    categories();
  }));
  content.onclick = safe(async (e) => {
    const re = e.target.closest('[data-rename]');
    const del = e.target.closest('[data-del]');
    if (re) {
      const name = prompt('New name', re.dataset.name);
      if (name) { await api(`/admin/categories/${re.dataset.rename}`, { method: 'PUT', body: { name, parent_id: re.dataset.parent || null } }); categories(); }
    }
    if (del && confirm('Delete this category? Its products stay in the shop without a category.')) { await api(`/admin/categories/${del.dataset.del}`, { method: 'DELETE' }); categories(); }
  });
}

/* ------------------------------ Customers ------------------------------ */
async function customers() {
  content.innerHTML = '<form class="row" id="cu-filter" style="margin-bottom:14px"><input name="q" placeholder="Name or email" aria-label="Search customers" style="max-width:300px"><button class="btn btn-sm">Search</button></form><div id="cu-list"></div>';
  const run = safe(async () => {
    const { customers: rows } = await api(`/admin/customers?q=${encodeURIComponent($('#cu-filter').q.value)}`);
    $('#cu-list').innerHTML = simpleTable(['Name', 'Email', 'Phone', 'Role', 'Joined', 'Orders', 'Spent'], rows.map((c) => [esc(c.name), esc(c.email), esc(c.phone || '-'), label(c.role), fmtDate(c.created_at), c.orders, formatMoney(c.spent)]));
  });
  $('#cu-filter').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  run();
}

/* ------------------------------ Coupons ------------------------------ */
async function coupons() {
  const { coupons: rows } = await api('/admin/coupons');
  content.innerHTML = `<div class="shop-layout" style="grid-template-columns:1fr 340px"><div>${simpleTable(['Code', 'Discount', 'Min order', 'Used', 'Expires', 'Status', ''],
    rows.map((c) => [`<strong>${esc(c.code)}</strong>`, c.type === 'percent' ? `${c.value}%` : formatMoney(c.value), formatMoney(c.min_order), `${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ''}`, c.expires_at || 'Never',
      c.is_active ? '<span class="status paid">Active</span>' : '<span class="status cancelled">Off</span>',
      `<button class="btn btn-sm btn-outline" data-toggle="${c.id}" data-active="${c.is_active}">${c.is_active ? 'Turn off' : 'Turn on'}</button> <button class="btn btn-sm btn-outline" data-del="${c.id}">Delete</button>`]))}</div>
    <form class="panel" id="cp-form"><h2>New coupon</h2>
      <div class="field"><label for="cp-code">Code</label><input id="cp-code" name="code" required></div>
      <div class="field"><label for="cp-type">Type</label><select id="cp-type" name="type"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></div>
      <div class="field"><label for="cp-val">Value</label><input id="cp-val" name="value" type="number" step="0.01" min="0.01" required></div>
      <div class="field"><label for="cp-min">Minimum order</label><input id="cp-min" name="min_order" type="number" step="0.01" min="0" value="0"></div>
      <div class="field"><label for="cp-max">Max uses (optional)</label><input id="cp-max" name="max_uses" type="number" min="1"></div>
      <div class="field"><label for="cp-exp">Expires (optional)</label><input id="cp-exp" name="expires_at" type="date"></div>
      <p class="form-error" id="cp-error" role="alert"></p><button class="btn">Create coupon</button></form></div>`;
  $('#cp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/admin/coupons', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Coupon created'); coupons(); }
    catch (err) { $('#cp-error').textContent = err.message; }
  });
  content.onclick = safe(async (e) => {
    const t = e.target.closest('[data-toggle]');
    const d = e.target.closest('[data-del]');
    if (t) {
      const c = rows.find((x) => x.id === Number(t.dataset.toggle));
      await api(`/admin/coupons/${c.id}`, { method: 'PUT', body: { ...c, is_active: c.is_active ? 0 : 1 } });
      coupons();
    }
    if (d && confirm('Delete this coupon?')) { await api(`/admin/coupons/${d.dataset.del}`, { method: 'DELETE' }); coupons(); }
  });
}

/* ------------------------------ Support ------------------------------ */
async function support() {
  const { tickets } = await api('/admin/support');
  content.innerHTML = tickets.length ? tickets.map((t) => `<div class="panel"><div class="row between"><strong>${esc(t.subject)}</strong><span class="status ${t.status === 'open' ? 'pending' : 'delivered'}">${label(t.status)}</span></div>
      <p class="muted small">${esc(t.name)} &lt;<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>&gt; &middot; ${fmtDateTime(t.created_at)}</p><p style="white-space:pre-wrap">${esc(t.message)}</p>
      <button class="btn btn-sm btn-outline" data-id="${t.id}" data-status="${t.status === 'open' ? 'closed' : 'open'}">${t.status === 'open' ? 'Mark as closed' : 'Reopen'}</button></div>`).join('') : '<div class="empty">No support messages.</div>';
  content.onclick = safe(async (e) => {
    const b = e.target.closest('[data-id]');
    if (b) { await api(`/admin/support/${b.dataset.id}`, { method: 'PUT', body: { status: b.dataset.status } }); support(); }
  });
}

/* ------------------------------ Newsletter ------------------------------ */
async function newsletter() {
  const { subscribers } = await api('/admin/newsletter');
  content.innerHTML = `<form class="panel" id="nl-form" style="max-width:640px"><h2>Send a newsletter</h2><p class="muted">${subscribers} subscriber${subscribers === 1 ? '' : 's'}. Each email includes an unsubscribe link.</p>
    <div class="field"><label for="nl-s">Subject</label><input id="nl-s" name="subject" required></div>
    <div class="field"><label for="nl-b">Message</label><textarea id="nl-b" name="body" required></textarea></div>
    <button class="btn" ${subscribers ? '' : 'disabled'}>Send to all subscribers</button></form>`;
  $('#nl-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    if (!confirm(`Send this email to ${subscribers} subscribers?`)) return;
    const r = await api('/admin/newsletter/send', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast(`Sent ${r.sent} of ${r.recipients}${r.note ? ` (${r.note})` : ''}`);
  }));
}

const views = { dashboard, orders, products, categories, customers, coupons, support, newsletter };
function show(name) {
  if (!views[name]) name = 'dashboard';
  content.onclick = null;
  $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  history.replaceState(null, '', `#${name}`);
  content.innerHTML = '<p class="muted">Loading...</p>';
  views[name]().catch((err) => { content.innerHTML = `<div class="notice error">${esc(err.message)}</div>`; });
}

if (await initPage({ title: 'Admin', requireAdmin: true })) {
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); });
  show(location.hash.slice(1) || 'dashboard');
  void state;
}
