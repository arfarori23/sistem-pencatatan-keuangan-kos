const SUPABASE_URL = 'https://njgquhvyrcpwuglrneoi.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_po6uYP_1pBuE9Mtpr1Vuwg_NbrK8-K9';
const SESSION_STORAGE_KEY = 'arus-kos-auth-session';

const state = {
  view: 'dashboard',
  rooms: [],
  tenants: [],
  categories: [],
  transactions: [],
  filters: { search: '', month: new Date().toISOString().slice(0, 7) },
  editing: null,
};

const resourceLabels = {
  rooms: 'Kamar',
  tenants: 'Penghuni',
  categories: 'Operasional',
  transactions: 'Transaksi',
};
const houseLogo = '<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false"><path d="M5 18.5 20 6l15 12.5v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M15 35V23h10v12M11 17h.01M29 17h.01"/></svg>';
const fieldText = (name, value = '', options = {}) => ({ name, value, ...options });
const page = document.querySelector('#page-content');
const dialog = document.querySelector('#editor-dialog');
const formFields = document.querySelector('#form-fields');
const recordForm = document.querySelector('#record-form');
const authScreen = document.querySelector('#auth-screen');
const appShell = document.querySelector('#app-shell');
let toastTimer;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function formatMoney(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatInputAmount(value) {
  if (value === undefined || value === null || value === '') return '';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(value));
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${value}T00:00:00`));
}

function setToday() {
  document.querySelector('#today-label').textContent = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date());
}

async function api(resource, method = 'GET', id = '', body) {
  const session = await getActiveSession();
  if (!session) throw new Error('Sesi login berakhir. Silakan masuk kembali.');
  const url = new URL(`/rest/v1/${resource}`, `${SUPABASE_URL}/`);
  url.searchParams.set('select', '*');
  if (id) url.searchParams.set('id', `eq.${id}`);
  if (method === 'GET') url.searchParams.set('order', resource === 'transactions' ? 'transaction_date.desc,created_at.desc' : 'created_at.desc');
  const response = await fetch(url, {
    method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
      ...(body || method !== 'GET' ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.message || result.error || result.hint || 'Permintaan tidak dapat diproses.'), { status: response.status });
  return result;
}

async function loadData() {
  try {
    const [rooms, tenants, categories, transactions] = await Promise.all([
      api('rooms'), api('tenants'), api('categories'), api('transactions'),
    ]);
    Object.assign(state, { rooms, tenants, categories, transactions });
    render();
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      showAuthScreen('Sesi login berakhir. Silakan masuk kembali.');
      return;
    }
    page.innerHTML = `<div class="error-state"><strong>Data belum dapat dimuat</strong><p>${escapeHTML(error.message)} Pastikan URL dan publishable key sudah diisi di frontend/app.js, database.sql sudah dijalankan, dan akun admin sudah masuk.</p><button class="button button-primary" data-action="reload">Coba lagi <span aria-hidden="true">↻</span></button></div>`;
  }
}

function isSupabaseConfigured() {
  return SUPABASE_URL.startsWith('https://') && !SUPABASE_URL.includes('YOUR-PROJECT-REF')
    && SUPABASE_PUBLISHABLE_KEY.length > 20 && !SUPABASE_PUBLISHABLE_KEY.includes('YOUR_');
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null'); }
  catch { return null; }
}

function saveSession(session) {
  const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  const saved = { ...session, expires_at: expiresAt };
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(saved));
  return saved;
}

function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function authRequest(endpoint, payload, accessToken = '') {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.msg || result.message || result.error_description || 'Autentikasi Supabase gagal.');
  return result;
}

async function getActiveSession() {
  const session = readSession();
  if (!session?.access_token) return null;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 60) return session;
  if (!session.refresh_token) { clearSession(); return null; }
  try {
    const refreshed = await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token });
    return saveSession({ ...refreshed, user: refreshed.user || session.user });
  } catch {
    clearSession();
    return null;
  }
}

function showAuthScreen(message = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  if (!isSupabaseConfigured()) {
    authScreen.innerHTML = `<section class="auth-panel"><span class="brand-mark">${houseLogo}</span><span class="eyebrow">KONFIGURASI SUPABASE</span><h1>Hubungkan project</h1><p>Isi <code>SUPABASE_URL</code> dan <code>SUPABASE_PUBLISHABLE_KEY</code> di bagian atas <code>frontend/app.js</code>, kemudian muat ulang halaman.</p></section>`;
    return;
  }
  authScreen.innerHTML = `<section class="auth-panel"><span class="brand-mark">${houseLogo}</span><span class="eyebrow">ARUS KOS · AKUN ADMIN</span><h1>Masuk ke pencatatan</h1><p>Gunakan akun admin yang dibuat di Supabase Authentication.</p>${message ? `<p class="auth-message" role="alert">${escapeHTML(message)}</p>` : ''}<form id="auth-form"><label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label><label class="field"><span>Kata sandi</span><input name="password" type="password" autocomplete="current-password" required></label><button class="button button-primary" type="submit">Masuk <span aria-hidden="true">↗</span></button><p class="form-hint">Pendaftaran akun publik tidak digunakan. Buat akun admin melalui Supabase Dashboard.</p></form></section>`;
  authScreen.querySelector('[name="email"]')?.focus();
}

async function signIn(email, password) {
  const session = await authRequest('token?grant_type=password', { email, password });
  saveSession(session);
  authScreen.hidden = true;
  appShell.hidden = false;
  const emailName = session.user?.email || email;
  document.querySelector('#user-avatar').textContent = emailName.slice(0, 2).toUpperCase();
  await loadData();
}

async function signOut() {
  const session = readSession();
  if (session?.access_token && isSupabaseConfigured()) {
    try { await authRequest('logout', {}, session.access_token); } catch { /* Local session is still cleared. */ }
  }
  clearSession();
  showAuthScreen();
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

function viewHeading(title, description, action = '') {
  return `<div class="page-heading"><div><span class="eyebrow">PENGELOLAAN KOS</span><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function headingAction(label, resource) {
  return `<button class="button button-primary" data-action="create" data-resource="${resource}"><span>Tambah ${label.toLowerCase()}</span><span aria-hidden="true">+</span></button>`;
}

function sumByType(type, month) {
  return state.transactions.filter((item) => item.type === type && (!month || item.transaction_date?.startsWith(month)))
    .reduce((sum, item) => sum + Number(item.amount), 0);
}

function getRoom(id) { return state.rooms.find((item) => item.id === id); }
function getTenant(id) { return state.tenants.find((item) => item.id === id); }
function getCategory(id) { return state.categories.find((item) => item.id === id); }

function getActiveTenants(roomId) {
  const today = new Date().toISOString().slice(0, 10);
  return state.tenants.filter((tenant) => tenant.room_id === roomId
    && tenant.start_date <= today && (!tenant.end_date || tenant.end_date >= today));
}

function transactionRows(items, compact = false) {
  if (!items.length) return `<tr><td class="empty-cell" colspan="${compact ? 4 : 6}">Belum ada transaksi untuk ditampilkan.</td></tr>`;
  return items.map((item) => {
    const category = getCategory(item.category_id);
    const tenant = getTenant(item.tenant_id);
    const room = getRoom(item.room_id);
    return `<tr>
      <td>${formatDate(item.transaction_date)}</td>
      <td><span class="table-name">${escapeHTML(item.description || category?.name || resourceLabels[item.type] || 'Transaksi')}</span>${compact ? '' : `<span class="table-sub">${escapeHTML(category?.name || 'Tanpa kategori')}${room ? ` · ${escapeHTML(room.name)}` : ''}${tenant ? ` · ${escapeHTML(tenant.name)}` : ''}</span>`}</td>
      ${compact ? '' : `<td>${escapeHTML(category?.name || '-')}</td><td>${escapeHTML(tenant?.name || '-')}</td>`}
      <td><span class="type-pill ${item.type === 'expense' ? 'expense' : ''}">${item.type === 'expense' ? 'Keluar' : 'Masuk'}</span></td>
      <td class="amount ${item.type}">${item.type === 'expense' ? '−' : '+'}${formatMoney(item.amount)}</td>
      ${compact ? '' : `<td class="actions-cell"><span class="row-actions"><button class="action-button" data-action="edit" data-resource="transactions" data-id="${item.id}" aria-label="Ubah transaksi" title="Ubah">✎</button><button class="action-button delete" data-action="delete" data-resource="transactions" data-id="${item.id}" aria-label="Hapus transaksi" title="Hapus">×</button></span></td>`}
    </tr>`;
  }).join('');
}

function renderDashboard() {
  const month = state.filters.month;
  const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`));
  const income = sumByType('income', month);
  const expense = sumByType('expense', month);
  const recent = [...state.transactions].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)).slice(0, 5);
  const categorySpend = state.categories.filter((category) => category.type === 'expense').map((category) => ({
    ...category,
    total: state.transactions.filter((item) => item.type === 'expense' && item.category_id === category.id && item.transaction_date?.startsWith(month)).reduce((sum, item) => sum + Number(item.amount), 0),
  })).filter((category) => category.total > 0).sort((a, b) => b.total - a.total).slice(0, 5);
  const maxSpend = Math.max(...categorySpend.map((item) => item.total), 1);
  const colors = ['#aacd47', '#6b9ea0', '#e57b64', '#7c9b73', '#8ca7b5'];

  return `${viewHeading('Ringkasan keuangan', 'Pantau arus kas kos dalam satu tampilan.')}
    <div class="toolbar" style="justify-content:flex-end;margin:-10px 0 15px"><label class="eyebrow" for="dashboard-month">PERIODE</label><input class="input-control" id="dashboard-month" type="month" value="${month}" aria-label="Pilih periode ringkasan"></div>
    <section class="report-strip"><div><span class="eyebrow">IKHTISAR PERIODE</span><strong>${escapeHTML(monthLabel)}</strong><span>Saldo bersih <b>${formatMoney(income - expense)}</b></span></div><button class="button button-light" data-action="navigate" data-view="reports"><span aria-hidden="true">▤</span> Buka laporan <span aria-hidden="true">↗</span></button></section>
    <div class="kpi-grid">
      <article class="kpi-card" style="--wash:#edf5db;--symbol-color:#597634"><div class="kpi-top"><span>Pemasukan bulan ini</span><span class="kpi-symbol">↗</span></div><strong class="kpi-value">${formatMoney(income)}</strong><div class="kpi-note">${escapeHTML(monthLabel)}</div></article>
      <article class="kpi-card" style="--wash:#fbefeb;--symbol-color:#bf6852"><div class="kpi-top"><span>Pengeluaran bulan ini</span><span class="kpi-symbol">↘</span></div><strong class="kpi-value">${formatMoney(expense)}</strong><div class="kpi-note">${escapeHTML(monthLabel)}</div></article>
      <article class="kpi-card" style="--wash:#e7f0ee;--symbol-color:#3e7770"><div class="kpi-top"><span>Saldo bersih bulan ini</span><span class="kpi-symbol">＝</span></div><strong class="kpi-value">${formatMoney(income - expense)}</strong><div class="kpi-note">${state.tenants.length} penghuni · ${state.rooms.length} kamar terdaftar</div></article>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-heading"><div><h2>Transaksi terbaru</h2><p>Catatan pemasukan dan pengeluaran kos</p></div><button class="text-link" data-action="navigate" data-view="transactions">Lihat semua →</button></div><div class="table-scroll"><table class="recent-table"><thead><tr><th>TANGGAL</th><th>TRANSAKSI</th><th>ARUS</th><th>NILAI</th></tr></thead><tbody>${transactionRows(recent, true)}</tbody></table></div></section>
      <section class="panel"><div class="panel-heading"><div><h2>Pengeluaran per kategori</h2><p>${escapeHTML(monthLabel)}</p></div></div><div class="category-summary">${categorySpend.length ? categorySpend.map((item, index) => `<div class="category-line"><div class="category-meta"><span>${escapeHTML(item.name)}</span><strong>${formatMoney(item.total)}</strong></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(item.total / maxSpend * 100, 3)}%;--bar-color:${escapeHTML(item.color || colors[index % colors.length])}"></div></div></div>`).join('') : '<div class="summary-empty">Belum ada pengeluaran pada periode ini.</div>'}</div></section>
    </div>`;
}

function rowActions(resource, id) {
  return `<span class="row-actions"><button class="action-button" data-action="edit" data-resource="${resource}" data-id="${id}" aria-label="Ubah data" title="Ubah">✎</button><button class="action-button delete" data-action="delete" data-resource="${resource}" data-id="${id}" aria-label="Hapus data" title="Hapus">×</button></span>`;
}

function renderTransactions() {
  const search = state.filters.search.trim().toLocaleLowerCase('id');
  const month = state.filters.month;
  const filtered = [...state.transactions].filter((item) => {
    const category = getCategory(item.category_id)?.name || '';
    const tenant = getTenant(item.tenant_id)?.name || '';
    const text = `${item.description || ''} ${category} ${tenant} ${item.type}`.toLocaleLowerCase('id');
    return (!month || item.transaction_date?.startsWith(month)) && (!search || text.includes(search));
  }).sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  return `${viewHeading('Transaksi', 'Catat pembayaran sewa dan biaya operasional.', headingAction('Transaksi', 'transactions'))}
    <section class="panel data-panel"><div class="panel-heading"><div><h2>Semua transaksi</h2><p>${filtered.length} catatan ditemukan</p></div><div class="toolbar"><input class="input-control search" id="transaction-search" type="search" placeholder="Cari transaksi..." value="${escapeHTML(state.filters.search)}" aria-label="Cari transaksi"><input class="input-control" id="transaction-month" type="month" value="${escapeHTML(month)}" aria-label="Filter bulan"></div></div>
    <div class="table-scroll"><table class="data-table"><thead><tr><th>TANGGAL</th><th>KETERANGAN</th><th>KATEGORI</th><th>KAMAR</th><th>PENGHUNI</th><th>ARUS</th><th>NILAI</th><th></th></tr></thead><tbody>${filtered.length ? filtered.map((item) => {
      const category = getCategory(item.category_id);
      const tenant = getTenant(item.tenant_id);
      const room = getRoom(item.room_id);
      return `<tr><td>${formatDate(item.transaction_date)}</td><td><span class="table-name">${escapeHTML(item.description || '-')}</span></td><td>${escapeHTML(category?.name || '-')}</td><td>${escapeHTML(room?.name || '-')}</td><td>${escapeHTML(tenant?.name || '-')}</td><td><span class="type-pill ${item.type === 'expense' ? 'expense' : ''}">${item.type === 'expense' ? 'Keluar' : 'Masuk'}</span></td><td class="amount ${item.type}">${item.type === 'expense' ? '−' : '+'}${formatMoney(item.amount)}</td><td class="actions-cell">${rowActions('transactions', item.id)}</td></tr>`;
    }).join('') : '<tr><td class="empty-cell" colspan="8">Tidak ada transaksi yang cocok.</td></tr>'}</tbody></table></div><div class="table-foot">Nilai ditampilkan dalam Rupiah (IDR)</div></section>`;
}

function renderRooms() {
  const rows = [...state.rooms].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return `${viewHeading('Kamar', 'Kelola kamar dan harga sewa per bulan.', headingAction('Kamar', 'rooms'))}
    <section class="panel data-panel"><div class="panel-heading"><div><h2>Daftar kamar</h2><p>${rows.length} kamar terdaftar</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>NAMA KAMAR</th><th>HARGA SEWA / BULAN</th><th>STATUS PENGHUNI</th><th>CATATAN</th><th></th></tr></thead><tbody>${rows.length ? rows.map((room) => {
      const occupants = getActiveTenants(room.id);
      return `<tr><td class="table-name">${escapeHTML(room.name)}</td><td class="amount">${formatMoney(room.monthly_price)}</td><td><span class="occupancy-pill ${occupants.length ? 'occupied' : 'vacant'}">${occupants.length ? 'Terisi' : 'Kosong'}</span>${occupants.map((tenant) => `<span class="table-sub occupant-name">${escapeHTML(tenant.name)}</span>`).join('')}</td><td>${escapeHTML(room.description || '-')}</td><td class="actions-cell">${rowActions('rooms', room.id)}</td></tr>`;
    }).join('') : '<tr><td class="empty-cell" colspan="5">Belum ada kamar. Tambahkan data kamar pertama.</td></tr>'}</tbody></table></div></section>`;
}

function renderTenants() {
  const rows = [...state.tenants].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return `${viewHeading('Penghuni', 'Simpan informasi penyewa dan masa tinggal.', headingAction('Penghuni', 'tenants'))}
    <section class="panel data-panel"><div class="panel-heading"><div><h2>Daftar penghuni</h2><p>${rows.length} penghuni terdaftar</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>NAMA</th><th>TELEPON</th><th>KAMAR</th><th>MULAI SEWA</th><th>AKHIR SEWA</th><th></th></tr></thead><tbody>${rows.length ? rows.map((tenant) => `<tr><td class="table-name">${escapeHTML(tenant.name)}</td><td>${escapeHTML(tenant.phone || '-')}</td><td>${escapeHTML(getRoom(tenant.room_id)?.name || 'Belum ditentukan')}</td><td>${formatDate(tenant.start_date)}</td><td>${formatDate(tenant.end_date)}</td><td class="actions-cell">${rowActions('tenants', tenant.id)}</td></tr>`).join('') : '<tr><td class="empty-cell" colspan="6">Belum ada penghuni. Tambahkan data penghuni pertama.</td></tr>'}</tbody></table></div></section>`;
}

function renderCategories() {
  const rows = [...state.categories].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const month = state.filters.month;
  const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`));
  return `${viewHeading('Operasional', 'Kelola kategori kos dan pantau pengeluaran setiap bulan.', headingAction('Kategori operasional', 'categories'))}
    <section class="panel data-panel"><div class="panel-heading"><div><h2>Ringkasan operasional</h2><p>${rows.length} kategori · pengeluaran ${escapeHTML(monthLabel)}</p></div><label class="eyebrow period-control" for="operations-month">PERIODE <input class="input-control" id="operations-month" type="month" value="${escapeHTML(month)}" aria-label="Pilih periode operasional"></label></div><div class="table-scroll"><table class="data-table"><thead><tr><th>NAMA OPERASIONAL</th><th>JENIS</th><th>TRANSAKSI</th><th>TOTAL PENGELUARAN BULAN INI</th><th></th></tr></thead><tbody>${rows.length ? rows.map((category) => {
      const categoryTransactions = state.transactions.filter((item) => item.category_id === category.id && item.transaction_date?.startsWith(month));
      const spending = categoryTransactions.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
      return `<tr><td class="table-name"><span class="color-dot" style="background:${escapeHTML(category.color || '#aacd47')}"></span>${escapeHTML(category.name)}</td><td><span class="type-pill ${category.type === 'expense' ? 'expense' : ''}">${category.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}</span></td><td>${categoryTransactions.length} transaksi</td><td class="amount ${spending ? 'expense' : ''}">${category.type === 'expense' ? formatMoney(spending) : '—'}</td><td class="actions-cell">${category.owner_id ? rowActions('categories', category.id) : '<span class="built-in-label">Bawaan</span>'}</td></tr>`;
    }).join('') : '<tr><td class="empty-cell" colspan="5">Belum ada kategori operasional.</td></tr>'}</tbody></table></div><div class="table-foot">Total per kategori mengikuti periode yang dipilih.</div></section>`;
}

function renderReport() {
  const month = state.filters.month;
  const monthLabel = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00`));
  const entries = state.transactions.filter((item) => item.transaction_date?.startsWith(month))
    .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
  const income = entries.filter((item) => item.type === 'income').reduce((sum, item) => sum + Number(item.amount), 0);
  const expense = entries.filter((item) => item.type === 'expense').reduce((sum, item) => sum + Number(item.amount), 0);
  return `${viewHeading('Laporan keuangan', 'Rekap arus kas kos berdasarkan periode.', '<button class="button button-primary print-button" data-action="print"><span aria-hidden="true">▤</span> Cetak laporan <span aria-hidden="true">↗</span></button>')}
    <div class="report-controls"><label class="eyebrow" for="report-month">PERIODE LAPORAN</label><input class="input-control" id="report-month" type="month" value="${escapeHTML(month)}" aria-label="Pilih periode laporan"><div class="report-period-print"><span>Periode laporan</span><strong>${escapeHTML(monthLabel)}</strong></div></div>
    <div class="kpi-grid report-kpis"><article class="kpi-card" style="--wash:#edf5db;--symbol-color:#597634"><div class="kpi-top"><span>Total pemasukan</span><span class="kpi-symbol">↗</span></div><strong class="kpi-value">${formatMoney(income)}</strong></article><article class="kpi-card" style="--wash:#fbefeb;--symbol-color:#bf6852"><div class="kpi-top"><span>Total pengeluaran</span><span class="kpi-symbol">↘</span></div><strong class="kpi-value">${formatMoney(expense)}</strong></article><article class="kpi-card" style="--wash:#e7f0ee;--symbol-color:#3e7770"><div class="kpi-top"><span>Saldo bersih</span><span class="kpi-symbol">＝</span></div><strong class="kpi-value">${formatMoney(income - expense)}</strong></article></div>
    <section class="panel data-panel report-table-panel"><div class="panel-heading"><div><h2>Rincian transaksi</h2><p>${entries.length} transaksi · ${escapeHTML(monthLabel)}</p></div></div><div class="table-scroll"><table class="data-table"><thead><tr><th>TANGGAL</th><th>KETERANGAN</th><th>KATEGORI</th><th>KAMAR</th><th>PENGHUNI</th><th>ARUS</th><th>NILAI</th></tr></thead><tbody>${entries.length ? entries.map((item) => `<tr><td>${formatDate(item.transaction_date)}</td><td><span class="table-name">${escapeHTML(item.description || '-')}</span></td><td>${escapeHTML(getCategory(item.category_id)?.name || '-')}</td><td>${escapeHTML(getRoom(item.room_id)?.name || '-')}</td><td>${escapeHTML(getTenant(item.tenant_id)?.name || '-')}</td><td><span class="type-pill ${item.type === 'expense' ? 'expense' : ''}">${item.type === 'expense' ? 'Keluar' : 'Masuk'}</span></td><td class="amount ${item.type}">${item.type === 'expense' ? '−' : '+'}${formatMoney(item.amount)}</td></tr>`).join('') : '<tr><td class="empty-cell" colspan="7">Tidak ada transaksi pada periode ini.</td></tr>'}</tbody></table></div><div class="table-foot">Arus Kos · Nilai dalam Rupiah (IDR)</div></section>`;
}

function render() {
  const renderers = { dashboard: renderDashboard, transactions: renderTransactions, rooms: renderRooms, tenants: renderTenants, categories: renderCategories, reports: renderReport };
  const labels = { dashboard: 'Ringkasan', transactions: 'Transaksi', rooms: 'Kamar', tenants: 'Penghuni', categories: 'Operasional', reports: 'Laporan' };
  document.querySelector('#page-crumb').textContent = labels[state.view];
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === state.view));
  page.innerHTML = renderers[state.view]();
}

function selectOptions(items, selected, emptyLabel, labelKey = 'name') {
  return `<option value="">${emptyLabel}</option>${items.map((item) => `<option value="${item.id}" ${item.id === selected ? 'selected' : ''}>${escapeHTML(item[labelKey])}</option>`).join('')}`;
}

function fieldMarkup({ name, label, value = '', type = 'text', inputMode, options, full = false, required = false, placeholder = '', hint = '', min, step }) {
  const className = `field${full ? ' full' : ''}`;
  let control;
  if (options) control = `<select id="field-${name}" name="${name}" ${required ? 'required' : ''}>${options}</select>`;
  else if (type === 'textarea') control = `<textarea id="field-${name}" name="${name}" placeholder="${escapeHTML(placeholder)}" ${required ? 'required' : ''}>${escapeHTML(value)}</textarea>`;
  else control = `<input id="field-${name}" name="${name}" type="${type}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}" ${inputMode ? `inputmode="${inputMode}"` : ''} ${required ? 'required' : ''}${min !== undefined ? ` min="${min}"` : ''}${step ? ` step="${step}"` : ''}>`;
  return `<div class="${className}"><label for="field-${name}">${label}${required ? ' *' : ''}</label>${control}${hint ? `<span class="form-hint">${hint}</span>` : ''}</div>`;
}

function fieldsFor(resource, record = {}) {
  const today = new Date().toISOString().slice(0, 10);
  if (resource === 'rooms') return [
    fieldText('name', record.name, { label: 'Nama kamar', required: true, placeholder: 'Contoh: Kamar A-01' }),
    fieldText('monthly_price', formatInputAmount(record.monthly_price), { label: 'Harga sewa per bulan (Rp)', type: 'text', inputMode: 'decimal', required: true, placeholder: 'Contoh: 1.000.000' }),
    fieldText('description', record.description, { label: 'Catatan', type: 'textarea', full: true, placeholder: 'Informasi tambahan (opsional)' }),
  ];
  if (resource === 'tenants') return [
    fieldText('name', record.name, { label: 'Nama lengkap', required: true }),
    fieldText('phone', record.phone, { label: 'Nomor telepon', type: 'tel', placeholder: '08xxxxxxxxxx' }),
    fieldText('room_id', record.room_id, { label: 'Kamar', options: selectOptions(state.rooms, record.room_id, 'Pilih kamar (opsional)') }),
    fieldText('start_date', record.start_date || today, { label: 'Mulai sewa', type: 'date', required: true }),
    fieldText('end_date', record.end_date, { label: 'Akhir sewa', type: 'date' }),
  ];
  if (resource === 'categories') return [
    fieldText('name', record.name, { label: 'Nama kategori', required: true, placeholder: 'Contoh: Listrik' }),
    fieldText('type', record.type || 'expense', { label: 'Jenis arus', required: true, options: '<option value="income">Pemasukan</option><option value="expense">Pengeluaran</option>' }),
    fieldText('color', record.color || '#aacd47', { label: 'Warna kategori', type: 'color' }),
  ];
  const type = record.type || 'income';
  const availableCategories = state.categories.filter((category) => category.type === type);
  return [
    fieldText('type', type, { label: 'Jenis arus', required: true, options: `<option value="income" ${type === 'income' ? 'selected' : ''}>Pemasukan</option><option value="expense" ${type === 'expense' ? 'selected' : ''}>Pengeluaran</option>` }),
    fieldText('room_id', record.room_id, { label: 'Kamar sewa', options: roomOptions(record.room_id), hint: type === 'income' ? 'Pilih kamar untuk mengisi harga sewa otomatis.' : 'Pilih kamar terkait (opsional).' }),
    fieldText('amount', formatInputAmount(record.amount), { label: 'Jumlah (Rp)', type: 'text', inputMode: 'decimal', required: true, placeholder: 'Contoh: 1.000.000' }),
    fieldText('transaction_date', record.transaction_date || today, { label: 'Tanggal transaksi', type: 'date', required: true }),
    fieldText('category_id', record.category_id, { label: 'Operasional / kategori', options: selectOptions(availableCategories, record.category_id, 'Pilih kategori') }),
    fieldText('tenant_id', record.tenant_id, { label: 'Penghuni terkait', options: selectOptions(state.tenants, record.tenant_id, 'Tidak terkait penghuni') }),
    fieldText('description', record.description, { label: 'Keterangan', type: 'textarea', full: true, placeholder: 'Contoh: Pembayaran sewa bulan ini', required: true }),
  ];
}

function roomOptions(selected = '') {
  return `<option value="">Pilih kamar</option>${state.rooms.map((room) => `<option value="${room.id}" ${room.id === selected ? 'selected' : ''}>${escapeHTML(room.name)} · ${escapeHTML(formatMoney(room.monthly_price))}</option>`).join('')}`;
}

function updateRoomFieldVisibility(type) {
  const roomField = formFields.querySelector('[name="room_id"]')?.closest('.field');
  if (!roomField) return;
  roomField.hidden = false;
  const hint = roomField.querySelector('.form-hint');
  if (hint) hint.textContent = type === 'income'
    ? 'Pilih kamar untuk mengisi harga sewa otomatis.'
    : 'Opsional untuk biaya yang terkait dengan kamar.';
}

function openEditor(resource, record = null) {
  state.editing = { resource, id: record?.id || null };
  const label = resourceLabels[resource];
  document.querySelector('#dialog-eyebrow').textContent = `DATA ${label.toUpperCase()}`;
  document.querySelector('#dialog-title').textContent = `${record ? 'Ubah' : 'Tambah'} ${label.toLowerCase()}`;
  document.querySelector('#form-error').textContent = '';
  document.querySelector('#record-form button[type="submit"] span:first-child').textContent = record ? 'Simpan perubahan' : 'Simpan data';
  formFields.innerHTML = fieldsFor(resource, record || {}).map(fieldMarkup).join('');
  if (resource === 'categories' && record) document.querySelector('#field-type').value = record.type;
  if (resource === 'transactions') updateRoomFieldVisibility(record?.type || 'income');
  dialog.showModal();
  formFields.querySelector('input, select, textarea')?.focus();
}

function closeEditor() {
  dialog.close();
  state.editing = null;
  recordForm.reset();
}

function navigate(view) {
  if (!['dashboard', 'transactions', 'rooms', 'tenants', 'categories', 'reports'].includes(view)) return;
  state.view = view;
  render();
}

document.body.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action], [data-view]');
  if (!control) return;
  if (control.dataset.view) { navigate(control.dataset.view); return; }
  const { action, resource, id, view } = control.dataset;
  if (action === 'close-dialog') closeEditor();
  if (action === 'navigate') navigate(view);
  if (action === 'reload') loadData();
  if (action === 'logout') signOut();
  if (action === 'print') window.print();
  if (action === 'create') openEditor(resource);
  if (action === 'edit') {
    const record = state[resource].find((item) => item.id === id);
    if (record) openEditor(resource, record);
  }
  if (action === 'delete') {
    const record = state[resource].find((item) => item.id === id);
    const name = record?.name || record?.description || 'data ini';
    if (!window.confirm(`Hapus ${resourceLabels[resource].toLowerCase()} "${name}"?`)) return;
    try {
      await api(resource, 'DELETE', id);
      await loadData();
      showToast(`${resourceLabels[resource]} berhasil dihapus.`);
    } catch (error) { showToast(error.message); }
  }
});

recordForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.editing) return;
  const { resource, id } = state.editing;
  const payload = Object.fromEntries(new FormData(recordForm).entries());
  for (const key of ['monthly_price', 'amount']) {
    if (payload[key] === undefined) continue;
    const normalized = String(payload[key]).trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    const amount = Number(normalized);
    const minimum = key === 'amount' ? 1 : 0;
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized) || !Number.isFinite(amount) || amount < minimum) {
      document.querySelector('#form-error').textContent = 'Masukkan nominal yang valid, misalnya 1.000.000.';
      return;
    }
    payload[key] = amount;
  }
  for (const key of ['room_id', 'tenant_id', 'category_id', 'end_date']) if (payload[key] === '') payload[key] = null;
  if (resource === 'transactions' && !payload.category_id) payload.category_id = null;
  try {
    await api(resource, id ? 'PATCH' : 'POST', id, payload);
    closeEditor();
    await loadData();
    showToast(`${resourceLabels[resource]} berhasil ${id ? 'diperbarui' : 'ditambahkan'}.`);
  } catch (error) {
    document.querySelector('#form-error').textContent = error.message;
  }
});

authScreen.addEventListener('submit', async (event) => {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  const submitButton = event.target.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Memeriksa akun...';
  const formData = new FormData(event.target);
  try {
    await signIn(formData.get('email'), formData.get('password'));
  } catch (error) {
    showAuthScreen(error.message);
  }
});

formFields.addEventListener('change', (event) => {
  if (event.target.name !== 'type' || state.editing?.resource !== 'transactions') return;
  updateRoomFieldVisibility(event.target.value);
  const categorySelect = formFields.querySelector('[name="category_id"]');
  const selectedCategory = categorySelect.value;
  const categories = state.categories.filter((category) => category.type === event.target.value);
  categorySelect.innerHTML = selectOptions(categories, selectedCategory, 'Pilih kategori');
  if (![...categorySelect.options].some((option) => option.value === selectedCategory)) categorySelect.value = '';
});

formFields.addEventListener('change', (event) => {
  if (event.target.name !== 'room_id' || state.editing?.resource !== 'transactions') return;
  const room = getRoom(event.target.value);
  const amountInput = formFields.querySelector('[name="amount"]');
  const tenantSelect = formFields.querySelector('[name="tenant_id"]');
  if (!room) {
    if (tenantSelect) tenantSelect.value = '';
    return;
  }
  if (document.querySelector('#field-type').value === 'income') amountInput.value = formatInputAmount(room.monthly_price);
  if (tenantSelect) {
    tenantSelect.value = '';
    const activeTenant = getActiveTenants(room.id)[0];
    if (activeTenant) tenantSelect.value = activeTenant.id;
  }
});

page.addEventListener('input', (event) => {
  if (event.target.id === 'transaction-search') {
    state.filters.search = event.target.value;
    const cursor = event.target.selectionStart;
    const next = renderTransactions();
    page.innerHTML = next;
    const search = document.querySelector('#transaction-search');
    search.focus();
    search.setSelectionRange(cursor, cursor);
  }
});

page.addEventListener('change', (event) => {
  if (event.target.id === 'transaction-month') {
    state.filters.month = event.target.value;
    render();
  }
  if (event.target.id === 'dashboard-month') {
    state.filters.month = event.target.value || new Date().toISOString().slice(0, 7);
    render();
  }
  if (event.target.id === 'operations-month' || event.target.id === 'report-month') {
    state.filters.month = event.target.value || new Date().toISOString().slice(0, 7);
    render();
  }
});

dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeEditor();
});

async function startApp() {
  setToday();
  if (!isSupabaseConfigured()) {
    showAuthScreen();
    return;
  }
  const session = await getActiveSession();
  if (!session) {
    showAuthScreen();
    return;
  }
  const emailName = session.user?.email || 'Admin';
  document.querySelector('#user-avatar').textContent = emailName.slice(0, 2).toUpperCase();
  authScreen.hidden = true;
  appShell.hidden = false;
  await loadData();
}

startApp();
