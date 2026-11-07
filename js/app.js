'use strict';

/* =====================================================================
   Alquiler de Prendas — control de alquileres (demo, datos en el navegador)

   Reglas de negocio
   - Alquiler   = Σ cantidad × precio unitario
   - Garantía   = se cobra al alquilar y se devuelve cuando el cliente entrega
                  TODAS las prendas (se descuentan daños / deuda pendiente)
   - Mora       = S/ por día (por contrato) desde la fecha límite hasta la
                  fecha de la ÚLTIMA devolución (o hoy, si aún falta devolver)
   - Saldo      = alquiler + garantía + mora + daños − pagado
                  − garantía reintegrable (solo si devolvió todo) + garantía devuelta
                  > 0  → el cliente debe
                  < 0  → la tienda debe devolver ese monto (garantía)
   ===================================================================== */

const STORAGE_KEY = 'alquilerPrendas.v1';
const METHODS = ['Efectivo', 'Yape', 'Plin', 'Tarjeta', 'Transferencia'];

/* ---------------------------------------------------------------------
   Utilidades
   --------------------------------------------------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = n => r2(n).toFixed(2);
const money = n => 'S/ ' + r2(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const todayStr = () => toDateStr(new Date());
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return toDateStr(new Date(y, m - 1, d + n));
}
/* días de a → b (b − a) */
function diffDays(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

/* ---------------------------------------------------------------------
   Datos
   --------------------------------------------------------------------- */
function defaultData() {
  return {
    settings: {
      storeName: 'Alquiler de Prendas Elegantes',
      storeAddress: '',
      storePhone: '',
      lateFee: 10,
      defaultDays: 2,
      nextNumber: 1
    },
    rentals: []
  };
}

function normalize(d) {
  const base = defaultData();
  return {
    settings: { ...base.settings, ...(d && d.settings) },
    rentals: Array.isArray(d && d.rentals) ? d.rentals : []
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) { /* almacenamiento no disponible o dañado */ }
  return defaultData();
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('No se pudo guardar en este navegador', 'error');
  }
}

const findRental = id => state.rentals.find(r => r.id === id);

function nextNumber() {
  const n = state.settings.nextNumber++;
  return 'A-' + String(n).padStart(4, '0');
}

/* ---------------------------------------------------------------------
   Cálculos
   --------------------------------------------------------------------- */
function calc(r) {
  const today = todayStr();
  const rental = r2(r.items.reduce((s, i) => s + i.qty * i.price, 0));
  const units = r.items.reduce((s, i) => s + i.qty, 0);
  const returnedUnits = r.items.reduce((s, i) => s + (i.returnedQty || 0), 0);
  const pendingUnits = units - returnedUnits;
  const allReturned = pendingUnits <= 0;
  const lastReturn = r.returns.length ? r.returns.map(x => x.date).sort().slice(-1)[0] : null;
  const endDate = allReturned ? (lastReturn || today) : today;
  const lateDays = Math.max(0, diffDays(r.dueDate, endDate));
  const feePerDay = r2(r.lateFee ?? state.settings.lateFee);
  const lateFee = r2(lateDays * feePerDay);
  const damages = r2(r.returns.reduce((s, x) => s + (Number(x.damageAmount) || 0), 0));
  const deposit = r2(r.deposit);
  const paid = r2(r.payments.filter(p => p.type !== 'devolucion').reduce((s, p) => s + p.amount, 0));
  const refunded = r2(r.payments.filter(p => p.type === 'devolucion').reduce((s, p) => s + p.amount, 0));
  const charges = r2(rental + deposit + lateFee + damages);
  const depositCredit = allReturned ? deposit : 0;
  let balance = r2(charges - paid - depositCredit + refunded);
  if (Math.abs(balance) < 0.005) balance = 0;
  const dniPending = !!r.dniRetained && !r.dniReturned;

  let status, cls;
  if (!allReturned) {
    if (today > r.dueDate) { status = 'Vencido'; cls = 'danger'; }
    else if (returnedUnits > 0) { status = 'Devolución parcial'; cls = 'info'; }
    else { status = 'Alquilado'; cls = 'primary'; }
  } else if (balance > 0) { status = 'Devuelto con deuda'; cls = 'warning'; }
  else if (balance < 0) { status = 'Garantía por devolver'; cls = 'purple'; }
  else if (dniPending) { status = 'DNI por devolver'; cls = 'warning'; }
  else { status = 'Cerrado'; cls = 'success'; }

  return {
    rental, units, returnedUnits, pendingUnits, allReturned, endDate, lateDays, feePerDay, lateFee,
    damages, deposit, paid, refunded, charges, depositCredit, balance, dniPending, status, cls
  };
}

/* filas del resumen de montos (se usan en pantalla y en el PDF) */
function summaryRows(c) {
  const rows = [
    { label: 'Alquiler', value: c.rental },
    { label: 'Garantía (seguro)', value: c.deposit }
  ];
  if (c.lateFee > 0) rows.push({ label: `Mora (${plural(c.lateDays, 'día')} × ${money(c.feePerDay)})`, value: c.lateFee });
  if (c.damages > 0) rows.push({ label: 'Daños', value: c.damages });
  rows.push({ label: 'Total cargos', value: c.charges, strong: true });
  rows.push({ label: 'Pagado por el cliente', value: -c.paid });
  if (c.depositCredit > 0) rows.push({ label: 'Garantía reintegrable (devolvió todo)', value: -c.depositCredit });
  if (c.refunded > 0) rows.push({ label: 'Garantía devuelta al cliente', value: c.refunded });
  return rows;
}

function balanceLabel(c) {
  if (c.balance > 0) return 'Saldo por pagar';
  if (c.balance < 0) return 'A devolver al cliente';
  return 'Saldo';
}

function dueText(r, c) {
  if (c.allReturned) return 'Devuelto el ' + fmtDate(c.endDate);
  const d = diffDays(todayStr(), r.dueDate);
  if (d > 0) return `Vence en ${plural(d, 'día')}`;
  if (d === 0) return 'Vence hoy';
  return `Vencido hace ${plural(-d, 'día')}`;
}

const fullName = r => `${r.customer.firstName} ${r.customer.lastName}`.trim();

/* ---------------------------------------------------------------------
   Navegación
   --------------------------------------------------------------------- */
function showView(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'pendientes') renderPending();
  if (name === 'historial') renderHistory();
  window.scrollTo({ top: 0 });
}

function refreshAll() {
  const open = state.rentals.filter(r => !calc(r).allReturned).length;
  $('#badgePend').textContent = open;
  $('#brandName').textContent = state.settings.storeName || 'Alquiler de Prendas';
  renderPending();
  renderHistory();
}

/* ---------------------------------------------------------------------
   Nuevo alquiler
   --------------------------------------------------------------------- */
const form = () => $('#formRental');

function itemRowHtml() {
  return `<tr>
    <td class="nro"></td>
    <td data-label="Cantidad"><input type="number" class="i-qty" min="1" step="1" value="1"></td>
    <td class="desc" data-label="Descripción"><input class="i-desc" placeholder="Ej.: Terno negro slim talla 40"></td>
    <td data-label="Precio unit."><input type="number" class="i-price" min="0" step="0.01" placeholder="0.00"></td>
    <td class="amount" data-label="Importe">S/ 0.00</td>
    <td><button type="button" class="btn-icon i-del" title="Quitar prenda" aria-label="Quitar prenda">✕</button></td>
  </tr>`;
}

function addItemRow(focus = false) {
  $('#itemsBody').insertAdjacentHTML('beforeend', itemRowHtml());
  renumberItems();
  if (focus) $('#itemsBody tr:last-child .i-desc').focus();
}

function renumberItems() {
  $$('#itemsBody tr').forEach((tr, i) => { tr.querySelector('.nro').textContent = i + 1; });
}

function readItems() {
  return $$('#itemsBody tr').map(tr => ({
    tr,
    qty: Number(tr.querySelector('.i-qty').value),
    description: tr.querySelector('.i-desc').value.trim(),
    price: Number(tr.querySelector('.i-price').value || 0)
  }));
}

function updateFormTotals() {
  const f = form();
  let rental = 0;
  readItems().forEach(it => {
    const amount = (it.qty > 0 ? it.qty : 0) * (it.price > 0 ? it.price : 0);
    rental += amount;
    it.tr.querySelector('.amount').textContent = money(amount);
  });
  rental = r2(rental);
  const deposit = r2(Math.max(0, Number(f.deposit.value) || 0));
  const total = r2(rental + deposit);
  const mode = f.payMode.value;
  if (mode === 'total') f.advance.value = num(total);
  if (mode === 'nada') f.advance.value = '0';
  f.advance.disabled = mode !== 'adelanto';
  const advance = r2(Math.max(0, Number(f.advance.value) || 0));
  $('#tRental').textContent = money(rental);
  $('#tDeposit').textContent = money(deposit);
  $('#tTotal').textContent = money(total);
  $('#tBalance').textContent = money(Math.max(0, total - advance));
}

function resetRentalForm() {
  const f = form();
  f.reset();
  $('#itemsBody').innerHTML = '';
  addItemRow();
  f.rentDate.value = todayStr();
  f.dueDate.value = addDays(todayStr(), Number(state.settings.defaultDays) || 0);
  f.deposit.value = '0';
  f.advance.value = '0';
  $$('.invalid', f).forEach(el => el.classList.remove('invalid'));
  updateFormTotals();
}

function fillCustomerByDni() {
  const f = form();
  const dni = f.dni.value.trim();
  if (!/^\d{8}$/.test(dni)) return;
  const prev = state.rentals.filter(r => r.customer.dni === dni).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!prev) return;
  let filled = false;
  ['firstName', 'lastName', 'phone', 'address'].forEach(k => {
    if (!f[k].value.trim()) { f[k].value = prev.customer[k]; filled = true; }
  });
  if (filled) toast(`Cliente frecuente: ${fullName(prev)}`);
}

function onSubmitRental(e) {
  e.preventDefault();
  const f = form();
  $$('.invalid', f).forEach(el => el.classList.remove('invalid'));
  const errors = [];
  const bad = (el, msg) => { el.classList.add('invalid'); errors.push(msg); };

  const customer = {
    dni: f.dni.value.trim(),
    firstName: f.firstName.value.trim(),
    lastName: f.lastName.value.trim(),
    phone: f.phone.value.trim(),
    address: f.address.value.trim()
  };
  if (!/^\d{8}$/.test(customer.dni)) bad(f.dni, 'El DNI debe tener 8 dígitos');
  if (!customer.firstName) bad(f.firstName, 'Ingrese los nombres');
  if (!customer.lastName) bad(f.lastName, 'Ingrese los apellidos');
  if (!/^\d{9}$/.test(customer.phone)) bad(f.phone, 'El teléfono debe tener 9 dígitos');
  if (!customer.address) bad(f.address, 'Ingrese la dirección');

  const items = [];
  readItems().forEach(it => {
    const empty = !it.description && !it.price;
    if (empty && readItems().length > 1) return;   // filas vacías se ignoran
    if (!it.description) bad(it.tr.querySelector('.i-desc'), 'Cada prenda necesita una descripción');
    if (!Number.isInteger(it.qty) || it.qty < 1) bad(it.tr.querySelector('.i-qty'), 'La cantidad debe ser un entero mayor a 0');
    if (!(it.price >= 0)) bad(it.tr.querySelector('.i-price'), 'Precio inválido');
    items.push({ qty: it.qty, description: it.description, price: r2(it.price), returnedQty: 0 });
  });
  if (!items.length) errors.push('Agregue al menos una prenda');

  const rentDate = f.rentDate.value;
  const dueDate = f.dueDate.value;
  if (!rentDate) bad(f.rentDate, 'Ingrese la fecha de alquiler');
  if (!dueDate) bad(f.dueDate, 'Ingrese la fecha límite de entrega');
  if (rentDate && dueDate && dueDate < rentDate) bad(f.dueDate, 'La fecha límite no puede ser anterior al alquiler');

  const deposit = r2(Number(f.deposit.value));
  if (!(deposit >= 0)) bad(f.deposit, 'Garantía inválida');

  const total = r2(items.reduce((s, i) => s + i.qty * i.price, 0) + deposit);
  const advance = r2(Number(f.advance.value) || 0);
  if (advance < 0 || advance > total + 0.001) bad(f.advance, 'El pago no puede ser mayor al total a cobrar');

  if (errors.length) {
    toast([...new Set(errors)][0], 'error');
    const first = $('.invalid', f);
    if (first) first.focus();
    return;
  }

  const rental = {
    id: uid(),
    number: nextNumber(),
    createdAt: new Date().toISOString(),
    rentDate,
    dueDate,
    customer,
    items,
    deposit,
    lateFee: r2(state.settings.lateFee),
    dniRetained: f.dniRetained.checked,
    dniReturned: false,
    dniReturnedDate: null,
    comments: f.comments.value.trim(),
    payments: [],
    returns: []
  };
  if (advance > 0) {
    rental.payments.push({
      id: uid(), type: 'pago', date: rentDate, amount: advance, method: f.payMethod.value,
      note: advance >= total ? 'Pago total al alquilar' : 'Adelanto'
    });
  }

  state.rentals.push(rental);
  save();
  refreshAll();
  resetRentalForm();
  toast(`Alquiler ${rental.number} guardado`);
  openDetail(rental.id);
}

/* ---------------------------------------------------------------------
   Pendientes
   --------------------------------------------------------------------- */
let pendFilter = 'devolver';

function matchesSearch(r, q) {
  if (!q) return true;
  const hay = [r.number, r.customer.dni, r.customer.phone, fullName(r)].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => hay.includes(w));
}

function renderPending() {
  const all = state.rentals.map(r => ({ r, c: calc(r) }));

  const out = all.filter(x => !x.c.allReturned);
  const stats = {
    units: out.reduce((s, x) => s + x.c.pendingUnits, 0),
    late: all.filter(x => x.c.status === 'Vencido').length,
    debt: all.reduce((s, x) => s + Math.max(0, x.c.balance), 0),
    refund: all.reduce((s, x) => s + Math.max(0, -x.c.balance), 0)
  };
  $('#stats').innerHTML = `
    <div class="stat"><div class="label">Prendas fuera de tienda</div><div class="value">${stats.units}</div></div>
    <div class="stat danger"><div class="label">Contratos vencidos</div><div class="value">${stats.late}</div></div>
    <div class="stat warning"><div class="label">Deuda por cobrar</div><div class="value">${money(stats.debt)}</div></div>
    <div class="stat purple"><div class="label">Garantías por devolver</div><div class="value">${money(stats.refund)}</div></div>`;

  const q = $('#pendSearch').value.trim();
  const filters = {
    devolver: x => !x.c.allReturned,
    vencidos: x => x.c.status === 'Vencido',
    deuda: x => x.c.balance > 0,
    garantia: x => x.c.allReturned && (x.c.balance < 0 || x.c.dniPending),
    abiertos: x => x.c.status !== 'Cerrado'
  };
  const list = all
    .filter(filters[pendFilter])
    .filter(x => matchesSearch(x.r, q))
    .sort((a, b) => a.r.dueDate.localeCompare(b.r.dueDate) || a.r.number.localeCompare(b.r.number));

  if (!list.length) {
    $('#pendList').innerHTML = `<div class="empty">No hay alquileres en esta lista.${state.rentals.length ? '' : '<br>Registra uno en <strong>Nuevo alquiler</strong> o carga datos de ejemplo en <strong>Ajustes</strong>.'}</div>`;
    return;
  }

  $('#pendList').innerHTML = list.map(({ r, c }) => {
    const items = r.items.map(i => `${i.qty}× ${esc(i.description)}`).join(', ');
    const partial = c.returnedUnits > 0 && !c.allReturned ? ` <span class="r-sub">(${c.returnedUnits} de ${c.units} devueltas)</span>` : '';
    const late = !c.allReturned && c.lateDays > 0;
    let bal = '<span class="r-debt">Al día</span>';
    if (c.balance > 0) bal = `<span class="r-debt pos">Debe ${money(c.balance)}</span>`;
    if (c.balance < 0) bal = `<span class="r-debt neg">Devolver ${money(-c.balance)}</span>`;
    return `<article class="r-card ${c.cls}" data-id="${r.id}" tabindex="0">
      <div class="r-top">
        <div>
          <div class="r-name">${esc(fullName(r))}</div>
          <div class="r-sub">${esc(r.number)} · DNI ${esc(r.customer.dni)} · ${esc(r.customer.phone)}</div>
        </div>
        <span class="status st-${c.cls}">${c.status}</span>
      </div>
      <div class="r-items">${items}${partial}</div>
      <div class="r-foot">
        <span class="${late ? 'r-late' : ''}">Límite ${fmtDate(r.dueDate)} · ${dueText(r, c)}${late ? ` · mora ${money(c.lateFee)}` : ''}</span>
        ${bal}
      </div>
    </article>`;
  }).join('');
}

/* ---------------------------------------------------------------------
   Historial
   --------------------------------------------------------------------- */
function renderHistory() {
  const q = $('#histSearch').value.trim();
  const st = $('#histStatus').value;
  const from = $('#histFrom').value;
  const to = $('#histTo').value;
  const rows = state.rentals
    .map(r => ({ r, c: calc(r) }))
    .filter(x => matchesSearch(x.r, q))
    .filter(x => !st || x.c.status === st)
    .filter(x => (!from || x.r.rentDate >= from) && (!to || x.r.rentDate <= to))
    .sort((a, b) => b.r.rentDate.localeCompare(a.r.rentDate) || b.r.number.localeCompare(a.r.number));

  if (!rows.length) {
    $('#histBody').innerHTML = '<tr><td colspan="8" class="empty">Sin resultados</td></tr>';
    return;
  }
  $('#histBody').innerHTML = rows.map(({ r, c }) => `
    <tr data-id="${r.id}">
      <td><strong>${esc(r.number)}</strong></td>
      <td>${fmtDate(r.rentDate)}</td>
      <td>${esc(fullName(r))}</td>
      <td>${esc(r.customer.dni)}</td>
      <td>${fmtDate(r.dueDate)}</td>
      <td class="num">${money(c.charges)}</td>
      <td class="num">${c.balance < 0 ? '−' + money(-c.balance) : money(c.balance)}</td>
      <td><span class="status st-${c.cls}">${c.status}</span></td>
    </tr>`).join('');
}

/* ---------------------------------------------------------------------
   Modal: detalle, pago, devolución
   --------------------------------------------------------------------- */
const modal = () => $('#modal');
let modalRentalId = null;

function openModal(html) {
  $('#modalBody').innerHTML = html;
  if (!modal().open) modal().showModal();
  modal().scrollTop = 0;
}

function modalHead(title, sub) {
  return `<div class="m-head">
    <div><h3>${title}</h3>${sub ? `<div class="r-sub">${sub}</div>` : ''}</div>
    <button class="m-close" data-action="close" aria-label="Cerrar">×</button>
  </div>`;
}

function openDetail(id) {
  const r = findRental(id);
  if (!r) return;
  modalRentalId = id;
  const c = calc(r);

  const notices = [];
  if (c.status === 'Vencido') {
    notices.push(`<div class="notice danger">Lleva <strong>${plural(c.lateDays, 'día')}</strong> de atraso. Mora acumulada: <strong>${money(c.lateFee)}</strong> (se suma ${money(c.feePerDay)} por cada día hasta que devuelva todo).</div>`);
  }
  if (c.allReturned && c.balance < 0) {
    notices.push(`<div class="notice purple">Todas las prendas fueron devueltas. Corresponde devolver <strong>${money(-c.balance)}</strong> de garantía al cliente.</div>`);
  }
  if (c.allReturned && c.balance > 0) {
    notices.push(`<div class="notice warning">Las prendas fueron devueltas, pero el cliente aún debe <strong>${money(c.balance)}</strong>.</div>`);
  }
  if (c.allReturned && c.dniPending) {
    notices.push(`<div class="notice info">El DNI del cliente sigue en tienda. Entrégalo al cerrar la cuenta.</div>`);
  }

  const itemsRows = r.items.map((it, i) => `
    <tr>
      <td>${i + 1}</td><td>${it.qty}</td><td>${esc(it.description)}</td>
      <td class="num">${num(it.price)}</td><td class="num">${num(it.qty * it.price)}</td>
      <td>${it.returnedQty >= it.qty ? '<span class="status st-success">Devuelto</span>' : `${it.returnedQty || 0} de ${it.qty}`}</td>
    </tr>`).join('');

  const sumRows = summaryRows(c).map(x => `
    <div class="${x.strong ? 'total-row' : 'sub'}"><dt>${x.label}</dt><dd>${x.value < 0 ? '− ' + money(-x.value) : money(x.value)}</dd></div>`).join('');
  const balCls = c.balance > 0 ? 'debt-row' : c.balance < 0 ? 'credit-row' : 'ok-row';

  const pays = r.payments.length ? `
    <table class="m-table">
      <thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th class="num">Monto</th><th></th></tr></thead>
      <tbody>${r.payments.map(p => `
        <tr>
          <td>${fmtDate(p.date)}</td>
          <td>${p.type === 'devolucion' ? 'Devolución de garantía' : 'Pago'}${p.note ? ` <span class="r-sub">· ${esc(p.note)}</span>` : ''}</td>
          <td>${esc(p.method)}</td>
          <td class="num">${p.type === 'devolucion' ? '−' : ''}${money(p.amount)}</td>
          <td><button class="btn-icon" data-action="del-payment" data-mid="${p.id}" title="Eliminar movimiento">✕</button></td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="muted">Sin pagos registrados.</p>';

  const rets = r.returns.length ? `
    <table class="m-table">
      <thead><tr><th>Fecha</th><th>Prendas</th><th class="num">Daño</th><th>Observación</th><th></th></tr></thead>
      <tbody>${r.returns.map(x => `
        <tr>
          <td>${fmtDate(x.date)}</td>
          <td>${x.items.map(i => `${i.qty}× ${esc(r.items[i.idx].description)}`).join(', ')}</td>
          <td class="num">${x.damageAmount ? money(x.damageAmount) : '—'}</td>
          <td>${esc([x.damageNote, x.note].filter(Boolean).join(' · ')) || '—'}</td>
          <td><button class="btn-icon" data-action="del-return" data-mid="${x.id}" title="Anular devolución">✕</button></td>
        </tr>`).join('')}</tbody>
    </table>` : '<p class="muted">Aún no devuelve prendas.</p>';

  let dniText = 'No dejó DNI';
  if (r.dniRetained) dniText = r.dniReturned ? `Entregado el ${fmtDate(r.dniReturnedDate)}` : 'En tienda';

  const actions = [];
  if (!c.allReturned) actions.push(`<button class="btn btn-primary" data-action="return">Registrar devolución</button>`);
  if (c.balance > 0) actions.push(`<button class="btn btn-gold" data-action="pay">Registrar pago</button>`);
  if (c.allReturned && c.balance < 0) actions.push(`<button class="btn btn-gold" data-action="refund">Devolver garantía</button>`);
  if (c.dniPending) actions.push(`<button class="btn btn-ghost" data-action="dni">Entregar DNI</button>`);
  actions.push(`<button class="btn btn-ghost" data-action="pdf">Descargar PDF</button>`);
  actions.push(`<button class="btn btn-wa" data-action="wa">Enviar por WhatsApp</button>`);
  actions.push(`<span class="spacer"></span><button class="btn btn-danger" data-action="delete">Eliminar</button>`);

  openModal(`
    ${modalHead(`Alquiler ${esc(r.number)} <span class="status st-${c.cls}">${c.status}</span>`, `${esc(fullName(r))} · ${dueText(r, c)}`)}
    <div class="m-body">
      ${notices.join('')}
      <div class="m-section">
        <h4>Cliente</h4>
        <div class="m-grid">
          <div><span class="k">Nombres y apellidos</span>${esc(fullName(r))}</div>
          <div><span class="k">DNI</span>${esc(r.customer.dni)}</div>
          <div><span class="k">Teléfono</span>${esc(r.customer.phone)}</div>
          <div><span class="k">Dirección</span>${esc(r.customer.address)}</div>
          <div><span class="k">Fecha de alquiler</span>${fmtDate(r.rentDate)}</div>
          <div><span class="k">Fecha límite de entrega</span>${fmtDate(r.dueDate)}</div>
          <div><span class="k">DNI del cliente</span>${dniText}</div>
        </div>
      </div>
      <div class="m-section">
        <h4>Prendas</h4>
        <div class="table-wrap">
          <table class="m-table">
            <thead><tr><th>Nro.</th><th>Cant.</th><th>Descripción</th><th class="num">P. unit.</th><th class="num">Importe</th><th>Devuelto</th></tr></thead>
            <tbody>${itemsRows}</tbody>
          </table>
        </div>
      </div>
      <div class="m-section">
        <h4>Cuenta del cliente</h4>
        <dl class="totals">
          ${sumRows}
          <div class="${balCls}"><dt>${balanceLabel(c)}</dt><dd>${money(Math.abs(c.balance))}</dd></div>
        </dl>
      </div>
      <div class="m-section"><h4>Pagos y devoluciones de garantía</h4><div class="table-wrap">${pays}</div></div>
      <div class="m-section"><h4>Devoluciones de prendas</h4><div class="table-wrap">${rets}</div></div>
      ${r.comments ? `<div class="m-section"><h4>Comentarios</h4><div class="comments">${esc(r.comments)}</div></div>` : ''}
    </div>
    <div class="m-actions">${actions.join('')}</div>`);
}

function openPayment(id, kind) {
  const r = findRental(id);
  const c = calc(r);
  const max = kind === 'pago' ? c.balance : -c.balance;
  const title = kind === 'pago' ? 'Registrar pago' : 'Devolver garantía';
  openModal(`
    ${modalHead(title, `${esc(r.number)} · ${esc(fullName(r))}`)}
    <form data-form="payment" data-kind="${kind}" novalidate>
      <div class="m-body">
        <div class="notice ${kind === 'pago' ? 'warning' : 'purple'}">
          ${kind === 'pago' ? 'Saldo por pagar' : 'Monto a devolver al cliente'}: <strong>${money(max)}</strong>
        </div>
        <div class="grid">
          <label class="field">Fecha
            <input type="date" name="date" value="${todayStr()}" min="${r.rentDate}" required>
          </label>
          <label class="field">Monto S/
            <input type="number" name="amount" min="0.01" max="${num(max)}" step="0.01" value="${num(max)}" required>
          </label>
          <label class="field">Medio
            <select name="payMethod">${METHODS.map(m => `<option>${m}</option>`).join('')}</select>
          </label>
          <label class="field">Nota
            <input name="note" placeholder="Opcional">
          </label>
        </div>
      </div>
      <div class="m-actions">
        <button type="button" class="btn btn-ghost" data-action="detail">Volver</button>
        <span class="spacer"></span>
        <button type="submit" class="btn btn-primary">Guardar</button>
      </div>
    </form>`);
  $('#modalBody [name=amount]').select();
}

function savePayment(formEl) {
  const r = findRental(modalRentalId);
  const c = calc(r);
  const kind = formEl.dataset.kind;
  const max = kind === 'pago' ? c.balance : -c.balance;
  const date = formEl.date.value;
  const amount = r2(formEl.amount.value);
  if (!date) return toast('Ingrese la fecha', 'error');
  if (!(amount > 0)) return toast('Ingrese un monto mayor a 0', 'error');
  if (amount > max + 0.001) return toast(`El monto no puede superar ${money(max)}`, 'error');
  r.payments.push({ id: uid(), type: kind, date, amount, method: formEl.payMethod.value, note: formEl.note.value.trim() });
  save();
  refreshAll();
  toast(kind === 'pago' ? 'Pago registrado' : 'Devolución de garantía registrada');
  openDetail(r.id);
}

function openReturn(id) {
  const r = findRental(id);
  const rows = r.items.map((it, idx) => ({ it, idx, pending: it.qty - (it.returnedQty || 0) })).filter(x => x.pending > 0);
  openModal(`
    ${modalHead('Registrar devolución', `${esc(r.number)} · ${esc(fullName(r))} · límite ${fmtDate(r.dueDate)}`)}
    <form data-form="return" novalidate>
      <div class="m-body">
        <div class="m-section">
          <h4>Prendas que devuelve</h4>
          <div class="table-wrap">
            <table class="m-table">
              <thead><tr><th>Descripción</th><th>Pendiente</th><th style="width:120px">Devuelve ahora</th></tr></thead>
              <tbody>${rows.map(x => `
                <tr>
                  <td>${esc(x.it.description)}</td>
                  <td>${x.pending}</td>
                  <td><input type="number" data-idx="${x.idx}" data-pending="${x.pending}" min="0" max="${x.pending}" step="1" value="${x.pending}"></td>
                </tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="grid">
          <label class="field">Fecha de devolución
            <input type="date" name="date" value="${todayStr()}" min="${r.rentDate}" required>
          </label>
          <label class="field">Monto por daño S/
            <input type="number" name="damageAmount" min="0" step="0.01" value="0">
          </label>
          <label class="field span-2">Descripción del daño
            <input name="damageNote" placeholder="Ej.: quemadura en manga, cierre roto (dejar vacío si llegó en buen estado)">
          </label>
          <label class="field span-2">Observaciones
            <input name="note" placeholder="Opcional">
          </label>
        </div>
        <div class="notice info" id="returnPreview" style="margin-top:14px"></div>
      </div>
      <div class="m-actions">
        <button type="button" class="btn btn-ghost" data-action="detail">Volver</button>
        <span class="spacer"></span>
        <button type="submit" class="btn btn-primary">Guardar devolución</button>
      </div>
    </form>`);
  updateReturnPreview();
}

function updateReturnPreview() {
  const el = $('#returnPreview');
  if (!el) return;
  const r = findRental(modalRentalId);
  const formEl = $('#modalBody form[data-form=return]');
  const date = formEl.date.value || todayStr();
  const inputs = $$('input[data-idx]', formEl);
  const complete = inputs.every(i => Number(i.value) === Number(i.dataset.pending));
  const days = Math.max(0, diffDays(r.dueDate, date));
  const fee = r2(days * (r.lateFee ?? state.settings.lateFee));
  if (complete) {
    el.innerHTML = days > 0
      ? `Devolución completa con <strong>${plural(days, 'día')}</strong> de atraso: mora de <strong>${money(fee)}</strong>. La garantía queda disponible para devolver (menos daños y deuda).`
      : 'Devolución completa dentro del plazo: sin mora. La garantía queda disponible para devolver (menos daños y deuda).';
  } else {
    el.innerHTML = 'Devolución parcial: la mora se sigue contando hasta que devuelva todas las prendas. La garantía se devuelve al completar la devolución.';
  }
}

function saveReturn(formEl) {
  const r = findRental(modalRentalId);
  const date = formEl.date.value;
  if (!date) return toast('Ingrese la fecha de devolución', 'error');
  if (date < r.rentDate) return toast('La devolución no puede ser anterior al alquiler', 'error');
  const items = [];
  for (const input of $$('input[data-idx]', formEl)) {
    const qty = Number(input.value);
    const pending = Number(input.dataset.pending);
    if (!Number.isInteger(qty) || qty < 0 || qty > pending) {
      input.classList.add('invalid');
      return toast('Cantidad devuelta inválida', 'error');
    }
    if (qty > 0) items.push({ idx: Number(input.dataset.idx), qty });
  }
  if (!items.length) return toast('Indique al menos una prenda devuelta', 'error');
  const damageAmount = r2(formEl.damageAmount.value);
  if (damageAmount < 0) return toast('Monto de daño inválido', 'error');
  const damageNote = formEl.damageNote.value.trim();
  if (damageAmount > 0 && !damageNote) return toast('Describa el daño', 'error');

  items.forEach(x => { r.items[x.idx].returnedQty = (r.items[x.idx].returnedQty || 0) + x.qty; });
  r.returns.push({ id: uid(), date, items, damageAmount, damageNote, note: formEl.note.value.trim() });
  save();
  refreshAll();
  const c = calc(r);
  if (c.allReturned && c.balance < 0) toast(`Devolución completa. Devolver garantía: ${money(-c.balance)}`);
  else if (c.allReturned && c.balance > 0) toast(`Devolución completa. El cliente debe ${money(c.balance)}`);
  else toast('Devolución registrada');
  openDetail(r.id);
}

function deletePayment(mid) {
  const r = findRental(modalRentalId);
  if (!confirm('¿Eliminar este movimiento de dinero?')) return;
  r.payments = r.payments.filter(p => p.id !== mid);
  save(); refreshAll(); openDetail(r.id);
}

function deleteReturn(mid) {
  const r = findRental(modalRentalId);
  const ret = r.returns.find(x => x.id === mid);
  if (!ret || !confirm('¿Anular esta devolución? Las prendas volverán a figurar como pendientes.')) return;
  ret.items.forEach(x => { r.items[x.idx].returnedQty = Math.max(0, (r.items[x.idx].returnedQty || 0) - x.qty); });
  r.returns = r.returns.filter(x => x.id !== mid);
  save(); refreshAll(); openDetail(r.id);
}

function returnDni() {
  const r = findRental(modalRentalId);
  const c = calc(r);
  let msg = '¿Confirmas que el DNI fue entregado al cliente?';
  if (!c.allReturned) msg = 'El cliente aún no devuelve todas las prendas. ¿Entregar el DNI de todas formas?';
  else if (c.balance > 0) msg = `El cliente aún debe ${money(c.balance)}. ¿Entregar el DNI de todas formas?`;
  if (!confirm(msg)) return;
  r.dniReturned = true;
  r.dniReturnedDate = todayStr();
  save(); refreshAll(); toast('DNI entregado'); openDetail(r.id);
}

function deleteRental() {
  const r = findRental(modalRentalId);
  if (!confirm(`¿Eliminar el alquiler ${r.number} de ${fullName(r)}? Esta acción no se puede deshacer.`)) return;
  state.rentals = state.rentals.filter(x => x.id !== r.id);
  save(); refreshAll(); modal().close(); toast('Alquiler eliminado');
}

/* ---------------------------------------------------------------------
   PDF y WhatsApp
   --------------------------------------------------------------------- */
function pdfName(r) {
  const last = (r.customer.lastName.split(' ')[0] || 'cliente').normalize('NFD').replace(/[^\w-]/g, '');
  return `Alquiler_${r.number}_${last}.pdf`;
}

function buildPdf(r) {
  if (!window.jspdf) throw new Error('No se cargó la librería de PDF (revise su conexión a internet)');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const s = state.settings;
  const c = calc(r);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const navy = [28, 37, 65];
  const gold = [184, 145, 58];

  /* encabezado */
  doc.setFillColor(...navy);
  doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 30, W, 1.2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(s.storeName || 'Alquiler de Prendas', M, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const contact = [s.storeAddress, s.storePhone ? 'Tel.: ' + s.storePhone : ''].filter(Boolean).join('   ·   ');
  if (contact) doc.text(contact, M, 21);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('CONSTANCIA DE ALQUILER', W - M, 13, { align: 'right' });
  doc.setFontSize(11);
  doc.text('Nº ' + r.number, W - M, 20, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Emitido: ' + fmtDate(todayStr()), W - M, 26, { align: 'right' });
  doc.setTextColor(31, 36, 48);

  let dniText = 'No dejó DNI';
  if (r.dniRetained) dniText = r.dniReturned ? 'Entregado el ' + fmtDate(r.dniReturnedDate) : 'Queda en tienda';

  /* datos del cliente */
  doc.autoTable({
    startY: 37,
    theme: 'plain',
    margin: { left: M, right: M },
    styles: { fontSize: 9.5, cellPadding: 1.3, textColor: [31, 36, 48] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 24 }, 1: { cellWidth: 76 }, 2: { fontStyle: 'bold', cellWidth: 34 } },
    body: [
      ['Cliente', fullName(r), 'Fecha de alquiler', fmtDate(r.rentDate)],
      ['DNI', r.customer.dni, 'Fecha límite', fmtDate(r.dueDate)],
      ['Teléfono', r.customer.phone, 'Estado', c.status],
      ['Dirección', r.customer.address, 'DNI del cliente', dniText]
    ]
  });

  /* prendas */
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 4,
    margin: { left: M, right: M },
    theme: 'grid',
    head: [['Nro.', 'Cant.', 'Descripción', 'P. unit.', 'Importe', 'Devuelto']],
    body: r.items.map((it, i) => [i + 1, it.qty, it.description, num(it.price), num(it.qty * it.price), `${it.returnedQty || 0} de ${it.qty}`]),
    headStyles: { fillColor: navy, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'center', cellWidth: 14 },
      3: { halign: 'right', cellWidth: 24 }, 4: { halign: 'right', cellWidth: 24 }, 5: { halign: 'center', cellWidth: 22 }
    }
  });

  /* resumen de la cuenta */
  const sum = summaryRows(c).map(x => [x.label, x.value < 0 ? '- ' + money(-x.value) : money(x.value)]);
  sum.push([balanceLabel(c).toUpperCase(), money(Math.abs(c.balance))]);
  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 4,
    margin: { left: W - M - 100, right: M },
    theme: 'plain',
    body: sum,
    styles: { fontSize: 9.5, cellPadding: 1.5 },
    columnStyles: { 0: { cellWidth: 66 }, 1: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: d => {
      if (d.row.index === sum.length - 1) {
        d.cell.styles.fillColor = c.balance > 0 ? [253, 240, 217] : c.balance < 0 ? [239, 230, 250] : [227, 244, 234];
        d.cell.styles.fontStyle = 'bold';
        d.cell.styles.fontSize = 11;
      }
    }
  });

  /* movimientos de dinero */
  if (r.payments.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 5,
      margin: { left: M, right: M },
      theme: 'striped',
      head: [['Fecha', 'Concepto', 'Medio', 'Monto']],
      body: r.payments.map(p => [
        fmtDate(p.date),
        (p.type === 'devolucion' ? 'Devolución de garantía' : 'Pago') + (p.note ? ' - ' + p.note : ''),
        p.method,
        (p.type === 'devolucion' ? '- ' : '') + money(p.amount)
      ]),
      headStyles: { fillColor: gold, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 1.8 },
      columnStyles: { 0: { cellWidth: 24 }, 2: { cellWidth: 28 }, 3: { halign: 'right', cellWidth: 30 } }
    });
  }

  /* devoluciones de prendas */
  if (r.returns.length) {
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 5,
      margin: { left: M, right: M },
      theme: 'striped',
      head: [['Fecha', 'Prendas devueltas', 'Daño', 'Observación']],
      body: r.returns.map(x => [
        fmtDate(x.date),
        x.items.map(i => `${i.qty} x ${r.items[i.idx].description}`).join(', '),
        x.damageAmount ? money(x.damageAmount) : '-',
        [x.damageNote, x.note].filter(Boolean).join(' - ') || '-'
      ]),
      headStyles: { fillColor: gold, fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 1.8 },
      columnStyles: { 0: { cellWidth: 24 }, 2: { halign: 'right', cellWidth: 26 } }
    });
  }

  let y = doc.lastAutoTable.finalY + 7;
  const ensure = h => { if (y + h > H - 18) { doc.addPage(); y = 18; } };
  const paragraph = (title, text) => {
    const lines = doc.splitTextToSize(text, W - 2 * M);
    ensure(6 + lines.length * 4.2);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(title, M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(lines, M, y + 5);
    y += 6 + lines.length * 4.2 + 3;
  };

  if (r.comments) paragraph('Comentarios', r.comments);
  paragraph('Condiciones',
    `- Las prendas deben devolverse a más tardar el ${fmtDate(r.dueDate)}.\n` +
    `- Por cada día de retraso se cobrará ${money(c.feePerDay)} adicionales.\n` +
    `- La garantía (${money(c.deposit)}) se devuelve al entregar todas las prendas en buen estado. ` +
    `Los daños y saldos pendientes se descuentan de la garantía; si la superan, el cliente abona la diferencia.\n` +
    (r.dniRetained ? '- El DNI del cliente queda en tienda hasta la devolución de las prendas y la cancelación del saldo.' : ''));

  /* firmas */
  ensure(26);
  y += 16;
  doc.setDrawColor(150);
  doc.line(M + 6, y, M + 76, y);
  doc.line(W - M - 76, y, W - M - 6, y);
  doc.setFontSize(9);
  doc.text('Firma del cliente', M + 41, y + 5, { align: 'center' });
  doc.text(`DNI ${r.customer.dni}`, M + 41, y + 9.5, { align: 'center' });
  doc.text(s.storeName || 'La tienda', W - M - 41, y + 5, { align: 'center' });

  /* pie */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text(`${r.number} · Página ${p} de ${pages}`, W / 2, H - 8, { align: 'center' });
  }
  return doc;
}

function downloadPdf(r) {
  try {
    buildPdf(r).save(pdfName(r));
  } catch (e) {
    toast(e.message, 'error');
  }
}

function whatsappText(r) {
  const c = calc(r);
  const store = state.settings.storeName || 'nuestra tienda';
  let saldo = 'Tu cuenta está al día.';
  if (c.balance > 0) saldo = `Saldo pendiente: ${money(c.balance)}.`;
  if (c.balance < 0) saldo = `Tienes ${money(-c.balance)} de garantía por recoger.`;
  const lines = [
    `Hola ${r.customer.firstName}, te enviamos la constancia de tu alquiler Nº ${r.number} en ${store}.`,
    c.allReturned ? 'Gracias por devolver las prendas.' : `Fecha límite de entrega: ${fmtDate(r.dueDate)}.`,
    saldo,
    '¡Gracias por tu preferencia!'
  ];
  return lines.join('\n');
}

async function shareWhatsApp(r) {
  let doc;
  try { doc = buildPdf(r); } catch (e) { return toast(e.message, 'error'); }
  const name = pdfName(r);
  const text = whatsappText(r);

  /* en celular: compartir el PDF directo (el usuario elige WhatsApp) */
  try {
    const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name, text });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }

  /* en PC: se descarga el PDF y se abre el chat del cliente para adjuntarlo */
  doc.save(name);
  const phone = '51' + r.customer.phone.replace(/\D/g, '');
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  toast('PDF descargado: adjúntalo en el chat de WhatsApp que se abrió');
}

/* ---------------------------------------------------------------------
   Ajustes y respaldo
   --------------------------------------------------------------------- */
function fillSettingsForm() {
  const f = $('#formSettings');
  ['storeName', 'storeAddress', 'storePhone', 'lateFee', 'defaultDays'].forEach(k => { f[k].value = state.settings[k]; });
}

function onSaveSettings(e) {
  e.preventDefault();
  const f = e.target;
  const lateFee = Number(f.lateFee.value);
  const defaultDays = Number(f.defaultDays.value);
  if (!(lateFee >= 0)) return toast('Mora inválida', 'error');
  if (!Number.isInteger(defaultDays) || defaultDays < 0) return toast('Días inválidos', 'error');
  Object.assign(state.settings, {
    storeName: f.storeName.value.trim() || 'Alquiler de Prendas',
    storeAddress: f.storeAddress.value.trim(),
    storePhone: f.storePhone.value.trim(),
    lateFee: r2(lateFee),
    defaultDays
  });
  save();
  refreshAll();
  toast('Ajustes guardados (la mora nueva aplica a los próximos alquileres)');
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `respaldo-alquileres-${todayStr()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.rentals)) throw new Error();
      if (!confirm(`El respaldo tiene ${data.rentals.length} alquiler(es). Se reemplazarán los datos actuales. ¿Continuar?`)) return;
      state = normalize(data);
      save(); fillSettingsForm(); refreshAll(); resetRentalForm();
      toast('Respaldo importado');
    } catch (e) {
      toast('El archivo no es un respaldo válido', 'error');
    }
  };
  reader.readAsText(file);
}

function sampleData() {
  const t = todayStr();
  const d = n => addDays(t, n);
  const data = defaultData();
  const mk = (o) => {
    const r = {
      id: uid(), number: 'A-' + String(data.settings.nextNumber++).padStart(4, '0'),
      createdAt: new Date(Date.now() - (20 - data.settings.nextNumber) * 3600e3).toISOString(),
      lateFee: data.settings.lateFee, dniRetained: true, dniReturned: false, dniReturnedDate: null,
      comments: '', payments: [], returns: [], ...o
    };
    r.items = r.items.map(([qty, description, price]) => ({ qty, description, price, returnedQty: 0 }));
    (o.ret || []).forEach(x => {
      x.items.forEach(i => { r.items[i.idx].returnedQty += i.qty; });
      r.returns.push({ id: uid(), damageAmount: 0, damageNote: '', note: '', ...x });
    });
    r.payments = (o.pay || []).map(p => ({ id: uid(), type: 'pago', method: 'Efectivo', note: '', ...p }));
    delete r.ret; delete r.pay;
    data.rentals.push(r);
  };

  mk({
    rentDate: d(-1), dueDate: d(1), deposit: 100,
    customer: { firstName: 'Juan Carlos', lastName: 'Pérez Rojas', dni: '45879632', phone: '987654321', address: 'Av. Los Próceres 123, San Juan de Lurigancho' },
    items: [[1, 'Terno azul marino slim talla 40', 120], [1, 'Corbata guinda', 15], [1, 'Camisa blanca manga larga talla M', 25]],
    comments: 'Para matrimonio. Se ajustó la basta del pantalón.',
    pay: [{ date: d(-1), amount: 100, method: 'Yape', note: 'Adelanto' }]
  });
  mk({
    rentDate: d(-5), dueDate: d(-3), deposit: 150,
    customer: { firstName: 'María Fernanda', lastName: 'Quispe Huamán', dni: '72145896', phone: '956321478', address: 'Jr. Las Magnolias 456, Comas' },
    items: [[1, 'Vestido largo de gala color esmeralda talla S', 150]],
    pay: [{ date: d(-5), amount: 300, method: 'Plin', note: 'Pago total al alquilar' }]
  });
  mk({
    rentDate: d(-4), dueDate: d(-2), deposit: 200,
    customer: { firstName: 'Carlos Alberto', lastName: 'Ramírez Torres', dni: '40236587', phone: '912345678', address: 'Calle Los Olivos 789, Los Olivos' },
    items: [[3, 'Terno gris oxford (padrinos) tallas 38/40/42', 90], [3, 'Corbatín negro', 10]],
    comments: 'Alquiler para tres padrinos de boda.',
    pay: [{ date: d(-4), amount: 300, method: 'Efectivo', note: 'Adelanto' }],
    ret: [{ date: d(-2), items: [{ idx: 0, qty: 2 }, { idx: 1, qty: 3 }], note: 'Falta devolver un terno' }]
  });
  mk({
    rentDate: d(-10), dueDate: d(-8), deposit: 50,
    customer: { firstName: 'Lucía', lastName: 'Mendoza Salas', dni: '70985214', phone: '934567812', address: 'Av. Universitaria 1020, San Martín de Porres' },
    items: [[1, 'Vestido corto de cóctel negro talla M', 120]],
    pay: [{ date: d(-10), amount: 170, method: 'Efectivo', note: 'Pago total al alquilar' }],
    ret: [{ date: d(-6), items: [{ idx: 0, qty: 1 }], damageAmount: 80, damageNote: 'Mancha de vino en la falda' }]
  });
  mk({
    rentDate: d(-4), dueDate: d(-2), deposit: 200,
    customer: { firstName: 'Rosa Elena', lastName: 'Castillo Vega', dni: '41258963', phone: '998877665', address: 'Mz. B Lt. 12, Urb. Santa Rosa, Puente Piedra' },
    items: [[1, 'Vestido de novia corte sirena talla S', 180]],
    pay: [{ date: d(-4), amount: 380, method: 'Tarjeta', note: 'Pago total al alquilar' }],
    ret: [{ date: d(-2), items: [{ idx: 0, qty: 1 }], note: 'Llegó en buen estado' }]
  });
  mk({
    rentDate: d(-15), dueDate: d(-13), deposit: 100, dniReturned: true, dniReturnedDate: d(-13),
    customer: { firstName: 'Jorge Luis', lastName: 'Flores Díaz', dni: '46325871', phone: '976543210', address: 'Av. Túpac Amaru 2500, Carabayllo' },
    items: [[1, 'Smoking negro talla 42', 130], [1, 'Faja y corbatín de seda', 20]],
    pay: [
      { date: d(-15), amount: 250, method: 'Efectivo', note: 'Pago total al alquilar' },
      { date: d(-13), amount: 100, method: 'Efectivo', type: 'devolucion', note: 'Prendas en buen estado' }
    ],
    ret: [{ date: d(-13), items: [{ idx: 0, qty: 1 }, { idx: 1, qty: 1 }] }]
  });
  return data;
}

function loadSample() {
  if (state.rentals.length && !confirm('Se reemplazarán los datos actuales por datos de ejemplo. ¿Continuar?')) return;
  const keep = { ...state.settings };
  state = sampleData();
  Object.assign(state.settings, { storeName: keep.storeName, storeAddress: keep.storeAddress, storePhone: keep.storePhone });
  save(); refreshAll(); resetRentalForm();
  toast('Datos de ejemplo cargados');
  showView('pendientes');
}

function clearAll() {
  if (!confirm('¿Borrar TODOS los alquileres de este navegador? Exporta un respaldo antes si lo necesitas.')) return;
  state = defaultData();
  save(); fillSettingsForm(); refreshAll(); resetRentalForm();
  toast('Datos borrados');
}

/* ---------------------------------------------------------------------
   Eventos
   --------------------------------------------------------------------- */
function init() {
  const f = form();
  f.payMethod.innerHTML = METHODS.map(m => `<option>${m}</option>`).join('');

  $$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

  $('#btnAddItem').addEventListener('click', () => addItemRow(true));
  $('#itemsBody').addEventListener('click', e => {
    if (!e.target.closest('.i-del')) return;
    const rows = $$('#itemsBody tr');
    if (rows.length === 1) return toast('Debe haber al menos una prenda', 'error');
    e.target.closest('tr').remove();
    renumberItems();
    updateFormTotals();
  });
  f.addEventListener('input', e => {
    e.target.classList.remove('invalid');
    updateFormTotals();
  });
  f.addEventListener('change', updateFormTotals);
  f.dni.addEventListener('blur', fillCustomerByDni);
  f.dni.addEventListener('input', () => { f.dni.value = f.dni.value.replace(/\D/g, ''); });
  f.phone.addEventListener('input', () => { f.phone.value = f.phone.value.replace(/\D/g, ''); });
  f.rentDate.addEventListener('change', () => {
    if (f.rentDate.value) {
      f.dueDate.min = f.rentDate.value;
      if (!f.dueDate.value || f.dueDate.value < f.rentDate.value) {
        f.dueDate.value = addDays(f.rentDate.value, Number(state.settings.defaultDays) || 0);
      }
    }
  });
  f.addEventListener('submit', onSubmitRental);
  $('#btnClearForm').addEventListener('click', resetRentalForm);

  $('#pendSearch').addEventListener('input', renderPending);
  $('#pendChips').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    pendFilter = chip.dataset.f;
    $$('.chip', $('#pendChips')).forEach(c => c.classList.toggle('active', c === chip));
    renderPending();
  });
  const openFromList = e => {
    const el = e.target.closest('[data-id]');
    if (el) openDetail(el.dataset.id);
  };
  $('#pendList').addEventListener('click', openFromList);
  $('#pendList').addEventListener('keydown', e => { if (e.key === 'Enter') openFromList(e); });
  $('#histBody').addEventListener('click', openFromList);
  ['#histSearch', '#histStatus', '#histFrom', '#histTo'].forEach(s => $(s).addEventListener('input', renderHistory));

  $('#formSettings').addEventListener('submit', onSaveSettings);
  $('#btnExport').addEventListener('click', exportBackup);
  $('#fileImport').addEventListener('change', e => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });
  $('#btnSample').addEventListener('click', loadSample);
  $('#btnClear').addEventListener('click', clearAll);

  /* modal */
  const m = modal();
  m.addEventListener('click', e => { if (e.target === m) m.close(); });
  $('#modalBody').addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const r = findRental(modalRentalId);
    switch (b.dataset.action) {
      case 'close': m.close(); break;
      case 'detail': openDetail(modalRentalId); break;
      case 'return': openReturn(modalRentalId); break;
      case 'pay': openPayment(modalRentalId, 'pago'); break;
      case 'refund': openPayment(modalRentalId, 'devolucion'); break;
      case 'dni': returnDni(); break;
      case 'pdf': downloadPdf(r); break;
      case 'wa': shareWhatsApp(r); break;
      case 'delete': deleteRental(); break;
      case 'del-payment': deletePayment(b.dataset.mid); break;
      case 'del-return': deleteReturn(b.dataset.mid); break;
    }
  });
  $('#modalBody').addEventListener('submit', e => {
    e.preventDefault();
    const fm = e.target;
    if (fm.dataset.form === 'payment') savePayment(fm);
    if (fm.dataset.form === 'return') saveReturn(fm);
  });
  $('#modalBody').addEventListener('input', e => {
    e.target.classList.remove('invalid');
    if (e.target.closest('form[data-form=return]')) updateReturnPreview();
  });

  fillSettingsForm();
  resetRentalForm();
  refreshAll();
}

document.addEventListener('DOMContentLoaded', init);
