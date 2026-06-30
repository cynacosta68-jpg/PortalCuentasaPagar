'use strict';
/* ── Pantalla de Pagos ───────────────────────────────────── */

let partidas = [];
let seleccionados = new Set();
let tipoCorrida = null;      // 'inmediata' | 'planificada'
let corridaIdCreada = null;

// ── Init ────────────────────────────────────────────────────
(async () => {
  await cargarPartidas();
  initSeleccion();
  initModales();
  // Setear fecha de pago por defecto: hoy
  document.getElementById('p-fecha_pago').value = new Date().toISOString().slice(0, 10);
})();

async function cargarPartidas() {
  partidas = await apiFetch('/api/egresos?estado=pendiente');
  renderPartidas(partidas);
}

function renderPartidas(rows) {
  const tbody = document.getElementById('partidas-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay partidas pendientes de pago. ¡Todo al día!</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(e => `
    <tr data-id="${e.id}" data-total="${e.importe_total}">
      <td><input type="checkbox" class="chk-partida" value="${e.id}"></td>
      <td>
        <strong>${e.razon_social}</strong><br>
        <small class="text-muted">${formatCuit(e.cuit)}</small>
      </td>
      <td>${e.tipo_comprobante} ${String(e.punto_venta).padStart(4,'0')}-${String(e.numero).padStart(8,'0')}</td>
      <td>${formatFecha(e.fecha_comprobante)}</td>
      <td class="${vtoClass(e.fecha_vto_pago)}">${formatFecha(e.fecha_vto_pago)}</td>
      <td>${e.concepto || '<span class="text-muted">—</span>'}</td>
      <td class="text-right importe"><strong>${formatImporte(e.importe_total)}</strong></td>
    </tr>`).join('');

  // Reactivar listeners en los nuevos checkboxes
  document.querySelectorAll('.chk-partida').forEach(chk =>
    chk.addEventListener('change', actualizarSeleccion)
  );
}

function vtoClass(fecha) {
  if (!fecha) return '';
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const vto = new Date(fecha + 'T12:00:00');
  if (vto < hoy) return 'text-danger';
  if ((vto - hoy) / 86400000 <= 3) return 'text-warning';
  return '';
}

function formatCuit(c) {
  if (!c || c.length !== 11) return c || '';
  return `${c.slice(0,2)}-${c.slice(2,10)}-${c.slice(10)}`;
}

// ── Selección ────────────────────────────────────────────────
function initSeleccion() {
  document.getElementById('chk-all').addEventListener('change', e => {
    document.querySelectorAll('.chk-partida').forEach(chk => {
      chk.checked = e.target.checked;
    });
    actualizarSeleccion();
  });
}

function actualizarSeleccion() {
  seleccionados = new Set(
    [...document.querySelectorAll('.chk-partida:checked')].map(c => parseInt(c.value))
  );

  const total = partidas
    .filter(p => seleccionados.has(p.id))
    .reduce((s, p) => s + parseFloat(p.importe_total), 0);

  document.getElementById('sel-cantidad').textContent = seleccionados.size;
  document.getElementById('sel-total').textContent = formatImporte(total);

  const habilitado = seleccionados.size > 0;
  document.getElementById('btn-generar').disabled = !habilitado;
  document.getElementById('btn-planificar').disabled = !habilitado;
  document.getElementById('barra-seleccion').style.display = 'flex';
}

// ── Botones principales ──────────────────────────────────────
document.getElementById('btn-generar').addEventListener('click', () => mostrarPreview('inmediata'));
document.getElementById('btn-planificar').addEventListener('click', () => mostrarPreview('planificada'));

// ── Preview de corrida ───────────────────────────────────────
async function mostrarPreview(tipo) {
  tipoCorrida = tipo;
  const egreso_ids = [...seleccionados];
  const fecha_pago = document.getElementById('p-fecha_pago')?.value || '';
  const medio_pago = document.getElementById('p-medio_pago')?.value || 'Transferencia';

  document.getElementById('preview-titulo').textContent =
    tipo === 'inmediata' ? 'Resumen de pago — Generar' : 'Propuesta de pago — Planificar';

  document.getElementById('btn-confirmar-generar').style.display =
    tipo === 'inmediata' ? 'inline-flex' : 'none';
  document.getElementById('btn-confirmar-planificar').style.display =
    tipo === 'planificada' ? 'inline-flex' : 'none';

  try {
    const preview = await apiFetch('/api/corridas/preview', {
      method: 'POST',
      body: { egreso_ids, fecha_pago, medio_pago },
    });
    renderPreview(preview);
    document.getElementById('modal-preview').classList.remove('hidden');
  } catch (err) {
    showAlert('Error al calcular preview: ' + err.message);
  }
}

function renderPreview(preview) {
  // Detalle por proveedor
  document.getElementById('preview-ordenes').innerHTML = preview.ordenes.map(o => `
    <div style="border:1px solid var(--border); border-radius:var(--radius); padding:14px; margin-bottom:12px">
      <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px">
        <div>
          <strong>${o.razon_social}</strong>
          <span class="text-muted" style="font-size:12px; margin-left:8px">${formatCuit(o.cuit)}</span>
        </div>
        <div class="text-right">
          <div class="text-muted" style="font-size:12px">Importe bruto</div>
          <div class="importe">${formatImporte(o.importeBruto)}</div>
        </div>
      </div>
      <div style="font-size:12px; color:var(--text-muted); display:grid; grid-template-columns:1fr 1fr; gap:4px 16px">
        ${o.retGanancias.importe > 0 ? `
          <span>Ret. Ganancias (Reg. ${o.retGanancias.regimen || '—'}, base ${formatImporte(o.retGanancias.base)})</span>
          <span class="text-right" style="color:var(--danger)">- ${formatImporte(o.retGanancias.importe)}</span>
        ` : ''}
        ${o.retIva.importe > 0 ? `
          <span>Ret. IVA (${o.retIva.alicuota}%)</span>
          <span class="text-right" style="color:var(--danger)">- ${formatImporte(o.retIva.importe)}</span>
        ` : ''}
        ${(o.totalRetenciones === 0) ? '<span class="text-muted">Sin retenciones configuradas</span><span></span>' : ''}
      </div>
      <div style="border-top:1px solid var(--border); margin-top:10px; padding-top:10px; display:flex; justify-content:space-between; align-items:center">
        <div>
          <span class="text-muted" style="font-size:12px">Mail: </span>
          <span style="font-size:12px">${o.mail}</span>
        </div>
        <div class="text-right">
          <div class="text-muted" style="font-size:12px">A pagar</div>
          <div class="importe-grande">${formatImporte(o.importeNetoPago)}</div>
        </div>
      </div>
    </div>
  `).join('');

  // Totales
  const t = preview.totales;
  document.getElementById('preview-totales').innerHTML = `
    <table style="margin-left:auto; font-size:14px">
      <tr><td style="padding:4px 12px; color:var(--text-muted)">Total bruto</td><td style="text-align:right; padding:4px 0">${formatImporte(t.importe_bruto)}</td></tr>
      <tr><td style="padding:4px 12px; color:var(--danger)">Total retenciones</td><td style="text-align:right; padding:4px 0; color:var(--danger)">- ${formatImporte(t.total_retenciones)}</td></tr>
      <tr style="border-top:2px solid var(--border); font-weight:700; font-size:16px">
        <td style="padding:8px 12px">Total a pagar</td>
        <td style="text-align:right; padding:8px 0">${formatImporte(t.importe_neto)}</td>
      </tr>
    </table>
  `;
}

// ── Confirmar corrida ────────────────────────────────────────
document.getElementById('btn-confirmar-generar').addEventListener('click', async () => {
  await confirmarCorrida('inmediata');
});
document.getElementById('btn-confirmar-planificar').addEventListener('click', () => {
  document.getElementById('modal-preview').classList.add('hidden');
  document.getElementById('modal-planificar').classList.remove('hidden');
});

async function confirmarCorrida(tipo) {
  const egreso_ids = [...seleccionados];
  const fecha_pago = document.getElementById('p-fecha_pago').value;
  const medio_pago = document.getElementById('p-medio_pago').value;

  try {
    // 1. Crear la corrida
    const corrida = await apiFetch('/api/corridas', {
      method: 'POST',
      body: { egreso_ids, tipo, fecha_pago, medio_pago },
    });
    corridaIdCreada = corrida.id;

    // 2. Ejecutar inmediatamente si es inmediata
    if (tipo === 'inmediata') {
      await apiFetch(`/api/corridas/${corrida.id}/ejecutar`, { method: 'POST' });
      document.getElementById('modal-preview').classList.add('hidden');
      mostrarExito(
        '¡Pago generado!',
        `Se generaron las órdenes de pago y certificados de retención. Corrida: ${corrida.codigo_ref}`
      );
    }
    seleccionados.clear();
    await cargarPartidas();
  } catch (err) {
    document.getElementById('preview-alert').innerHTML =
      `<div class="alert alert-error">${err.message}</div>`;
  }
}

// ── Planificación (envío a gerencia) ────────────────────────
document.getElementById('btn-enviar-planificacion').addEventListener('click', async () => {
  const email = document.getElementById('p-email-gerencia').value.trim();
  if (!email) {
    document.getElementById('plan-alert').innerHTML =
      '<div class="alert alert-error">El email de gerencia es obligatorio</div>';
    return;
  }

  try {
    // 1. Crear corrida
    const corrida = await apiFetch('/api/corridas', {
      method: 'POST',
      body: {
        egreso_ids: [...seleccionados],
        tipo: 'planificada',
        fecha_pago: document.getElementById('p-fecha_pago').value,
        medio_pago: document.getElementById('p-medio_pago').value,
      },
    });

    // 2. Enviar a planificación
    const planResp = await apiFetch(`/api/corridas/${corrida.id}/planificar`, {
      method: 'POST',
      body: { email_gerencia: email },
    });

    document.getElementById('modal-planificar').classList.add('hidden');
    const linkPrueba = planResp.url_autorizacion
      ? `<br><br><small>Para probar la autorización sin mail configurado, abrí este link:<br><a href="${planResp.url_autorizacion}" target="_blank">${planResp.url_autorizacion}</a></small>`
      : '';
    mostrarExito(
      '¡Propuesta enviada!',
      `Se envió la corrida ${corrida.codigo_ref} a gerencia (${email}) para aprobación. Tendrán 72 hs para responder.${linkPrueba}`
    );
    seleccionados.clear();
    await cargarPartidas();
  } catch (err) {
    document.getElementById('plan-alert').innerHTML =
      `<div class="alert alert-error">${err.message}</div>`;
  }
});

function mostrarExito(titulo, msg) {
  document.getElementById('exito-titulo').textContent = titulo;
  document.getElementById('exito-msg').innerHTML = msg;
  document.getElementById('modal-exito').classList.remove('hidden');
}

// ── Cerrar modales ───────────────────────────────────────────
function initModales() {
  document.getElementById('preview-close').addEventListener('click', () =>
    document.getElementById('modal-preview').classList.add('hidden')
  );
  document.getElementById('preview-cancel').addEventListener('click', () =>
    document.getElementById('modal-preview').classList.add('hidden')
  );
}
