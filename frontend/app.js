const state = { products: [], parties: [], transactions: [], dashboard: null, report: null };

const currency = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const dateFormat = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const byId = (id) => document.getElementById(id);
function readSavedSupabaseConfig() {
  try {
    return JSON.parse(localStorage.getItem('rodakas-supabase-config') || '{}');
  } catch {
    return {};
  }
}

const savedSupabaseConfig = readSavedSupabaseConfig();
let SUPABASE_URL = (window.RODAKAS_SUPABASE_URL || savedSupabaseConfig.url || '').replace(/\/+$/, '');
let SUPABASE_ANON_KEY = window.RODAKAS_SUPABASE_ANON_KEY || savedSupabaseConfig.anonKey || '';

function showNotice(message, isError = false) {
  const notice = byId('notice');
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  notice.hidden = false;
  window.clearTimeout(showNotice.timeout);
  showNotice.timeout = window.setTimeout(() => { notice.hidden = true; }, 5000);
}

async function supabase(resource, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Hubungkan Supabase dengan Project URL dan anon/publishable key. Jangan gunakan service-role key.');
  }
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
      ...options,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
  } catch (cause) {
    throw new Error(`Tidak dapat terhubung ke Supabase. Periksa URL project dan koneksi internet. ${cause.message}`);
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = data && typeof data === 'object' ? data.message || data.details || data.hint : '';
    if (data?.code === '23503') {
      throw new Error('Data tidak dapat dihapus karena sudah digunakan dalam transaksi. Riwayat transaksi tetap dipertahankan.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`${message || 'Supabase menolak akses.'} Pastikan anon key benar dan jalankan backend/schema.sql terbaru untuk memberi izin kepada role anon.`);
    }
    throw new Error(message || `Permintaan database gagal (${response.status}).`);
  }
  return data;
}

async function fetchAllPages(resource, pageSize = 1000) {
  const rows = [];
  const separator = resource.includes('?') ? '&' : '?';
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabase(`${resource}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function sumTransactions(transactions) {
  return transactions.reduce((totals, transaction) => {
    if (transaction.transaction_type === 'sale') {
      totals.sales += Number(transaction.total_amount);
      totals.gross_profit += (transaction.transaction_items || []).reduce((sum, item) =>
        sum + (Number(item.unit_price) - Number(item.unit_cost)) * Number(item.quantity), 0);
    } else {
      totals.purchases += Number(transaction.total_amount);
    }
    return totals;
  }, { sales: 0, purchases: 0, gross_profit: 0 });
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function api(path, options = {}) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : null;
  if (method === 'GET' && path === '/api/products') {
    return fetchAllPages('spare_parts?select=id,sku,name,category,stock,cost_price,selling_price,is_active,created_at&is_active=eq.true&order=name.asc');
  }
  if (method === 'GET' && path === '/api/parties') {
    return fetchAllPages('parties?select=id,name,party_type,phone,created_at&order=name.asc');
  }
  if (method === 'GET' && path === '/api/transactions') {
    return supabase('transactions?select=id,transaction_type,transaction_date,total_amount,notes,party_id,parties(name),transaction_items(id,spare_part_id,line_number,quantity,unit_price,unit_cost,spare_parts(name,sku))&order=transaction_date.desc,created_at.desc&transaction_items.order=line_number.asc&limit=100');
  }
  if (method === 'GET' && path === '/api/dashboard') {
    const [products, transactions] = await Promise.all([
      fetchAllPages('spare_parts?select=stock&is_active=eq.true'),
      fetchAllPages('transactions?select=transaction_type,total_amount,transaction_items(quantity,unit_price,unit_cost)'),
    ]);
    return {
      ...sumTransactions(transactions),
      product_count: products.length,
      low_stock_count: products.filter((product) => Number(product.stock) <= 5).length,
    };
  }
  if (method === 'GET' && path.startsWith('/api/reports?')) {
    const params = new URLSearchParams(path.split('?')[1]);
    const from = params.get('from');
    const to = params.get('to');
    if (!validDate(from) || !validDate(to)) {
      throw new Error('Pilih tanggal awal dan akhir laporan yang valid.');
    }
    if (from > to) throw new Error('Tanggal awal tidak boleh melewati tanggal akhir.');
    const transactions = await fetchAllPages(
      `transactions?select=id,transaction_type,transaction_date,total_amount,notes,parties(name),transaction_items(quantity,unit_price,unit_cost,spare_parts(name,sku))&transaction_date=gte.${from}&transaction_date=lte.${to}&order=transaction_date.desc,created_at.desc,id.asc`,
    );
    return { from, to, transaction_count: transactions.length, ...sumTransactions(transactions), transactions };
  }
  if (method === 'POST' && path === '/api/products') {
    const created = await supabase('spare_parts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    return created[0];
  }
  if (method === 'POST' && path === '/api/parties') {
    const created = await supabase('parties', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    return created[0];
  }
  if (method === 'POST' && path === '/api/transactions') {
    return supabase('rpc/create_transaction', {
      method: 'POST',
      body: JSON.stringify({
        p_transaction_type: body.transaction_type,
        p_party_id: body.party_id,
        p_transaction_date: body.transaction_date,
        p_notes: body.notes || null,
        p_items: body.items,
      }),
    });
  }

  const match = path.match(/^\/api\/(products|parties|transactions)\/([^/?]+)(?:\?.*)?$/);
  if (match && ['PATCH', 'DELETE'].includes(method)) {
    const [, entity, id] = match;
    if (entity === 'transactions') {
      const transactionId = decodeURIComponent(id);
      if (method === 'DELETE') {
        return supabase('rpc/delete_transaction', {
          method: 'POST',
          body: JSON.stringify({ p_transaction_id: transactionId }),
        });
      }
      return supabase('rpc/update_transaction', {
        method: 'POST',
        body: JSON.stringify({
          p_transaction_id: transactionId,
          p_transaction_type: body.transaction_type,
          p_party_id: body.party_id,
          p_transaction_date: body.transaction_date,
          p_notes: body.notes || null,
          p_items: body.items,
        }),
      });
    }
    const table = entity === 'products' ? 'spare_parts' : 'parties';
    const resource = `${table}?id=eq.${encodeURIComponent(decodeURIComponent(id))}`;
    const response = await supabase(resource, method === 'DELETE' ? {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    } : {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (!response.length) throw new Error('Data tidak ditemukan atau sudah dihapus.');
    return method === 'DELETE' ? { id: decodeURIComponent(id) } : response[0];
  }
  throw new Error('Permintaan tidak dikenali.');
}

function formatDate(date) {
  return dateFormat.format(new Date(`${date}T00:00:00`));
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function switchView(name) {
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('active', view.id === `view-${name}`);
  });
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === name);
  });
  const titles = { dashboard: 'Ringkasan', inventory: 'Persediaan', transactions: 'Transaksi', reports: 'Laporan keuangan', parties: 'Pelanggan & pemasok' };
  byId('page-title').textContent = titles[name];
  if (name === 'reports') loadReport().catch((error) => showNotice(error.message, true));
}

function partyRoleLabel(role) {
  return { customer: 'Pelanggan', supplier: 'Pemasok', both: 'Pelanggan & pemasok' }[role] || role;
}

function productOptions() {
  return '<option value="">Pilih barang</option>' + state.products.map((product) =>
    `<option value="${esc(product.id)}" data-sale-price="${Number(product.selling_price)}" data-purchase-price="${Number(product.cost_price)}">${esc(product.name)} · ${esc(product.sku)}</option>`).join('');
}

function renderPartyOptions() {
  setPartyOptions(byId('transaction-party'), byId('transaction-type').value);
}

function setPartyOptions(select, transactionType) {
  const requiredRole = transactionType === 'purchase' ? 'supplier' : 'customer';
  const allowed = state.parties.filter((party) => party.party_type === requiredRole || party.party_type === 'both');
  const previous = select.value;
  select.innerHTML = '<option value="">Pilih kontak</option>' + allowed.map((party) =>
    `<option value="${esc(party.id)}">${esc(party.name)}</option>`).join('');
  if (allowed.some((party) => party.id === previous)) select.value = previous;
}

function itemRow(transactionType = byId('transaction-type').value) {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.transactionType = transactionType;
  row.innerHTML = `
    <select aria-label="Sparepart" required>
      ${productOptions()}
    </select>
    <input aria-label="Jumlah" type="number" min="1" step="1" value="1" required>
    <input aria-label="Harga satuan" type="number" min="0" step="1" placeholder="Harga" required>
    <button class="remove-item" type="button" aria-label="Hapus barang">×</button>`;
  const [productSelect, quantityInput, priceInput, removeButton] = row.children;
  const refreshRowTotal = () => {
    const isEditing = Boolean(row.closest('#edit-transaction-items'));
    updateTotal(isEditing ? 'edit-transaction-items' : 'transaction-items', isEditing ? 'edit-transaction-total' : 'transaction-total');
  };
  productSelect.addEventListener('change', () => {
    const selected = productSelect.selectedOptions[0];
    const typeSelect = row.closest('#edit-transaction-items') ? byId('edit-transaction-type') : byId('transaction-type');
    const activeType = typeSelect?.value || row.dataset.transactionType;
    const price = selected?.dataset[activeType === 'sale' ? 'salePrice' : 'purchasePrice'];
    if (price != null) priceInput.value = price;
    refreshRowTotal();
  });
  quantityInput.addEventListener('input', refreshRowTotal);
  priceInput.addEventListener('input', refreshRowTotal);
  removeButton.addEventListener('click', () => {
    const container = row.closest('#edit-transaction-items') || byId('transaction-items');
    if (container.children.length === 1) {
      productSelect.value = '';
      quantityInput.value = '1';
      priceInput.value = '';
    } else {
      row.remove();
    }
    refreshRowTotal();
  });
  return row;
}

function refreshProductOptions() {
  [...byId('transaction-items').children].forEach((row) => {
    const select = row.children[0];
    const selectedId = select.value;
    select.innerHTML = productOptions();
    select.value = selectedId;
    if (selectedId && !select.value) row.children[2].value = '';
  });
}

function updateTotal(containerId = 'transaction-items', totalId = 'transaction-total') {
  const total = [...byId(containerId).children].reduce((sum, row) => {
    const quantity = Number(row.children[1].value);
    const price = Number(row.children[2].value);
    return sum + (Number.isFinite(quantity * price) ? quantity * price : 0);
  }, 0);
  byId(totalId).textContent = currency.format(total);
}

function renderProducts() {
  byId('inventory-count').textContent = `${state.products.length} jenis sparepart`;
  byId('inventory-table').innerHTML = state.products.length ? state.products.map((product) => {
    const low = Number(product.stock) <= 5;
    return `<tr>
      <td><strong>${esc(product.name)}</strong><small>${esc(product.sku)}</small></td>
      <td>${esc(product.category || '—')}</td>
      <td><strong>${Number(product.stock)} unit</strong></td>
      <td>${currency.format(Number(product.cost_price))}</td>
      <td>${currency.format(Number(product.selling_price))}</td>
      <td><span class="stock-pill ${low ? 'stock-low' : 'stock-ok'}">${low ? (Number(product.stock) === 0 ? 'Habis' : 'Menipis') : 'Tersedia'}</span></td>
      <td><div class="row-actions"><button class="row-action edit" type="button" data-action="edit-product" data-id="${esc(product.id)}">Edit</button><button class="row-action delete" type="button" data-action="delete-product" data-id="${esc(product.id)}">Hapus</button></div></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty-cell">Belum ada sparepart. Tambahkan barang terlebih dahulu.</td></tr>';
}

function renderParties() {
  byId('parties-table').innerHTML = state.parties.length ? state.parties.map((party) => `<tr>
    <td><strong>${esc(party.name)}</strong></td>
    <td>${esc(partyRoleLabel(party.party_type))}</td>
    <td>${esc(party.phone || '—')}</td>
    <td>${formatDate(party.created_at.slice(0, 10))}</td>
    <td><div class="row-actions"><button class="row-action edit" type="button" data-action="edit-party" data-id="${esc(party.id)}">Edit</button><button class="row-action delete" type="button" data-action="delete-party" data-id="${esc(party.id)}">Hapus</button></div></td>
  </tr>`).join('') : '<tr><td colspan="5" class="empty-cell">Belum ada kontak yang ditambahkan.</td></tr>';
  renderPartyOptions();
}

function renderTransactions() {
  const tableRows = state.transactions.map((transaction) => {
    const isSale = transaction.transaction_type === 'sale';
    const items = transaction.transaction_items || [];
    const details = items.map((item) => `${esc(item.spare_parts?.name || 'Sparepart')} × ${Number(item.quantity)}`).join(', ');
    return `<tr>
      <td>${formatDate(transaction.transaction_date)}</td>
      <td><span class="type-pill ${isSale ? 'type-sale' : 'type-purchase'}">${isSale ? 'Penjualan' : 'Pembelian'}</span></td>
      <td>${esc(transaction.parties?.name || '—')}</td>
      <td>${details || '—'}</td>
      <td><strong>${currency.format(Number(transaction.total_amount))}</strong></td>
      <td><div class="row-actions"><button class="row-action edit" type="button" data-action="edit-transaction" data-id="${esc(transaction.id)}">Edit</button><button class="row-action delete" type="button" data-action="delete-transaction" data-id="${esc(transaction.id)}">Hapus</button></div></td>
    </tr>`;
  });
  byId('transactions-table').innerHTML = tableRows.length ? tableRows.join('') : '<tr><td colspan="6" class="empty-cell">Belum ada transaksi.</td></tr>';
  const recent = state.transactions.slice(0, 5);
  byId('recent-transactions').innerHTML = recent.length ? recent.map((transaction) => {
    const isSale = transaction.transaction_type === 'sale';
    const name = transaction.parties?.name || (isSale ? 'Penjualan' : 'Pembelian');
    return `<div class="recent-item">
      <div class="recent-left"><span class="recent-icon ${isSale ? 'sale' : 'purchase'}">${isSale ? '↗' : '↙'}</span>
        <div><div class="recent-name">${esc(name)}</div><div class="recent-meta">${isSale ? 'Penjualan' : 'Pembelian'} · ${formatDate(transaction.transaction_date)}</div></div>
      </div><div class="recent-amount">${currency.format(Number(transaction.total_amount))}</div>
    </div>`;
  }).join('') : '<div class="recent-empty">Belum ada transaksi yang dicatat.</div>';
}

function renderDashboard() {
  const dashboard = state.dashboard;
  byId('stat-sales').textContent = currency.format(Number(dashboard.sales));
  byId('stat-purchases').textContent = currency.format(Number(dashboard.purchases));
  byId('stat-profit').textContent = currency.format(Number(dashboard.gross_profit));
  byId('stat-products').textContent = Number(dashboard.product_count).toLocaleString('id-ID');
  byId('stat-low-stock').textContent = `${Number(dashboard.low_stock_count).toLocaleString('id-ID')} stok menipis`;
}

function transactionGrossProfit(transaction) {
  if (transaction.transaction_type !== 'sale') return 0;
  return (transaction.transaction_items || []).reduce((sum, item) =>
    sum + (Number(item.unit_price) - Number(item.unit_cost)) * Number(item.quantity), 0);
}

function renderReport(report) {
  state.report = report;
  byId('report-sales').textContent = currency.format(Number(report.sales));
  byId('report-purchases').textContent = currency.format(Number(report.purchases));
  byId('report-profit').textContent = currency.format(Number(report.gross_profit));
  byId('report-count').textContent = Number(report.transaction_count).toLocaleString('id-ID');
  byId('report-period-label').textContent = `${formatDate(report.from)} — ${formatDate(report.to)} · ${Number(report.transaction_count).toLocaleString('id-ID')} transaksi`;
  byId('export-report').disabled = report.transactions.length === 0;
  byId('report-table').innerHTML = report.transactions.length ? report.transactions.map((transaction) => {
    const isSale = transaction.transaction_type === 'sale';
    const details = (transaction.transaction_items || []).map((item) =>
      `${esc(item.spare_parts?.name || 'Sparepart')} × ${Number(item.quantity)}`).join(', ');
    return `<tr>
      <td>${formatDate(transaction.transaction_date)}</td>
      <td><span class="type-pill ${isSale ? 'type-sale' : 'type-purchase'}">${isSale ? 'Penjualan' : 'Pembelian'}</span></td>
      <td>${esc(transaction.parties?.name || '—')}</td>
      <td>${details || '—'}</td>
      <td><strong>${currency.format(Number(transaction.total_amount))}</strong></td>
      <td>${isSale ? currency.format(transactionGrossProfit(transaction)) : '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-cell">Tidak ada transaksi pada rentang tanggal ini.</td></tr>';
}

async function loadReport() {
  const from = byId('report-from').value;
  const to = byId('report-to').value;
  if (!from || !to) return;
  if (from > to) {
    throw new Error('Tanggal awal tidak boleh melewati tanggal akhir.');
  }
  const report = await api(`/api/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  renderReport(report);
}

function csvField(value) {
  let text = String(value ?? '');
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportReportCsv() {
  if (!state.report || state.report.transactions.length === 0) return;
  const rows = [[
    'Tanggal', 'Jenis transaksi', 'Pelanggan / pemasok', 'SKU', 'Sparepart',
    'Jumlah', 'Harga satuan', 'Harga pokok satuan', 'Total baris', 'Laba kotor', 'Catatan',
  ]];
  state.report.transactions.forEach((transaction) => {
    const items = transaction.transaction_items || [];
    if (items.length === 0) {
      rows.push([transaction.transaction_date, transaction.transaction_type === 'sale' ? 'Penjualan' : 'Pembelian',
        transaction.parties?.name || '', '', '', '', '', '', transaction.total_amount, '', transaction.notes || '']);
      return;
    }
    items.forEach((item) => {
      const isSale = transaction.transaction_type === 'sale';
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);
      const unitCost = Number(item.unit_cost);
      rows.push([
        transaction.transaction_date,
        isSale ? 'Penjualan' : 'Pembelian',
        transaction.parties?.name || '',
        item.spare_parts?.sku || '',
        item.spare_parts?.name || '',
        quantity,
        unitPrice,
        unitCost,
        quantity * unitPrice,
        isSale ? quantity * (unitPrice - unitCost) : '',
        transaction.notes || '',
      ]);
    });
  });
  const csv = `\uFEFF${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = `laporan-keuangan-${state.report.from}-${state.report.to}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

async function refreshData() {
  const [dashboard, products, parties, transactions] = await Promise.all([
    api('/api/dashboard'),
    api('/api/products'),
    api('/api/parties'),
    api('/api/transactions'),
  ]);
  state.dashboard = dashboard;
  state.products = products;
  state.parties = parties;
  state.transactions = transactions;
  refreshProductOptions();
  renderDashboard();
  renderProducts();
  renderParties();
  renderTransactions();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function openEditDialog(entity, record) {
  const form = byId('edit-form');
  byId('edit-form-error').hidden = true;
  byId('edit-form-error').textContent = '';
  form.dataset.entity = entity;
  form.dataset.id = record.id;
  const transaction = entity === 'transaction';
  byId('edit-dialog-title').textContent = entity === 'product' ? 'Edit sparepart' : transaction ? 'Edit transaksi' : 'Edit kontak';
  byId('edit-product-fields').hidden = entity !== 'product';
  byId('edit-party-fields').hidden = entity !== 'party';
  byId('edit-transaction-fields').hidden = !transaction;
  [...byId('edit-product-fields').querySelectorAll('input')].forEach((input) => { input.disabled = entity !== 'product'; });
  [...byId('edit-party-fields').querySelectorAll('input, select')].forEach((input) => { input.disabled = entity !== 'party'; });
  [...byId('edit-transaction-fields').querySelectorAll('input, select, button')].forEach((input) => { input.disabled = !transaction; });
  if (entity === 'product') {
    byId('edit-product-sku').value = record.sku;
    byId('edit-product-name').value = record.name;
    byId('edit-product-category').value = record.category || '';
    byId('edit-product-price').value = record.selling_price;
  } else if (entity === 'party') {
    byId('edit-party-name').value = record.name;
    byId('edit-party-type').value = record.party_type;
    byId('edit-party-phone').value = record.phone || '';
  } else if (transaction) {
    byId('edit-transaction-type').value = record.transaction_type;
    byId('edit-transaction-date').value = record.transaction_date;
    setPartyOptions(byId('edit-transaction-party'), record.transaction_type);
    byId('edit-transaction-party').value = record.party_id;
    byId('edit-transaction-notes').value = record.notes || '';
    const rows = (record.transaction_items || []).map((item) => {
      const row = itemRow(record.transaction_type);
      row.children[0].value = item.spare_part_id;
      row.children[1].value = item.quantity;
      row.children[2].value = item.unit_price;
      return row;
    });
    byId('edit-transaction-items').replaceChildren(...(rows.length ? rows : [itemRow(record.transaction_type)]));
    updateTotal('edit-transaction-items', 'edit-transaction-total');
  }
  byId('edit-dialog').showModal();
  const firstInput = entity === 'product'
    ? byId('edit-product-sku')
    : entity === 'party'
      ? byId('edit-party-name')
      : byId('edit-transaction-type');
  firstInput.focus();
}

async function handleRowAction(action, id) {
  if (action === 'edit-transaction') {
    const transaction = state.transactions.find((item) => item.id === id);
    if (transaction) openEditDialog('transaction', transaction);
    return;
  }
  const isProduct = action.endsWith('product');
  const isTransaction = action === 'delete-transaction';
  const record = (isProduct ? state.products : isTransaction ? state.transactions : state.parties).find((item) => item.id === id);
  if (!record) return;
  if (action.startsWith('edit-')) {
    openEditDialog(isProduct ? 'product' : 'party', record);
    return;
  }
  const label = isProduct ? 'sparepart' : isTransaction ? 'transaksi' : 'kontak';
  const description = isTransaction
    ? `Hapus transaksi ${formatDate(record.transaction_date)} senilai ${currency.format(Number(record.total_amount))}? Stok dan harga pokok akan dihitung ulang.`
    : `Hapus ${label} "${record.name}"? Data yang sudah digunakan dalam transaksi tidak dapat dihapus.`;
  if (!window.confirm(description)) return;
  try {
    await api(`/api/${isProduct ? 'products' : isTransaction ? 'transactions' : 'parties'}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshData();
    showNotice(`${isProduct ? 'Sparepart' : isTransaction ? 'Transaksi' : 'Kontak'} berhasil dihapus.`);
  } catch (error) {
    showNotice(error.message, true);
  }
}

document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});
document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.go));
});
byId('transaction-type').addEventListener('change', renderPartyOptions);
byId('open-supabase-config').addEventListener('click', () => {
  byId('supabase-config-error').hidden = true;
  byId('supabase-project-url').value = SUPABASE_URL;
  byId('supabase-anon-key').value = SUPABASE_ANON_KEY;
  byId('supabase-config-dialog').showModal();
});
byId('close-supabase-config').addEventListener('click', () => byId('supabase-config-dialog').close());
byId('supabase-config-dialog').addEventListener('click', (event) => {
  if (event.target === byId('supabase-config-dialog')) byId('supabase-config-dialog').close();
});
byId('clear-supabase-config').addEventListener('click', () => {
  SUPABASE_URL = '';
  SUPABASE_ANON_KEY = '';
  try {
    localStorage.removeItem('rodakas-supabase-config');
  } catch {
    showNotice('Konfigurasi dihapus dari aplikasi. Penyimpanan browser tidak tersedia untuk halaman file lokal.', true);
  }
  byId('supabase-project-url').value = '';
  byId('supabase-anon-key').value = '';
  byId('supabase-config-dialog').close();
  byId('loading').hidden = true;
  showNotice('Konfigurasi Supabase dihapus. Hubungkan kembali untuk memuat data.', true);
});
byId('supabase-config-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorBox = byId('supabase-config-error');
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const urlValue = byId('supabase-project-url').value.trim().replace(/\/+$/, '');
  const keyValue = byId('supabase-anon-key').value.trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    errorBox.textContent = 'Project URL tidak valid.';
    errorBox.hidden = false;
    return;
  }
  if (parsedUrl.protocol !== 'https:') {
    errorBox.textContent = 'Project URL harus menggunakan HTTPS.';
    errorBox.hidden = false;
    return;
  }
  if (!keyValue || /^sb_secret_/i.test(keyValue)) {
    errorBox.textContent = 'Masukkan anon/public/publishable key. Service-role atau secret key tidak boleh digunakan di browser.';
    errorBox.hidden = false;
    return;
  }
  SUPABASE_URL = urlValue;
  SUPABASE_ANON_KEY = keyValue;
  try {
    localStorage.setItem('rodakas-supabase-config', JSON.stringify({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }));
  } catch {
    showNotice('Pengaturan tersimpan sementara di tab ini saja karena browser tidak mengizinkan penyimpanan untuk file lokal.');
  }
  submit.disabled = true;
  errorBox.hidden = true;
  byId('loading').textContent = 'Menghubungkan ke database...';
  byId('loading').hidden = false;
  try {
    await refreshData();
    byId('supabase-config-dialog').close();
    byId('loading').hidden = true;
    showNotice('Berhasil terhubung ke Supabase.');
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    byId('loading').hidden = true;
  } finally {
    submit.disabled = false;
  }
});
byId('report-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await loadReport();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});
byId('export-report').addEventListener('click', exportReportCsv);
document.querySelectorAll('#inventory-table, #parties-table, #transactions-table').forEach((table) => {
  table.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) handleRowAction(button.dataset.action, button.dataset.id);
  });
});
byId('close-edit-dialog').addEventListener('click', () => byId('edit-dialog').close());
byId('cancel-edit').addEventListener('click', () => byId('edit-dialog').close());
byId('edit-dialog').addEventListener('click', (event) => {
  if (event.target === byId('edit-dialog')) byId('edit-dialog').close();
});
byId('edit-transaction-type').addEventListener('change', () => {
  setPartyOptions(byId('edit-transaction-party'), byId('edit-transaction-type').value);
});
byId('edit-add-item').addEventListener('click', () => {
  byId('edit-transaction-items').append(itemRow(byId('edit-transaction-type').value));
});
byId('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const entity = form.dataset.entity;
  const isProduct = entity === 'product';
  const submit = form.querySelector('[type="submit"]');
  const payload = isProduct ? {
      sku: byId('edit-product-sku').value,
      name: byId('edit-product-name').value,
      category: byId('edit-product-category').value,
      selling_price: Number(byId('edit-product-price').value),
    } : entity === 'party' ? {
      name: byId('edit-party-name').value,
      party_type: byId('edit-party-type').value,
      phone: byId('edit-party-phone').value,
    } : {
      transaction_type: byId('edit-transaction-type').value,
      transaction_date: byId('edit-transaction-date').value,
      party_id: byId('edit-transaction-party').value,
      notes: byId('edit-transaction-notes').value,
      items: [...byId('edit-transaction-items').children].map((row) => ({
        spare_part_id: row.children[0].value,
        quantity: Number(row.children[1].value),
        unit_price: Number(row.children[2].value),
      })),
    };
  submit.disabled = true;
  try {
    await api(`/api/${entity === 'transaction' ? 'transactions' : isProduct ? 'products' : 'parties'}/${encodeURIComponent(form.dataset.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    byId('edit-dialog').close();
    await refreshData();
    showNotice(`${isProduct ? 'Sparepart' : entity === 'transaction' ? 'Transaksi' : 'Kontak'} berhasil diperbarui.`);
  } catch (error) {
    if (!byId('edit-dialog').open) {
      showNotice(error.message, true);
    } else {
      byId('edit-form-error').textContent = error.message;
      byId('edit-form-error').hidden = false;
    }
  } finally {
    submit.disabled = false;
  }
});
byId('add-item').addEventListener('click', () => {
  byId('transaction-items').append(itemRow());
});

byId('transaction-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const items = [...byId('transaction-items').children].map((row) => ({
    spare_part_id: row.children[0].value,
    quantity: Number(row.children[1].value),
    unit_price: Number(row.children[2].value),
  }));
  const payload = { ...formObject(form), items };
  submit.disabled = true;
  try {
    await api('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    byId('transaction-date').value = localDateString();
    byId('transaction-items').replaceChildren(itemRow());
    updateTotal();
    await refreshData();
    showNotice('Transaksi berhasil disimpan dan stok telah diperbarui.');
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

byId('product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const data = formObject(form);
  data.selling_price = Number(data.selling_price);
  submit.disabled = true;
  try {
    await api('/api/products', { method: 'POST', body: JSON.stringify(data) });
    form.reset();
    await refreshData();
    showNotice('Sparepart berhasil ditambahkan.');
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

byId('party-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api('/api/parties', { method: 'POST', body: JSON.stringify(formObject(form)) });
    form.reset();
    await refreshData();
    showNotice('Kontak berhasil ditambahkan.');
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

byId('today-label').textContent = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date());
function localDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
byId('transaction-date').value = localDateString();
const today = localDateString();
byId('report-from').value = `${today.slice(0, 7)}-01`;
byId('report-to').value = today;
byId('transaction-items').append(itemRow());
refreshData()
  .then(() => { byId('loading').hidden = true; })
  .catch((error) => {
    byId('loading').hidden = true;
    byId('supabase-project-url').value = SUPABASE_URL;
    byId('supabase-anon-key').value = SUPABASE_ANON_KEY;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      byId('supabase-config-error').textContent = error.message;
      byId('supabase-config-error').hidden = false;
      byId('supabase-config-dialog').showModal();
    } else {
      showNotice(error.message, true);
    }
  });
