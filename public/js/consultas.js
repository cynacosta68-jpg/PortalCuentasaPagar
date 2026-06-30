'use strict';

let consultaActualId = null;

(async () => {
  await cargarProveedores();
  await cargarConsultas();
  initEventos();
})();

// ── Carga ────────────────────────────────────────────────────

async function cargarConsultas() {
  const estado = document.getElementById('filtro-estado').value;
  const tipo   = document.getElementById('filtro-tipo').value;
  const params = new URLSearchParams();
  if (estado) params.set('estado', estado);
  if (tipo)   params.set('tipo', tipo);

  const rows = await apiFetch(`/api/consultas?${params}`);
  renderConsultas(rows);
}

async function cargarProveedores() {
  const provs = await apiFetch('/api/proveedores?activo=true');
  const sel = document.getElementById('n-proveedor');
  sel.innerHTML = '<option value="">— Sin proveedor —</option>' +
    provs.map(p => `<option value="${p.id}">${p.razon_social}</option>`).join('');
}

// ── Render tabla ─────────────────────────────────────────────

function renderConsultas(rows) {
  const tbody = document.getElementById('consultas-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay consultas registradas.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(c => `
    <tr style="cursor:pointer" onclick="abrirConsulta(${c.id})">
      <td>${badgeTipo(c.tipo)}</td>
      <td>
        ${c.razon_social
          ? `<strong>${c.razon_social}</strong><br><small class="text-muted">${formatCuit(c.cuit)}</small>`
          : '<span class="text-muted">—</span>'}
      </td>
      <td style="max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis">
        ${c.asunto}
      </td>
      <td>${badgeEstado(c.estado)}</td>
      <td class="text-muted" style="font-size:12px">${formatFecha(c.created_at)}</td>
      <td class="text-muted" style="font-size:12px">${c.respondido_at ? formatFecha(c.respondido_at) : '—'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); abrirConsulta(${c.id})">Ver</button>
      </td>
    </tr>`).join('');
}

// ── Abrir modal de consulta ──────────────────────────────────

async function abrirConsulta(id) {
  consultaActualId = id;
  const c = await apiFetch(`/api/consultas/${id}`);

  document.getElementById('cons-titulo').innerHTML =
    `${badgeTipo(c.tipo)} — ${c.asunto}`;

  document.getElementById('cons-meta').innerHTML = `
    <span>Proveedor: <strong>${c.razon_social || '—'}</strong></span>
    ${c.mail ? `&nbsp;·&nbsp;<span>${c.mail}</span>` : ''}
    &nbsp;·&nbsp;<span>Recibida: ${formatFecha(c.created_at)}</span>
    &nbsp;·&nbsp;${badgeEstado(c.estado)}
  `;

  document.getElementById('cons-mensaje').textContent = c.mensaje;

  // Respuesta existente
  const bloqueResp = document.getElementById('cons-respuesta-bloque');
  if (c.respuesta) {
    document.getElementById('cons-respuesta-texto').textContent = c.respuesta;
    document.getElementById('cons-respuesta-fecha').textContent =
      `Respondida el ${formatFecha(c.respondido_at)}`;
    bloqueResp.classList.remove('hidden');
  } else {
    bloqueResp.classList.add('hidden');
  }

  // Acciones según estado
  const bloqueResponder = document.getElementById('cons-responder-bloque');
  const btnResponder    = document.getElementById('btn-enviar-respuesta');
  const btnCerrar       = document.getElementById('btn-cerrar-consulta');
  document.getElementById('cons-alert').innerHTML = '';
  document.getElementById('cons-respuesta-input').value = '';

  if (c.estado === 'pendiente') {
    bloqueResponder.classList.remove('hidden');
    btnResponder.classList.remove('hidden');
    btnCerrar.classList.add('hidden');
  } else if (c.estado === 'respondido') {
    bloqueResponder.classList.add('hidden');
    btnResponder.classList.add('hidden');
    btnCerrar.classList.remove('hidden');
  } else {
    bloqueResponder.classList.add('hidden');
    btnResponder.classList.add('hidden');
    btnCerrar.classList.add('hidden');
  }

  document.getElementById('modal-consulta').classList.remove('hidden');
}

function cerrarModal() {
  document.getElementById('modal-consulta').classList.add('hidden');
  consultaActualId = null;
}

// ── Responder ────────────────────────────────────────────────

async function enviarRespuesta() {
  const respuesta = document.getElementById('cons-respuesta-input').value.trim();
  if (!respuesta) {
    document.getElementById('cons-alert').innerHTML =
      '<div class="alert alert-error">La respuesta no puede estar vacía.</div>';
    return;
  }
  try {
    await apiFetch(`/api/consultas/${consultaActualId}/responder`, {
      method: 'POST',
      body: { respuesta },
    });
    cerrarModal();
    showAlert('Respuesta registrada correctamente.', 'success');
    await cargarConsultas();
  } catch (err) {
    document.getElementById('cons-alert').innerHTML =
      `<div class="alert alert-error">${err.message}</div>`;
  }
}

async function cerrarConsulta() {
  if (!confirm('¿Marcar esta consulta como cerrada?')) return;
  try {
    await apiFetch(`/api/consultas/${consultaActualId}/cerrar`, { method: 'POST' });
    cerrarModal();
    showAlert('Consulta cerrada.', 'success');
    await cargarConsultas();
  } catch (err) {
    showAlert('Error: ' + err.message);
  }
}

// ── Nueva consulta ───────────────────────────────────────────

async function guardarNuevaConsulta() {
  const asunto  = document.getElementById('n-asunto').value.trim();
  const mensaje = document.getElementById('n-mensaje').value.trim();
  const tipo    = document.getElementById('n-tipo').value;
  const provId  = document.getElementById('n-proveedor').value;

  if (!asunto || !mensaje) {
    document.getElementById('nueva-alert').innerHTML =
      '<div class="alert alert-error">Asunto y mensaje son obligatorios.</div>';
    return;
  }

  try {
    await apiFetch('/api/consultas', {
      method: 'POST',
      body: { tipo, asunto, mensaje, proveedor_id: provId || null },
    });
    document.getElementById('modal-nueva').classList.add('hidden');
    showAlert('Consulta registrada.', 'success');
    // Limpiar formulario
    ['n-asunto', 'n-mensaje'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('n-proveedor').value = '';
    document.getElementById('nueva-alert').innerHTML = '';
    await cargarConsultas();
  } catch (err) {
    document.getElementById('nueva-alert').innerHTML =
      `<div class="alert alert-error">${err.message}</div>`;
  }
}

// ── Cargar desde mail ────────────────────────────────────────

async function guardarDesdeEmail() {
  const remitente = document.getElementById('e-remitente').value.trim();
  const asunto    = document.getElementById('e-asunto').value.trim();
  const mensaje   = document.getElementById('e-mensaje').value.trim();
  const tipo      = document.getElementById('e-tipo').value;

  if (!asunto || !mensaje) {
    document.getElementById('email-alert').innerHTML =
      '<div class="alert alert-error">Asunto y cuerpo del mail son obligatorios.</div>';
    return;
  }

  try {
    const r = await apiFetch('/api/consultas/desde-email', {
      method: 'POST',
      body: { remitente, tipo, asunto, mensaje },
    });
    document.getElementById('modal-email').classList.add('hidden');
    showAlert(r.proveedor_match
      ? 'Consulta cargada y vinculada al proveedor.'
      : 'Consulta cargada (sin proveedor coincidente).', 'success');
    ['e-remitente', 'e-asunto', 'e-mensaje'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('email-alert').innerHTML = '';
    await cargarConsultas();
  } catch (err) {
    document.getElementById('email-alert').innerHTML =
      `<div class="alert alert-error">${err.message}</div>`;
  }
}

// ── Eventos ──────────────────────────────────────────────────

function initEventos() {
  document.getElementById('btn-filtrar').addEventListener('click', cargarConsultas);
  document.getElementById('btn-nueva').addEventListener('click', () => {
    document.getElementById('modal-nueva').classList.remove('hidden');
  });
  document.getElementById('btn-desde-mail').addEventListener('click', () => {
    document.getElementById('modal-email').classList.remove('hidden');
  });
  document.getElementById('btn-guardar-email').addEventListener('click', guardarDesdeEmail);
  document.getElementById('btn-enviar-respuesta').addEventListener('click', enviarRespuesta);
  document.getElementById('btn-cerrar-consulta').addEventListener('click', cerrarConsulta);
  document.getElementById('btn-guardar-nueva').addEventListener('click', guardarNuevaConsulta);
}

// ── Badges y helpers ─────────────────────────────────────────

function badgeTipo(tipo) {
  return tipo === 'reclamo'
    ? '<span class="badge badge-pendiente">Reclamo</span>'
    : '<span class="badge" style="background:var(--bg-sidebar);color:var(--text-muted)">Consulta</span>';
}

function badgeEstado(estado) {
  const map = {
    pendiente:   '<span class="badge badge-pendiente">Pendiente</span>',
    respondido:  '<span class="badge badge-aprobada">Respondido</span>',
    cerrado:     '<span class="badge badge-pagado">Cerrado</span>',
  };
  return map[estado] || `<span class="badge">${estado}</span>`;
}

function formatCuit(c) {
  if (!c || c.length !== 11) return c || '';
  return `${c.slice(0,2)}-${c.slice(2,10)}-${c.slice(10)}`;
}
