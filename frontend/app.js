/* SmartStock AI - frontend (plain JavaScript + Chart.js) */
const API = '/api';
const $ = s => document.querySelector(s);
const state = { token: localStorage.getItem('ss_token'), user: JSON.parse(localStorage.getItem('ss_user') || 'null'),
                products: [], suppliers: [], categories: [], charts: {}, registering: false };

// ---------- helpers ----------
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const isAdmin = () => state.user?.role === 'admin';

async function api(path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); throw new Error(data.error || 'Please log in'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
function chart(id, cfg) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart($('#' + id), { ...cfg, options: { responsive: true, maintainAspectRatio: true, ...(cfg.options || {}) } });
}
const badge = p => p.quantity === 0 ? '<span class="badge out">Out</span>'
  : p.quantity <= p.reorder_level ? '<span class="badge low">Low</span>' : '<span class="badge ok">OK</span>';
const synTag = p => p.is_synthetic ? '<span class="tag-syn">demo</span>' : '';
const options = (list, label = 'name', sel) => list.map(x => `<option value="${x.id}" ${x.id == sel ? 'selected' : ''}>${esc(x[label])}</option>`).join('');

// ---------- auth ----------
function showApp() {
  const on = !!state.token;
  $('#auth-view').hidden = on; $('#app-view').hidden = !on;
  if (on) { $('#who').textContent = `${state.user.name} (${state.user.role})`; loadLookups().then(() => openTab('dashboard')); }
}
function logout() {
  state.token = null; state.user = null; localStorage.removeItem('ss_token'); localStorage.removeItem('ss_user'); showApp();
}
function setAuthMode(reg) {
  state.registering = reg;
  $('#name-row').hidden = !reg; $('#auth-submit').textContent = reg ? 'Register' : 'Log in';
  $('#auth-toggle').textContent = reg ? 'Have an account? Log in' : 'Need an account? Register';
  $('#auth-error').textContent = '';
}
$('#auth-toggle').onclick = e => { e.preventDefault(); setAuthMode(!state.registering); };
$('#auth-form').onsubmit = async e => {
  e.preventDefault();
  try {
    const body = { email: $('#a-email').value, password: $('#a-pass').value };
    if (state.registering) body.name = $('#a-name').value;
    const d = await api(state.registering ? '/auth/register' : '/auth/login', 'POST', body);
    state.token = d.token; state.user = d.user;
    localStorage.setItem('ss_token', d.token); localStorage.setItem('ss_user', JSON.stringify(d.user));
    $('#a-pass').value = ''; showApp();
  } catch (err) { $('#auth-error').textContent = err.message; }
};
$('#logout').onclick = () => { api('/auth/logout', 'POST').catch(() => {}); logout(); };

// ---------- navigation ----------
const loaders = { dashboard: loadDashboard, products: loadProducts, sales: loadSales, suppliers: loadSuppliers,
                  purchases: loadPurchases, alerts: loadAlerts, forecast: loadForecastTab };
function openTab(name) {
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
  document.querySelectorAll('main > section').forEach(s => (s.hidden = s.id !== 'tab-' + name));
  guard(loaders[name])();
}
$('#nav').onclick = e => { if (e.target.dataset.tab) openTab(e.target.dataset.tab); };

async function loadLookups() {
  [state.products, state.suppliers, state.categories] = await Promise.all([api('/products'), api('/suppliers'), api('/products/categories')]);
}

// ---------- modal ----------
function modal(title, bodyHtml, onSave) {
  $('#modal-title').textContent = title; $('#modal-body').innerHTML = bodyHtml; $('#modal-error').textContent = '';
  $('#modal').showModal();
  $('#modal-form').onsubmit = async e => {
    e.preventDefault();
    try { await onSave(); $('#modal').close(); } catch (err) { $('#modal-error').textContent = err.message; }
  };
}
$('#modal-cancel').onclick = () => $('#modal').close();

// ---------- dashboard ----------
async function loadDashboard() {
  const d = await api('/alerts/dashboard');
  $('#stats').innerHTML = [
    ['Products', d.products], ['Stock value', money(d.stock_value)],
    ['Low stock', d.low_count || 0], ['Out of stock', d.out_count || 0],
    [`Sales on ${d.latest_sale_date || '—'}`, money(d.latest_day_sales.revenue)],
  ].map(([l, v]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  chart('chart-top', { type: 'bar', data: { labels: d.top_products_30d.map(t => t.name),
    datasets: [{ label: 'Units', data: d.top_products_30d.map(t => Number(t.units)), backgroundColor: '#0f766e' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } } });
  const daily = await api('/sales/summary?period=daily');
  chart('chart-daily', { type: 'line', data: { labels: daily.map(r => r.label),
    datasets: [{ label: 'Revenue (₹)', data: daily.map(r => Number(r.revenue)), borderColor: '#0f766e', tension: .25, fill: false }] } });
  await drawSummary();
}
async function drawSummary() {
  const period = $('#period').value, rows = await api('/sales/summary?period=' + period);
  chart('chart-summary', { type: 'bar', data: { labels: rows.map(r => r.label), datasets: [
    { label: 'Revenue (₹)', data: rows.map(r => Number(r.revenue)), backgroundColor: '#14b8a6' }] } });
}
$('#period').onchange = guard(drawSummary);

// ---------- products ----------
async function loadProducts() {
  await loadLookups();
  const cat = $('#p-cat'), keep = cat.value;
  cat.innerHTML = '<option value="">All categories</option>' + options(state.categories); cat.value = keep;
  const qs = new URLSearchParams({ q: $('#p-q').value, category_id: cat.value, status: $('#p-status').value });
  [...qs].forEach(([k, v]) => !v && qs.delete(k));
  const rows = await api('/products?' + qs);
  $('#p-table').innerHTML = `<tr><th>SKU</th><th>Name</th><th>Category</th><th>Supplier</th><th class="num">Price</th>
    <th class="num">Stock</th><th class="num">Reorder at</th><th>Status</th><th></th></tr>` +
    rows.map(p => `<tr><td>${esc(p.sku)}</td><td>${esc(p.name)}${synTag(p)}</td><td>${esc(p.category || '—')}</td>
      <td>${esc(p.supplier || '—')}</td><td class="num">${money(p.price)}</td><td class="num">${p.quantity}</td>
      <td class="num">${p.reorder_level}</td><td>${badge(p)}</td>
      <td><button class="btn small" data-edit="${p.id}">Edit</button>
          <button class="btn small" data-adj="${p.id}">Adjust</button>
          ${isAdmin() ? `<button class="btn small danger" data-del="${p.id}">Delete</button>` : ''}</td></tr>`).join('')
    || '<tr><td>No products found.</td></tr>';
  state.shown = rows;
}
['#p-q', '#p-cat', '#p-status'].forEach(s => ($(s).oninput = guard(loadProducts)));
$('#p-table').onclick = guard(async e => {
  const t = e.target, id = t.dataset.edit || t.dataset.adj || t.dataset.del;
  if (!id) return;
  const p = state.shown.find(x => x.id == id);
  if (t.dataset.edit) productForm(p);
  if (t.dataset.adj) {
    modal(`Adjust stock: ${p.name}`, `<label class="full">Change (use − to remove, e.g. -3)<input id="adj" type="number" required></label>`,
      async () => { await api(`/products/${id}/adjust`, 'POST', { change: $('#adj').value }); toast('Stock adjusted'); loadProducts(); });
  }
  if (t.dataset.del && confirm(`Delete "${p.name}" and its sales history?`)) { await api('/products/' + id, 'DELETE'); toast('Deleted'); loadProducts(); }
});
$('#add-product').onclick = () => productForm();
function productForm(p) {
  const v = p || { sku: '', name: '', price: '', quantity: 0, reorder_level: 10, lead_time_days: 3, description: '' };
  modal(p ? 'Edit product' : 'Add product', `
    <label>SKU<input id="f-sku" required value="${esc(v.sku)}"></label>
    <label>Name<input id="f-name" required value="${esc(v.name)}"></label>
    <label>Category<select id="f-cat"><option value="">—</option>${options(state.categories, 'name', v.category_id)}</select></label>
    <label>Supplier<select id="f-sup"><option value="">—</option>${options(state.suppliers, 'name', v.supplier_id)}</select></label>
    <label>Price (₹)<input id="f-price" type="number" min="0" step="0.01" required value="${esc(v.price)}"></label>
    ${p ? '' : `<label>Opening quantity<input id="f-qty" type="number" min="0" value="0"></label>`}
    <label>Reorder level<input id="f-rl" type="number" min="0" value="${esc(v.reorder_level)}"></label>
    <label>Supplier lead time (days)<input id="f-lt" type="number" min="1" value="${esc(v.lead_time_days)}"></label>
    <label class="full">Description<textarea id="f-desc" rows="2">${esc(v.description)}</textarea></label>
    <label class="full">New category? <input id="f-newcat" placeholder="Type a name to create it"></label>`,
    async () => {
      let category_id = $('#f-cat').value;
      const nc = $('#f-newcat').value.trim();
      if (nc) category_id = (await api('/products/categories', 'POST', { name: nc })).id;
      const body = { sku: $('#f-sku').value, name: $('#f-name').value, category_id, supplier_id: $('#f-sup').value,
        price: $('#f-price').value, reorder_level: $('#f-rl').value, lead_time_days: $('#f-lt').value, description: $('#f-desc').value };
      if (!p) body.quantity = $('#f-qty').value;
      await api(p ? '/products/' + p.id : '/products', p ? 'PUT' : 'POST', body);
      toast(p ? 'Product updated' : 'Product added'); loadProducts();
    });
}

// ---------- sales ----------
async function loadSales() {
  await loadLookups();
  $('#s-product').innerHTML = state.products.map(p => `<option value="${p.id}">${esc(p.name)} (${p.quantity} in stock)</option>`).join('');
  $('#s-date').value ||= today();
  const rows = await api('/sales?limit=50');
  $('#s-table').innerHTML = `<tr><th>Date</th><th>Product</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Total</th></tr>` +
    rows.map(r => `<tr><td>${esc(r.sale_date)}</td><td>${esc(r.product)}${synTag(r)}</td><td class="num">${r.quantity}</td>
      <td class="num">${money(r.unit_price)}</td><td class="num">${money(r.total_amount)}</td></tr>`).join('');
}
$('#sale-form').onsubmit = guard(async e => {
  e.preventDefault();
  const d = await api('/sales', 'POST', { product_id: $('#s-product').value, quantity: $('#s-qty').value, sale_date: $('#s-date').value });
  toast(`Sale recorded: ${money(d.total_amount)}. ${d.quantity_left} left in stock.`); $('#s-qty').value = ''; loadSales();
});

// ---------- suppliers ----------
async function loadSuppliers() {
  await loadLookups();
  $('#sup-table').innerHTML = `<tr><th>Name</th><th>Contact</th><th>Phone</th><th>Email</th><th class="num">Products</th><th></th></tr>` +
    state.suppliers.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.contact || '—')}</td><td>${esc(s.phone || '—')}</td>
      <td>${esc(s.email || '—')}</td><td class="num">${s.product_count}</td>
      <td><button class="btn small" data-edit="${s.id}">Edit</button>
      ${isAdmin() ? `<button class="btn small danger" data-del="${s.id}">Delete</button>` : ''}</td></tr>`).join('');
}
$('#sup-table').onclick = guard(async e => {
  const id = e.target.dataset.edit || e.target.dataset.del; if (!id) return;
  const s = state.suppliers.find(x => x.id == id);
  if (e.target.dataset.edit) supplierForm(s);
  else if (confirm(`Delete supplier "${s.name}"?`)) { await api('/suppliers/' + id, 'DELETE'); toast('Deleted'); loadSuppliers(); }
});
$('#add-supplier').onclick = () => supplierForm();
function supplierForm(s) {
  const v = s || { name: '', contact: '', phone: '', email: '', address: '' };
  modal(s ? 'Edit supplier' : 'Add supplier', `
    <label class="full">Name<input id="sf-name" required value="${esc(v.name)}"></label>
    <label>Contact person<input id="sf-contact" value="${esc(v.contact)}"></label>
    <label>Phone<input id="sf-phone" value="${esc(v.phone)}"></label>
    <label class="full">Email<input id="sf-email" type="email" value="${esc(v.email)}"></label>
    <label class="full">Address<input id="sf-addr" value="${esc(v.address)}"></label>`,
    async () => {
      const body = { name: $('#sf-name').value, contact: $('#sf-contact').value, phone: $('#sf-phone').value,
                     email: $('#sf-email').value, address: $('#sf-addr').value };
      await api(s ? '/suppliers/' + s.id : '/suppliers', s ? 'PUT' : 'POST', body);
      toast('Supplier saved'); loadSuppliers();
    });
}

// ---------- purchases ----------
async function loadPurchases() {
  await loadLookups();
  $('#pu-supplier').innerHTML = options(state.suppliers);
  $('#pu-product').innerHTML = options(state.products);
  $('#pu-date').value ||= today();
  const rows = await api('/purchases?limit=50');
  $('#pu-table').innerHTML = `<tr><th>Date</th><th>Supplier</th><th>Product</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Total</th></tr>` +
    rows.map(r => `<tr><td>${esc(r.purchase_date)}</td><td>${esc(r.supplier)}</td><td>${esc(r.product)}</td>
      <td class="num">${r.quantity}</td><td class="num">${money(r.unit_cost)}</td><td class="num">${money(r.total_cost)}</td></tr>`).join('')
    || '<tr><td>No purchases recorded yet.</td></tr>';
}
$('#purchase-form').onsubmit = guard(async e => {
  e.preventDefault();
  const d = await api('/purchases', 'POST', { supplier_id: $('#pu-supplier').value, product_id: $('#pu-product').value,
    quantity: $('#pu-qty').value, unit_cost: $('#pu-cost').value, purchase_date: $('#pu-date').value });
  toast(`Purchase recorded. Stock is now ${d.quantity_now}.`); $('#pu-qty').value = ''; loadPurchases();
});

// ---------- alerts ----------
async function loadAlerts() {
  const [alerts, moves] = await Promise.all([api('/alerts'), api('/alerts/movements?limit=30')]);
  $('#alerts-basic').innerHTML = alerts.length ? `<table><tr><th>Product</th><th>Level</th><th class="num">Stock</th><th class="num">Reorder at</th><th>Supplier</th></tr>` +
    alerts.map(a => `<tr><td>${esc(a.name)}</td><td><span class="badge ${a.level}">${a.level === 'out' ? 'Out of stock' : 'Low stock'}</span></td>
      <td class="num">${a.quantity}</td><td class="num">${a.reorder_level}</td><td>${esc(a.supplier || '—')}</td></tr>`).join('') + '</table>'
    : '<p class="muted">Nothing below its reorder level.</p>';
  $('#mv-table').innerHTML = `<tr><th>When</th><th>Product</th><th>Reason</th><th class="num">Change</th><th class="num">Balance</th></tr>` +
    moves.map(m => `<tr><td>${esc(m.created_at)}</td><td>${esc(m.product)}</td><td>${esc(m.reason)}</td>
      <td class="num">${m.change_qty > 0 ? '+' : ''}${m.change_qty}</td><td class="num">${m.balance_after}</td></tr>`).join('');
}
$('#load-risk').onclick = guard(async () => {
  $('#alerts-risk').textContent = 'Forecasting…';
  const rows = await api('/forecast/stockout-risk?days=14');
  $('#alerts-risk').innerHTML = rows.length ? `<table><tr><th>Product</th><th class="num">Stock</th><th>Predicted stockout</th><th class="num">Suggested reorder</th></tr>` +
    rows.map(r => `<tr><td>${esc(r.product)}</td><td class="num">${r.quantity}</td><td>${esc(r.predicted_stockout_date)}</td><td class="num">${r.suggested_reorder_qty}</td></tr>`).join('') + '</table>'
    : 'No product is predicted to run out in the next 14 days.';
});

// ---------- forecast ----------
async function loadForecastTab() {
  await loadLookups();
  $('#f-product').innerHTML = options(state.products);
  api('/forecast/model-metrics').then(m => {
    $('#metrics').innerHTML = `<p class="small">${esc(m.data_note)}</p><table><tr><th>Model</th><th class="num">MAE</th><th class="num">RMSE</th></tr>` +
      m.summary.map(r => `<tr><td>${esc(r.model)}</td><td class="num">${r.MAE}</td><td class="num">${r.RMSE}</td></tr>`).join('') + '</table>';
  }).catch(e => ($('#metrics').textContent = e.message));
}
$('#f-run').onclick = guard(async () => {
  $('#f-result').innerHTML = '<div class="card muted">Forecasting…</div>';
  try {
    const f = await api(`/forecast/${$('#f-product').value}?days=${$('#f-days').value}`);
    $('#f-result').innerHTML = `<div class="stats">
      <div class="stat"><div class="v">${f.total_forecast_qty}</div><div class="l">Units expected in ${f.horizon_days} days</div></div>
      <div class="stat"><div class="v">${esc(f.predicted_stockout_date || 'None')}</div><div class="l">Predicted stockout (stock: ${f.product.quantity})</div></div>
      <div class="stat"><div class="v">${f.suggested_reorder_qty}</div><div class="l">Suggested reorder qty</div></div>
      <div class="stat"><div class="v">${f.holdout_rmse}</div><div class="l">Model error (RMSE, units/day)</div></div></div>
      <div class="card"><h3>${esc(f.product.name)}: last 30 days and forecast</h3><canvas id="chart-forecast"></canvas>
      <p class="muted small">Method: ${esc(f.method)}. Reorder suggestion = forecast demand + safety stock (≈95% service level) − current stock. It is a decision aid, not a guarantee.</p></div>`;
    const hist = f.recent_history, fc = f.forecast;
    const labels = [...hist.map(h => h.date), ...fc.map(x => x.date)];
    chart('chart-forecast', { type: 'line', data: { labels, datasets: [
      { label: 'Actual', data: [...hist.map(h => h.qty), ...fc.map(() => null)], borderColor: '#1d2733', tension: .2 },
      { label: 'Forecast', data: [...hist.map(() => null), ...fc.map(x => x.predicted_qty)], borderColor: '#0f766e', borderDash: [6, 4], tension: .2 }] } });
  } catch (e) { $('#f-result').innerHTML = `<div class="card error">${esc(e.message)}</div>`; }
});

setAuthMode(false);
showApp();
