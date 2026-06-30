'use strict';

(async () => { await cargarCorridas(); })();

async function cargarCorridas() {
  const corridas = await apiFetch('/api/corridas');
  const tbody = document.getElementById('corridas-body');

  if (!corridas.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No hay corridas de pago aún.</td></tr>';
    return;
  }

  tbody.innerHTML = corridas.map(c => `
    <tr>
      <td><strong>${c.codigo_ref}</strong></td>
      <td>${c.tipo === 'inmediata' ? 'Inmediata' : 'Planificada'}</td>
      <td>${formatFecha(c.fecha_pago)}</td>
      <td>${c.medio_pago || '—'}</td>
      <td class="text-right importe">${formatImporte(c.importe_bruto)}</td>
      <td class="text-right" style="color:var(--danger)">${formatImporte(c.importe_retenciones)}</td>
      <td class="text-right importe-grande">${formatImporte(c.importe_neto)}</td>
      <td>${badge(c.estado)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="verDetalle(${c.id})">Ver detalle</button>
        ${c.estado === 'borrador' || c.estado === 'pendiente_aprob' || c.estado === 'aprobada'
          ? `<button class="btn btn-danger btn-sm" onclick="rechazarCorrida(${c.id}, '${c.codigo_ref}')">Eliminar</button>`
          : ''}
      </td>
    </tr>`).join('');
}

async function verDetalle(id) {
  corridaDetalleId = id;
  const corrida = await apiFetch(`/api/corridas/${id}`);

  document.getElementById('det-codigo').innerHTML = `Corrida ${corrida.codigo_ref} — ${badge(corrida.estado)}`;

  // Acciones disponibles según estado
  let acciones = '';
  if (corrida.estado === 'ejecutada') {
    acciones = `<button class="btn btn-primary" onclick="alert('Próximamente: envío de mails a proveedores')">📧 Notificar proveedores por mail</button>`;
  }
  if (corrida.estado === 'aprobada') {
    acciones = `<button class="btn btn-primary" onclick="ejecutarCorrida(${id})">⚡ Ejecutar pago</button>`;
  }
  if (corrida.estado === 'pendiente_aprob' || corrida.estado === 'borrador') {
    acciones = `<button class="btn btn-primary" onclick="reenviarAprobacion(${id})">↻ Reenviar pedido de aprobación</button>`;
  }
  document.getElementById('det-acciones').innerHTML = acciones;

  // Órdenes de pago
  if (corrida.ordenes?.length) {
    document.getElementById('det-ordenes').innerHTML = corrida.ordenes.map(o => `
      <div style="border:1px solid var(--border); border-radius:var(--radius); padding:12px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center">
        <div>
          <strong>${o.razon_social}</strong>
          <span class="text-muted" style="font-size:12px; margin-left:8px">${o.numero_orden}</span><br>
          <small class="text-muted">Bruto: ${formatImporte(o.importe_bruto)} — Ret.: ${formatImporte(o.importe_total_ret)} — <strong>Pagar: ${formatImporte(o.importe_neto)}</strong></small>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap">
          ${o.mail_enviado_at
            ? `<span class="badge badge-pagado">Mail enviado ${formatFecha(o.mail_enviado_at)}</span>`
            : `<span class="badge badge-pendiente">Pendiente notificación</span>`}
          <a href="/api/ordenes/${o.id}/pdf" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px">⬇ OP</a>
          ${(o.certificados || []).map(c =>
            `<a href="/api/certificados/${c.id}/pdf" target="_blank" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px" title="${c.numero_cert}">⬇ Cert. ${etiquetaCert(c)}</a>`
          ).join('')}
          ${(!o.certificados || !o.certificados.length) && parseFloat(o.importe_total_ret) > 0
            ? `<button class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px" onclick="regenerarCertificados(${o.id})">Generar certificados</button>`
            : ''}
        </div>
      </div>`).join('');
  } else {
    document.getElementById('det-ordenes').innerHTML = '<p class="text-muted" style="font-size:13px">Las órdenes se generan al ejecutar la corrida.</p>';
  }

  // Items (comprobantes)
  document.getElementById('det-items').innerHTML = corrida.items.map(i => `
    <tr>
      <td>${i.razon_social}</td>
      <td>${i.tipo_comprobante} ${String(i.punto_venta).padStart(4,'0')}-${String(i.numero).padStart(8,'0')}</td>
      <td>${formatFecha(i.fecha_comprobante)}</td>
      <td>${i.concepto || '—'}</td>
      <td class="text-right importe">${formatImporte(i.importe_total)}</td>
    </tr>`).join('');

  document.getElementById('modal-detalle').classList.remove('hidden');
}

let corridaDetalleId = null;

async function ejecutarCorrida(id) {
  if (!confirm('¿Ejecutar la corrida? Se generarán las órdenes de pago y certificados de retención.')) return;
  try {
    await apiFetch(`/api/corridas/${id}/ejecutar`, { method: 'POST' });
    document.getElementById('modal-detalle').classList.add('hidden');
    showAlert('Corrida ejecutada correctamente. Las órdenes de pago fueron generadas.', 'success');
    await cargarCorridas();
  } catch (err) {
    showAlert('Error al ejecutar: ' + err.message);
  }
}

// Reenvía el pedido de aprobación de una corrida pendiente y muestra el link
async function reenviarAprobacion(id) {
  try {
    const r = await apiFetch(`/api/corridas/${id}/reenviar-aprobacion`, { method: 'POST', body: {} });
    document.getElementById('det-acciones').innerHTML =
      `<div class="alert alert-success" style="width:100%">Pedido de aprobación reenviado.` +
      `<br><small>Link para autorizar (probar sin mail configurado):<br>` +
      `<a href="${r.url_autorizacion}" target="_blank">${r.url_autorizacion}</a></small></div>`;
  } catch (err) {
    showAlert('Error al reenviar: ' + err.message);
  }
}

// Regenera los certificados faltantes de una orden ya ejecutada
async function regenerarCertificados(ordenId) {
  try {
    const r = await apiFetch(`/api/ordenes/${ordenId}/certificados/regenerar`, { method: 'POST' });
    showAlert(r.creados > 0
      ? `Se generaron ${r.creados} certificado(s).`
      : 'No había datos para regenerar certificados en esta orden.', r.creados > 0 ? 'success' : 'error');
    if (corridaDetalleId) await verDetalle(corridaDetalleId);
  } catch (err) {
    showAlert('Error al generar certificados: ' + err.message);
  }
}

async function rechazarCorrida(id, codigo) {
  if (!confirm(`¿Eliminar la corrida ${codigo}? Los egresos volverán al estado pendiente.`)) return;
  try {
    await apiFetch(`/api/corridas/${id}/rechazar`, { method: 'POST' });
    showAlert('Corrida eliminada. Los egresos volvieron a pendiente.', 'success');
    await cargarCorridas();
  } catch (err) {
    showAlert('Error: ' + err.message);
  }
}

// Etiqueta corta para el botón de descarga del certificado
function etiquetaCert(c) {
  const t = (c.tipo_retencion || '').toLowerCase();
  if (t === 'ganancias') return 'Gan.' + (c.regimen_codigo ? ' ' + c.regimen_codigo : '');
  if (t === 'iva') return 'IVA';
  if (t === 'iibb') return 'IIBB';
  if (t === 'suss') return 'SUSS';
  return t || 'Ret.';
}
