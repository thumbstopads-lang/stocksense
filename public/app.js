/* StockSense front-end — plain fetch-based SPA. */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  token: localStorage.getItem('stocksense_token') || null,
  settings: null,
  categories: [],
  suppliers: [],
};

function fmtMoney(n) {
  const cur = state.settings?.currency || 'INR';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n || 0); }
  catch { return `${cur} ${n || 0}`; }
}
function fmtDate(s) {
  if (!s) return '—';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleString();
}

// ---------- API ----------
async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) { logout(); throw new Error('Session expired — please log in again.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- UI helpers ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
// Surface unexpected JS errors visibly instead of failing silently.
window.addEventListener('error', (e) => toast('Something went wrong: ' + (e.message || 'unknown error')));
window.addEventListener('unhandledrejection', (e) => {
  const m = e.reason && e.reason.message ? e.reason.message : String(e.reason || 'unknown error');
  if (!/Session expired/.test(m)) toast('Request failed: ' + m);
});
function statusTag(s) {
  const label = { ok: 'In stock', low: 'Low', out: 'Out' }[s] || s;
  return `<span class="tag ${s}">${label}</span>`;
}
function openModal(title, bodyHTML, actions) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHTML;
  const box = $('modal-actions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.type = a.type || 'button';
    b.className = 'btn ' + (a.cls || 'ghost');
    b.textContent = a.label;
    b.onclick = a.onClick;
    box.appendChild(b);
  }
  $('modal-backdrop').classList.remove('hidden');
}
function closeModal() { $('modal-backdrop').classList.add('hidden'); }
$('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') closeModal(); });

// ---------- Auth ----------
function showAuth() {
  $('auth-view').classList.remove('hidden');
  $('app-view').classList.add('hidden');
}
function showApp() {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
}
function logout() {
  state.token = null;
  localStorage.removeItem('stocksense_token');
  showAuth();
}
$('tab-login').onclick = () => { $('tab-login').classList.add('active'); $('tab-register').classList.remove('active'); $('login-form').classList.remove('hidden'); $('register-form').classList.add('hidden'); };
$('tab-register').onclick = () => { $('tab-register').classList.add('active'); $('tab-login').classList.remove('active'); $('register-form').classList.remove('hidden'); $('login-form').classList.add('hidden'); };
function authError(msg) { const e = $('auth-error'); e.textContent = msg; e.classList.remove('hidden'); }
function friendlyAuthError(err) {
  const m = err && err.message ? err.message : String(err);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) {
    return 'Cannot reach the StockSense server. Make sure `node server.js` is running and you opened http://localhost:3000 (not the HTML file directly).';
  }
  return m;
}

// One-click demo logins — each opens its own business workspace.
const DEMO_CREDS = {
  'kirana@demo': 'kirana123',
  'pharmacy@demo': 'pharmacy123',
  'cafe@demo': 'cafe123',
  'salon@demo': 'salon123',
  'hardware@demo': 'hardware123',
};
document.querySelectorAll('[data-demo]').forEach((b) => {
  b.onclick = () => {
    const email = b.dataset.demo;
    $('tab-login').click();
    $('login-email').value = email;
    $('login-password').value = DEMO_CREDS[email] || '';
    $('auth-error').classList.add('hidden');
    $('login-form').requestSubmit();
  };
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').classList.add('hidden');
  try {
    const r = await api('POST', '/auth/login', { email: $('login-email').value, password: $('login-password').value });
    state.token = r.token;
    localStorage.setItem('stocksense_token', r.token);
    await boot();
  } catch (err) { authError(friendlyAuthError(err)); }
});
$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('auth-error').classList.add('hidden');
  try {
    const r = await api('POST', '/auth/register', {
      email: $('reg-email').value, password: $('reg-password').value, businessName: $('reg-business').value,
    });
    state.token = r.token;
    localStorage.setItem('stocksense_token', r.token);
    await boot();
  } catch (err) { authError(friendlyAuthError(err)); }
});
$('logout-btn').onclick = logout;

// ---------- Boot ----------
async function boot() {
  showApp();
  state.settings = await api('GET', '/settings');
  state.categories = await api('GET', '/categories');
  state.suppliers = await api('GET', '/suppliers');
  $('biz-name').textContent = state.settings.businessName || '';
  showView('dashboard');
}

// ---------- Navigation ----------
document.querySelectorAll('#main-nav button').forEach((b) => {
  b.onclick = () => showView(b.dataset.view);
});
function showView(name) {
  document.querySelectorAll('#main-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + name).classList.remove('hidden');
  ({ dashboard: loadDashboard, inventory: loadInventory, reorder: loadReorder, pos: loadPOs,
     suppliers: loadSuppliers, categories: loadCategories, history: loadHistory, settings: loadSettings })[name]();
}

function categoryOptions(selected) {
  return state.categories.map((c) => `<option value="${c.id}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
}
function supplierOptions(selected) {
  return state.suppliers.map((s) => `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
}
function poStatusBadge(s) {
  const label = { draft: 'Draft', ordered: 'Ordered', received: 'Received' }[s] || s;
  const cls = s === 'received' ? 'ok' : s === 'ordered' ? 'low' : 'out';
  return `<span class="tag ${cls}">${label}</span>`;
}
function movementRow(m) {
  const d = m.delta > 0 ? `<span class="delta-pos">+${m.delta}</span>` : `<span class="delta-neg">${m.delta}</span>`;
  return `<tr><td>${fmtDate(m.createdAt)}</td><td>${esc(m.itemName)}</td><td>${d}</td><td>${m.qtyAfter}</td><td>${esc(m.reason)}</td></tr>`;
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const d = await api('GET', '/dashboard');
  $('dash-stats').innerHTML = `
    <div class="stat"><b>${d.totalItems}</b><span>Total items</span></div>
    <div class="stat good"><b>${fmtMoney(d.totalValue)}</b><span>Stock value</span></div>
    <div class="stat ${d.lowCount ? 'warn' : ''}"><b>${d.lowCount}</b><span>Low stock</span></div>
    <div class="stat ${d.outCount ? 'bad' : ''}"><b>${d.outCount}</b><span>Out of stock</span></div>`;
  $('dash-movements').querySelector('tbody').innerHTML =
    d.recentMovements.map(movementRow).join('') || '<tr><td colspan="5" class="muted">No movements yet.</td></tr>';
}

// ---------- Inventory ----------
let invDebounce;
async function loadInventory() {
  const sel = $('inv-category');
  if (sel.options.length <= 1) sel.innerHTML = '<option value="">All categories</option>' + categoryOptions();
  const params = new URLSearchParams({
    q: $('inv-search').value.trim(),
    category: sel.value,
    status: $('inv-status').value,
    sort: $('inv-sort').value,
    order: $('inv-order').dataset.dir || 'asc',
  });
  const items = await api('GET', '/items?' + params);
  const cf = state.settings.customFields || [];
  $('inv-table').querySelector('tbody').innerHTML = items.map((i) => `
    <tr>
      <td><b>${esc(i.name)}</b>${cf.length ? `<br><small class="muted">${cf.map((f) => i.customFields[f.key] !== undefined ? `${esc(f.label)}: ${esc(i.customFields[f.key])}` : '').filter(Boolean).join(' · ')}</small>` : ''}</td>
      <td>${esc(i.sku)}</td>
      <td>${esc(i.categoryName || '—')}</td>
      <td><b>${i.qty}</b> ${esc(i.unit)}</td>
      <td>${i.reorderLevel}</td>
      <td>${statusTag(i.status)}</td>
      <td>${fmtMoney(i.costPrice)}</td>
      <td><div class="row-actions">
        <button class="btn small" data-act="adjust" data-id="${i.id}" type="button">± Adjust</button>
        <button class="btn small ghost" data-act="edit" data-id="${i.id}" type="button">Edit</button>
        <button class="btn small danger" data-act="del" data-id="${i.id}" type="button">Delete</button>
      </div></td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">No items match. Add your first item 👆</td></tr>';
}
['inv-search', 'inv-category', 'inv-status', 'inv-sort'].forEach((id) => {
  $(id).addEventListener('input', () => { clearTimeout(invDebounce); invDebounce = setTimeout(loadInventory, 250); });
});
$('inv-order').onclick = () => {
  const b = $('inv-order');
  b.dataset.dir = (b.dataset.dir || 'asc') === 'asc' ? 'desc' : 'asc';
  b.textContent = b.dataset.dir === 'asc' ? '↑' : '↓';
  loadInventory();
};
$('inv-table').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  const item = await api('GET', `/items/${id}`);
  if (b.dataset.act === 'adjust') adjustModal(item);
  else if (b.dataset.act === 'edit') itemModal(item);
  else if (b.dataset.act === 'del') {
    openModal('Delete item?', `<p>Delete <b>${esc(item.name)}</b>? This also removes its history and cannot be undone.</p>`, [
      { label: 'Cancel', onClick: closeModal },
      { label: 'Delete', cls: 'danger', onClick: async () => { await api('DELETE', `/items/${id}`); closeModal(); toast('Item deleted'); loadInventory(); } },
    ]);
  }
});

function itemModal(item) {
  const isNew = !item;
  const cf = state.settings.customFields || [];
  const cfRows = cf.map((f) => `
    <label>${esc(f.label)}
      <input name="cf_${esc(f.key)}" type="${f.type === 'number' ? 'number' : 'text'}" step="any"
        value="${esc(item?.customFields?.[f.key] ?? '')}">
    </label>`).join('');
  openModal(isNew ? 'Add item' : 'Edit item', `
    <form id="item-form" class="stack">
      <label>Name<input name="name" required value="${esc(item?.name || '')}"></label>
      <div class="grid2">
        <label>SKU<input name="sku" value="${esc(item?.sku || '')}"></label>
        <label>Unit<input name="unit" value="${esc(item?.unit || 'pcs')}"></label>
      </div>
      <div class="grid2">
        <label>Category<select name="categoryId"><option value="">— none —</option>${categoryOptions(item?.categoryId)}</select></label>
        <label>Supplier<select name="supplierId"><option value="">— none —</option>${supplierOptions(item?.supplierId)}</select></label>
      </div>
      <div class="grid2">
        ${isNew ? `<label>Opening qty<input name="qty" type="number" min="0" step="1" value="0"></label>` : ''}
        <label>Reorder level<input name="reorderLevel" type="number" min="0" step="1" value="${item?.reorderLevel ?? state.settings.defaultReorderLevel}"></label>
      </div>
      <label>Cost price (${esc(state.settings.currency)})<input name="costPrice" type="number" min="0" step="any" value="${item?.costPrice ?? 0}"></label>
      ${cfRows}
    </form>`, [
    { label: 'Cancel', onClick: closeModal },
    { label: isNew ? 'Add item' : 'Save', cls: 'primary', onClick: async () => {
      const f = $('item-form');
      const fd = new FormData(f);
      const customFields = {};
      for (const c of cf) customFields[c.key] = fd.get('cf_' + c.key) ?? '';
      const payload = {
        name: fd.get('name'), sku: fd.get('sku'), unit: fd.get('unit'),
        categoryId: fd.get('categoryId') || null, supplierId: fd.get('supplierId') || null,
        reorderLevel: Number(fd.get('reorderLevel')), costPrice: Number(fd.get('costPrice')),
        customFields,
      };
      if (isNew) payload.qty = Number(fd.get('qty')) || 0;
      try {
        if (isNew) await api('POST', '/items', payload);
        else await api('PUT', `/items/${item.id}`, payload);
        closeModal(); toast(isNew ? 'Item added' : 'Item updated'); loadInventory();
      } catch (err) { toast(err.message); }
    } },
  ]);
}
$('add-item-btn').onclick = () => itemModal(null);

function adjustModal(item) {
  openModal(`Adjust stock — ${item.name}`, `
    <form id="adjust-form" class="stack">
      <p class="muted">Current qty: <b>${item.qty}</b> ${esc(item.unit)}</p>
      <label>Change (+ in / − out)<input name="delta" type="number" step="1" required placeholder="e.g. 10 or -3"></label>
      <label>Reason<input name="reason" placeholder="e.g. Sale, damaged, recount" required></label>
    </form>`, [
    { label: 'Cancel', onClick: closeModal },
    { label: 'Apply', cls: 'primary', onClick: async () => {
      const f = $('adjust-form');
      const delta = Number(new FormData(f).get('delta'));
      const reason = new FormData(f).get('reason');
      try {
        await api('POST', `/items/${item.id}/adjust`, { delta, reason });
        closeModal(); toast('Stock adjusted'); loadInventory();
      } catch (err) { toast(err.message); }
    } },
  ]);
}

// ---------- Reorder ----------
async function loadReorder() {
  const low = await api('GET', '/items?status=low&sort=qty&order=asc');
  const out = await api('GET', '/items?status=out&sort=qty&order=asc');
  const items = [...out, ...low];
  $('reorder-table').querySelector('tbody').innerHTML = items.map((i) => `
    <tr>
      <td><input type="checkbox" data-rid="${i.id}" checked></td>
      <td><b>${esc(i.name)}</b><br>${statusTag(i.status)}</td>
      <td>${i.qty}</td>
      <td>${i.reorderLevel}</td>
      <td>${esc(i.supplierName || '—')}</td>
      <td><input type="number" min="1" step="1" data-rqty="${i.id}" value="${Math.max(1, i.reorderLevel * 2 - i.qty)}" style="width:90px"></td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing to reorder — all stocked up. 🎉</td></tr>';
  $('reorder-table').dataset.loaded = '1';
}
$('reorder-select-all').onclick = () => {
  const boxes = document.querySelectorAll('input[data-rid]');
  const all = [...boxes].every((b) => b.checked);
  boxes.forEach((b) => { b.checked = !all; });
};
$('reorder-create-po').onclick = () => poModal('reorder');

async function poModal(prefillMode) {
  let prefill = [];
  if (prefillMode === 'reorder') {
    prefill = [...document.querySelectorAll('input[data-rid]:checked')].map((box) => {
      const id = box.dataset.rid;
      const qtyInput = document.querySelector(`input[data-rqty="${id}"]`);
      return { itemId: Number(id), qty: Math.max(1, Number(qtyInput.value) || 1) };
    });
    if (!prefill.length) { toast('Select at least one item'); return; }
  }
  const items = await api('GET', '/items?sort=name&order=asc');
  const itemOptions = items.map((i) => `<option value="${i.id}">${esc(i.name)} (qty ${i.qty})</option>`).join('');
  const rowsHTML = (prefill.length ? prefill : [{ itemId: items[0]?.id, qty: 1 }]).map((l) => `
    <div class="grid2 po-line">
      <select class="po-item">${itemOptions}</select>
      <input class="po-qty" type="number" min="1" step="1" value="${l.qty}" style="width:100%">
    </div>`).join('');
  openModal('New purchase order', `
    <div class="stack">
      <label>Supplier<select id="po-supplier"><option value="">— none —</option>${supplierOptions()}</select></label>
      <div id="po-lines" class="stack">${rowsHTML}</div>
      <button id="po-add-line" class="btn ghost" type="button">+ Add line</button>
      <label>Notes<input id="po-notes" placeholder="Optional"></label>
    </div>`, [
    { label: 'Cancel', onClick: closeModal },
    { label: 'Create PO', cls: 'primary', onClick: async () => {
      const lines = [...document.querySelectorAll('.po-line')].map((r) => ({
        itemId: Number(r.querySelector('.po-item').value),
        qty: Number(r.querySelector('.po-qty').value),
      }));
      try {
        await api('POST', '/purchase-orders', {
          supplierId: $('po-supplier').value || null,
          notes: $('po-notes').value, items: lines,
        });
        closeModal(); toast('Purchase order created');
        if ($('view-pos').classList.contains('hidden')) showView('pos'); else loadPOs();
      } catch (err) { toast(err.message); }
    } },
  ]);
  // restore prefill selections
  const selects = document.querySelectorAll('#po-lines .po-item');
  prefill.forEach((l, idx) => { if (selects[idx]) selects[idx].value = String(l.itemId); });
  $('po-add-line').onclick = () => {
    const div = document.createElement('div');
    div.className = 'grid2 po-line';
    div.innerHTML = `<select class="po-item">${itemOptions}</select><input class="po-qty" type="number" min="1" step="1" value="1" style="width:100%">`;
    $('po-lines').appendChild(div);
  };
}
$('add-po-btn').onclick = () => poModal('blank');

// ---------- Purchase orders ----------
async function loadPOs() {
  const pos = await api('GET', '/purchase-orders');
  $('po-list').innerHTML = pos.map((p) => `
    <div class="card">
      <div class="card-head">
        <h3>PO #${p.id} ${poStatusBadge(p.status)}</h3>
        <div class="row-actions">
          ${p.status === 'draft' ? `<button class="btn small" data-po="ordered" data-id="${p.id}" type="button">Mark ordered</button>` : ''}
          ${p.status !== 'received' ? `<button class="btn small primary" data-po="received" data-id="${p.id}" type="button">Mark received</button>` : ''}
        </div>
      </div>
      <p class="muted">Supplier: ${esc(p.supplierName || '—')} · Created ${fmtDate(p.createdAt)}${p.notes ? ` · ${esc(p.notes)}` : ''}</p>
      <ul>${p.items.map((l) => `<li>${esc(l.itemName)} — qty ${l.qty}</li>`).join('')}</ul>
    </div>`).join('') || '<p class="muted">No purchase orders yet.</p>';
}
$('po-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-po]');
  if (!b) return;
  try {
    await api('PATCH', `/purchase-orders/${b.dataset.id}`, { status: b.dataset.po });
    toast(b.dataset.po === 'received' ? 'Stock received in' : 'PO marked ordered');
    loadPOs();
  } catch (err) { toast(err.message); }
});

// ---------- Suppliers ----------
async function loadSuppliers() {
  const list = await api('GET', '/suppliers');
  $('supplier-table').querySelector('tbody').innerHTML = list.map((s) => `
    <tr><td><b>${esc(s.name)}</b></td><td>${esc(s.phone)}</td><td>${esc(s.email)}</td><td>${esc(s.notes)}</td>
    <td><div class="row-actions">
      <button class="btn small ghost" data-sact="edit" data-id="${s.id}" type="button">Edit</button>
      <button class="btn small danger" data-sact="del" data-id="${s.id}" type="button">Delete</button>
    </div></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No suppliers yet.</td></tr>';
}
function supplierModal(s) {
  const isNew = !s;
  openModal(isNew ? 'Add supplier' : 'Edit supplier', `
    <form id="supplier-form" class="stack">
      <label>Name<input name="name" required value="${esc(s?.name || '')}"></label>
      <div class="grid2">
        <label>Phone<input name="phone" value="${esc(s?.phone || '')}"></label>
        <label>Email<input name="email" type="email" value="${esc(s?.email || '')}"></label>
      </div>
      <label>Notes<textarea name="notes" rows="2">${esc(s?.notes || '')}</textarea></label>
    </form>`, [
    { label: 'Cancel', onClick: closeModal },
    { label: isNew ? 'Add' : 'Save', cls: 'primary', onClick: async () => {
      const fd = new FormData($('supplier-form'));
      const payload = { name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), notes: fd.get('notes') };
      try {
        if (isNew) await api('POST', '/suppliers', payload);
        else await api('PUT', `/suppliers/${s.id}`, payload);
        closeModal(); toast(isNew ? 'Supplier added' : 'Supplier updated');
        state.suppliers = await api('GET', '/suppliers');
        loadSuppliers();
      } catch (err) { toast(err.message); }
    } },
  ]);
}
$('add-supplier-btn').onclick = () => supplierModal(null);
$('supplier-table').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-sact]');
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.sact === 'edit') {
    supplierModal(state.suppliers.find((s) => String(s.id) === String(id)));
  } else {
    openModal('Delete supplier?', '<p>Items linked to this supplier will keep their stock but lose the link.</p>', [
      { label: 'Cancel', onClick: closeModal },
      { label: 'Delete', cls: 'danger', onClick: async () => {
        await api('DELETE', `/suppliers/${id}`);
        closeModal(); toast('Supplier deleted');
        state.suppliers = await api('GET', '/suppliers');
        loadSuppliers();
      } },
    ]);
  }
});

// ---------- Categories ----------
async function loadCategories() {
  const list = await api('GET', '/categories');
  $('category-list').innerHTML = list.map((c) => `
    <span class="chip">${esc(c.name)}<button data-cdel="${c.id}" type="button" title="Delete">✕</button></span>`).join('')
    || '<p class="muted">No categories yet — add one above.</p>';
}
$('add-category-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/categories', { name: $('new-category-name').value });
    $('new-category-name').value = '';
    state.categories = await api('GET', '/categories');
    loadCategories(); toast('Category added');
  } catch (err) { toast(err.message); }
});
$('category-list').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-cdel]');
  if (!b) return;
  try {
    await api('DELETE', `/categories/${b.dataset.cdel}`);
    state.categories = await api('GET', '/categories');
    loadCategories(); toast('Category deleted');
  } catch (err) { toast(err.message); }
});

// ---------- History ----------
async function loadHistory() {
  const sel = $('hist-item');
  if (sel.options.length <= 1) {
    const items = await api('GET', '/items?sort=name&order=asc');
    sel.innerHTML = '<option value="">All items</option>' + items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
  }
  const params = new URLSearchParams({ limit: $('hist-limit').value });
  if (sel.value) params.set('itemId', sel.value);
  const moves = await api('GET', '/movements?' + params);
  $('history-table').querySelector('tbody').innerHTML =
    moves.map(movementRow).join('') || '<tr><td colspan="5" class="muted">No movements yet.</td></tr>';
}
$('hist-refresh').onclick = loadHistory;
$('hist-item').addEventListener('change', loadHistory);
$('hist-limit').addEventListener('change', loadHistory);

// ---------- Settings ----------
async function loadSettings() {
  const s = state.settings;
  $('set-business').value = s.businessName || '';
  $('set-currency').value = s.currency || 'INR';
  $('set-reorder').value = s.defaultReorderLevel ?? 10;
  renderCustomFieldRows(s.customFields || []);
}
function renderCustomFieldRows(fields) {
  $('custom-field-rows').innerHTML = '';
  fields.forEach((f) => addCustomFieldRow(f));
}
function addCustomFieldRow(f = {}) {
  const div = document.createElement('div');
  div.className = 'cf-row';
  div.innerHTML = `
    <input placeholder="key (e.g. brand)" value="${esc(f.key || '')}" class="cf-key">
    <input placeholder="Label" value="${esc(f.label || '')}" class="cf-label">
    <select class="cf-type">
      <option value="text"${f.type !== 'number' ? ' selected' : ''}>text</option>
      <option value="number"${f.type === 'number' ? ' selected' : ''}>number</option>
    </select>
    <button type="button" class="btn small danger cf-del">✕</button>`;
  div.querySelector('.cf-del').onclick = () => div.remove();
  $('custom-field-rows').appendChild(div);
}
$('add-custom-field').onclick = () => addCustomFieldRow();
$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const customFields = [...document.querySelectorAll('.cf-row')].map((r) => ({
    key: r.querySelector('.cf-key').value.trim(),
    label: r.querySelector('.cf-label').value.trim(),
    type: r.querySelector('.cf-type').value,
  })).filter((f) => f.key);
  try {
    state.settings = await api('PUT', '/settings', {
      businessName: $('set-business').value,
      currency: $('set-currency').value,
      defaultReorderLevel: Number($('set-reorder').value),
      customFields,
    });
    $('biz-name').textContent = state.settings.businessName || '';
    toast('Settings saved');
  } catch (err) { toast(err.message); }
});

// ---------- Theme ----------
function applyTheme() {
  const t = localStorage.getItem('stocksense_theme') || 'dark';
  document.documentElement.dataset.theme = t;
  $('theme-toggle').textContent = t === 'dark' ? '🌙' : '☀️';
}
$('theme-toggle').onclick = () => {
  localStorage.setItem('stocksense_theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  applyTheme();
};
applyTheme();

// ---------- Start ----------
// Opening the HTML file directly (file://) can't reach the API — say so plainly.
if (location.protocol === 'file:') {
  showAuth();
  authError('You opened the app file directly, so it cannot reach its server. Run `node server.js` in the app folder, then open http://localhost:3000 in your browser.');
} else if (state.token) boot().catch(() => showAuth());
else showAuth();
