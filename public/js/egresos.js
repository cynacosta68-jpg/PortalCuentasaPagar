'use strict';
/* ── Pantalla de Egresos ─────────────────────────────────── */

let proveedores = [];
let tabActual = 'manual';
let datosParseados = null; // datos del PDF o QR parseado

// ── Init ────────────────────────────────────────────────────
(async () => {
  await Promise.all([cargarEgresos(), cargarProveedores()]);
  initTabs();
  initUploadZone();
  initAutoCalculo();
})();

// ── Cargar lista ────────────────────────────────────────────
async function cargarEgresos() {
  const params = new URLSearchParams();
  const estado = document.getElementById('filtro-estado').value;
  const desde = document.getElementById('filtro-desde').value;
  const hasta = document.getElementById('filtro-hasta').value;
  if (estado) params.set('estado', estado);
  if (desde)  params.set('desde', desde);
  if (hasta)  params.set('hasta', hasta);

  const rows = await apiFetch('/api/egresos?' + params.toString());
  renderTabla(rows);
  actualizarCategorias(rows);
}

// Suma al datalist las categorías ya usadas que no estén en las sugerencias base.
function actualizarCategorias(rows) {
  const dl = document.getElementById('cats-egreso');
  if (!dl) return;
  const existentes = new Set([...dl.options].map(o => o.value.toLowerCase()));
  for (const r of rows) {
    const c = (r.categoria_egreso || '').trim();
    if (c && !existentes.has(c.toLowerCase())) {
      const opt = document.createElement('option');
      opt.value = c;
      dl.appendChild(opt);
      existentes.add(c.toLowerCase());
    }
  }
}

async function cargarProveedores() {
  proveedores = await apiFetch('/api/proveedores');
  const selects = ['f-proveedor_id', 'f-proveedor-extra'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">— Seleccioná un proveedor —</option>';
    proveedores.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.razon_social} (${formatCuit(p.cuit)})`;
      sel.appendChild(opt);
    });
  });
}

// ── Render tabla ────────────────────────────────────────────
function renderTabla(rows) {
  const tbody = document.getElementById('egresos-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No hay egresos. ¡Cargá el primero!</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(e => `
    <tr>
      <td><strong>${e.razon_social}</strong><br><small class="text-muted">${formatCuit(e.cuit)}</small></td>
      <td>${e.tipo_comprobante} ${String(e.punto_venta).padStart(4,'0')}-${String(e.numero).padStart(8,'0')}</td>
      <td>${formatFecha(e.fecha_comprobante)}</td>
      <td>${e.concepto || '<span class="text-muted">—</span>'}</td>
      <td>${e.categoria_egreso || '<span class="text-muted">—</span>'}</td>
      <td class="text-right importe"><strong>${formatImporte(e.importe_total)}</strong></td>
      <td class="${vtoClass(e.fecha_vto_pago, e.estado)}">${formatFecha(e.fecha_vto_pago)}</td>
      <td>${badge(e.estado)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="verDetalle(${e.id})">Ver</button>
        ${e.estado === 'pendiente' ? `<button class="btn btn-danger btn-sm" onclick="anularEgreso(${e.id})">Anular</button>` : ''}
      </td>
    </tr>`).join('');
}

function vtoClass(fecha, estado) {
  if (!fecha || estado !== 'pendiente') return '';
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const vto = new Date(fecha + 'T12:00:00');
  if (vto < hoy) return 'text-danger';
  const dias = (vto - hoy) / 86400000;
  if (dias <= 3) return 'text-warning';
  return '';
}

function formatCuit(c) {
  if (!c || c.length !== 11) return c || '';
  return `${c.slice(0,2)}-${c.slice(2,10)}-${c.slice(10)}`;
}

// ── Filtros ─────────────────────────────────────────────────
document.getElementById('btn-filtrar').addEventListener('click', cargarEgresos);

// ── Modal principal ──────────────────────────────────────────
document.getElementById('btn-cargar').addEventListener('click', abrirModal);
document.getElementById('modal-close').addEventListener('click', cerrarModal);
document.getElementById('btn-cancelar').addEventListener('click', cerrarModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) cerrarModal();
});

function abrirModal() {
  datosParseados = null;
  limpiarModal();
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function cerrarModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  datosParseados = null;
}

// ── Tabs de origen ───────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      tabActual = btn.dataset.tab;
      ['tab-manual','tab-pdf','tab-qr'].forEach(id =>
        document.getElementById(id).classList.toggle('hidden', id !== 'tab-' + tabActual)
      );
      document.getElementById('campos-comunes-extra').classList.toggle('hidden', tabActual === 'manual');
      datosParseados = null;
    });
  });
}

// ── Upload de PDF ────────────────────────────────────────────
function initUploadZone() {
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('f-pdf-file');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') procesarPdf(file);
    else showAlert('Solo se aceptan archivos PDF', 'error', document.getElementById('modal-alert'));
  });
  zone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) procesarPdf(file);
  });
}

async function procesarPdf(file) {
  const alertEl = document.getElementById('modal-alert');
  alertEl.innerHTML = '<div class="alert alert-info">Procesando PDF...</div>';

  const formData = new FormData();
  formData.append('archivo', file, file.name);

  try {
    const res = await fetch('/api/comprobantes/parse-pdf', { method: 'POST', body: formData });
    const datos = await res.json();
    if (!res.ok) throw new Error(datos.error || 'Error al procesar el PDF');

    datosParseados = { ...datos, origen: 'pdf' };
    alertEl.innerHTML = '';
    mostrarPreviewParseado(datos, 'pdf');
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

// ── QR ARCA ──────────────────────────────────────────────────
document.getElementById('btn-leer-qr').addEventListener('click', async () => {
  const texto = document.getElementById('f-qr-texto').value.trim();
  if (!texto) {
    showAlert('Pegá el contenido del QR', 'error', document.getElementById('modal-alert'));
    return;
  }
  try {
    const datos = await apiFetch('/api/comprobantes/parse-qr', { method: 'POST', body: { qr_url: texto } });
    datosParseados = { ...datos, origen: 'qr' };
    mostrarPreviewParseado(datos, 'qr');
  } catch (err) {
    showAlert('Error al leer el QR: ' + err.message, 'error', document.getElementById('modal-alert'));
  }
});

function mostrarPreviewParseado(datos, origen) {
  // Mostrar confianza del parseo
  if (origen === 'pdf') {
    const conf = datos.confianza || 0;
    const color = conf >= 80 ? 'success' : conf >= 50 ? 'info' : 'error';
    document.getElementById('pdf-confianza-msg').className = `alert alert-${color}`;
    document.getElementById('pdf-confianza-msg').textContent =
      `Datos extraídos con ${conf}% de confianza. Revisá los campos antes de guardar.`;
    document.getElementById('pdf-preview').classList.remove('hidden');
  } else {
    document.getElementById('qr-preview').classList.remove('hidden');
  }

  // Autoseleccionar proveedor si se detectó
  if (datos.proveedor) {
    const sel = document.getElementById('f-proveedor-extra');
    sel.value = datos.proveedor.id;
    document.getElementById('proveedor-autodetect').textContent =
      `✓ Proveedor detectado automáticamente: ${datos.proveedor.razon_social}`;
  } else if (datos.cuit_emisor) {
    document.getElementById('proveedor-autodetect').textContent =
      `CUIT del emisor: ${datos.cuit_emisor} — no está en tu lista de proveedores.`;
  }

  // Campos técnicos (solo informativos en el preview)
  const contenedor = origen === 'pdf'
    ? document.getElementById('pdf-campos')
    : document.getElementById('qr-campos');

  contenedor.innerHTML = `
    <div class="form-group">
      <label>Tipo</label>
      <input type="text" class="form-control" value="${datos.tipo_comprobante || '—'}" readonly>
    </div>
    <div class="form-group">
      <label>PtoVta - Número</label>
      <input type="text" class="form-control" value="${datos.punto_venta || '—'} - ${datos.numero || '—'}" readonly>
    </div>
    <div class="form-group">
      <label>Fecha</label>
      <input type="text" class="form-control" value="${formatFecha(datos.fecha_comprobante)}" readonly>
    </div>
    <div class="form-group">
      <label>CUIT emisor</label>
      <input type="text" class="form-control" value="${formatCuit(datos.cuit_emisor || '')}" readonly>
    </div>
    <div class="form-group">
      <label>Neto gravado</label>
      <input type="text" class="form-control" value="${formatImporte(datos.importe_neto)}" readonly>
    </div>
    <div class="form-group">
      <label>IVA</label>
      <input type="text" class="form-control" value="${formatImporte(datos.importe_iva)}" readonly>
    </div>
    <div class="form-group" style="grid-column:span 2">
      <label>Total</label>
      <input type="text" class="form-control importe-grande" value="${formatImporte(datos.importe_total)}" readonly>
    </div>
  `;

  // Mostrar campos comunes (concepto, categoría, vto)
  document.getElementById('campos-comunes-extra').classList.remove('hidden');
}

// ── Guardado ─────────────────────────────────────────────────
document.getElementById('btn-guardar-egreso').addEventListener('click', guardarEgreso);

async function guardarEgreso() {
  const alertEl = document.getElementById('modal-alert');

  let payload;
  if (tabActual === 'manual') {
    payload = armarPayloadManual();
  } else {
    payload = armarPayloadParseado();
  }

  if (!payload) return; // validación ya mostró error

  try {
    await apiFetch('/api/egresos', { method: 'POST', body: payload });
    cerrarModal();
    showAlert('Egreso cargado correctamente', 'success');
    await cargarEgresos();
  } catch (err) {
    alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

function armarPayloadManual() {
  const get = id => document.getElementById(id).value.trim();
  const alertEl = document.getElementById('modal-alert');

  const requeridos = {
    'f-proveedor_id': 'Proveedor',
    'f-tipo_comprobante': 'Tipo de comprobante',
    'f-punto_venta': 'Punto de venta',
    'f-numero': 'Número',
    'f-fecha_comprobante': 'Fecha',
    'f-cuit_emisor': 'CUIT emisor',
    'f-importe_total': 'Importe total',
  };
  for (const [id, label] of Object.entries(requeridos)) {
    if (!get(id)) {
      alertEl.innerHTML = `<div class="alert alert-error">"${label}" es obligatorio</div>`;
      return null;
    }
  }

  return {
    proveedor_id:      parseInt(get('f-proveedor_id')),
    tipo_comprobante:  get('f-tipo_comprobante'),
    punto_venta:       parseInt(get('f-punto_venta')),
    numero:            parseInt(get('f-numero')),
    fecha_comprobante: get('f-fecha_comprobante'),
    cuit_emisor:       get('f-cuit_emisor').replace(/-/g, ''),
    importe_neto:      parseFloat(get('f-importe_neto')) || 0,
    importe_iva:       parseFloat(get('f-importe_iva')) || 0,
    importe_otros:     parseFloat(get('f-importe_otros')) || 0,
    importe_total:     parseFloat(get('f-importe_total')),
    concepto:          get('f-concepto') || null,
    categoria_egreso:  get('f-categoria_egreso') || null,
    fecha_vto_pago:    get('f-fecha_vto_pago') || null,
    origen:            'manual',
  };
}

function armarPayloadParseado() {
  const alertEl = document.getElementById('modal-alert');
  const proveedorId = document.getElementById('f-proveedor-extra').value;
  const concepto = document.getElementById('f-concepto-extra').value.trim();

  if (!proveedorId) {
    alertEl.innerHTML = '<div class="alert alert-error">Seleccioná el proveedor</div>';
    return null;
  }
  if (!concepto) {
    alertEl.innerHTML = '<div class="alert alert-error">El concepto es obligatorio</div>';
    return null;
  }
  if (!datosParseados) {
    alertEl.innerHTML = '<div class="alert alert-error">Primero procesá el PDF o QR</div>';
    return null;
  }

  return {
    proveedor_id:      parseInt(proveedorId),
    tipo_comprobante:  datosParseados.tipo_comprobante,
    punto_venta:       datosParseados.punto_venta,
    numero:            datosParseados.numero,
    fecha_comprobante: datosParseados.fecha_comprobante,
    cuit_emisor:       datosParseados.cuit_emisor,
    importe_neto:      datosParseados.importe_neto || 0,
    importe_iva:       datosParseados.importe_iva || 0,
    importe_otros:     0,
    importe_total:     datosParseados.importe_total,
    moneda:            datosParseados.moneda || 'PES',
    cotizacion:        datosParseados.cotizacion || 1,
    concepto,
    categoria_egreso:  document.getElementById('f-categoria-extra').value || null,
    fecha_vto_pago:    document.getElementById('f-vto-extra').value || null,
    origen:            datosParseados.origen || 'pdf',
    raw_qr_data:       datosParseados.raw_qr_data || null,
    raw_pdf_text:      datosParseados.raw_pdf_text || null,
  };
}

// ── Auto-cálculo del total en carga manual ──────────────────
function initAutoCalculo() {
  ['f-importe_neto','f-importe_iva','f-importe_otros'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => {
      const neto  = parseFloat(document.getElementById('f-importe_neto').value)  || 0;
      const iva   = parseFloat(document.getElementById('f-importe_iva').value)   || 0;
      const otros = parseFloat(document.getElementById('f-importe_otros').value) || 0;
      document.getElementById('f-importe_total').value = (neto + iva + otros).toFixed(2);
    });
  });
}

// ── Ver detalle ──────────────────────────────────────────────
async function verDetalle(id) {
  const e = await apiFetch(`/api/egresos/${id}`);
  document.getElementById('detalle-body').innerHTML = `
    <table class="table">
      <tr><td><strong>Proveedor</strong></td><td>${e.razon_social} (${formatCuit(e.cuit)})</td></tr>
      <tr><td><strong>Comprobante</strong></td><td>${e.tipo_comprobante} ${String(e.punto_venta).padStart(4,'0')}-${String(e.numero).padStart(8,'0')}</td></tr>
      <tr><td><strong>CUIT emisor</strong></td><td>${formatCuit(e.cuit_emisor)}</td></tr>
      <tr><td><strong>Fecha</strong></td><td>${formatFecha(e.fecha_comprobante)}</td></tr>
      <tr><td><strong>Neto gravado</strong></td><td>${formatImporte(e.importe_neto)}</td></tr>
      <tr><td><strong>IVA</strong></td><td>${formatImporte(e.importe_iva)}</td></tr>
      <tr><td><strong>Total</strong></td><td><strong>${formatImporte(e.importe_total)}</strong></td></tr>
      <tr><td><strong>Concepto</strong></td><td>${e.concepto || '—'}</td></tr>
      <tr><td><strong>Categoría</strong></td><td>${e.categoria_egreso || '—'}</td></tr>
      <tr><td><strong>Vto. pago</strong></td><td>${formatFecha(e.fecha_vto_pago)}</td></tr>
      <tr><td><strong>Estado</strong></td><td>${badge(e.estado)}</td></tr>
      <tr><td><strong>Origen</strong></td><td>${e.origen}</td></tr>
      <tr><td><strong>Cargado</strong></td><td>${formatFecha(e.created_at)}</td></tr>
    </table>
  `;
  document.getElementById('modal-detalle').classList.remove('hidden');
}

// ── Anular ───────────────────────────────────────────────────
async function anularEgreso(id) {
  if (!confirm('¿Anular este egreso? Esta acción no se puede deshacer.')) return;
  try {
    await apiFetch(`/api/egresos/${id}`, { method: 'DELETE' });
    showAlert('Egreso anulado', 'success');
    await cargarEgresos();
  } catch (err) {
    showAlert('Error: ' + err.message);
  }
}

function limpiarModal() {
  ['f-proveedor_id','f-tipo_comprobante','f-punto_venta','f-numero',
   'f-fecha_comprobante','f-cuit_emisor','f-importe_neto','f-importe_iva',
   'f-importe_otros','f-importe_total','f-concepto','f-categoria_egreso',
   'f-fecha_vto_pago','f-qr-texto','f-concepto-extra','f-categoria-extra',
   'f-vto-extra','f-proveedor-extra'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('modal-alert').innerHTML = '';
  document.getElementById('pdf-preview').classList.add('hidden');
  document.getElementById('qr-preview').classList.add('hidden');
  document.getElementById('campos-comunes-extra').classList.add('hidden');
  document.getElementById('proveedor-autodetect').textContent = '';
  document.getElementById('f-pdf-file').value = '';

  // Resetear al tab manual
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'manual'));
  document.getElementById('tab-manual').classList.remove('hidden');
  document.getElementById('tab-pdf').classList.add('hidden');
  document.getElementById('tab-qr').classList.add('hidden');
  tabActual = 'manual';
}
