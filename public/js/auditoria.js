/* Registro de auditoría (Gerencia + Auditor) */
const ROLES = { gerencia: 'Gerencia', coordinacion: 'Coordinación', analista: 'Analista Contable', auditor: 'Auditor' };
const ACCIONES = { crear: 'Creó', editar: 'Editó', eliminar: 'Eliminó', planificar: 'Planificó',
  ejecutar: 'Ejecutó', autorizar: 'Autorizó', reset_password: 'Reseteó clave', desde_email: 'Cargó desde mail',
  responder: 'Respondió', cerrar: 'Cerró', regenerar: 'Regeneró' };
const ENTIDADES = { egreso: 'Egreso', corrida: 'Corrida', proveedore: 'Proveedor', proveedor: 'Proveedor',
  consulta: 'Consulta', usuario: 'Usuario', comprobante: 'Comprobante' };

async function cargarAuditoria() {
  const params = new URLSearchParams();
  const u = document.getElementById('f-usuario').value.trim();
  const a = document.getElementById('f-accion').value;
  const d = document.getElementById('f-desde').value;
  const h = document.getElementById('f-hasta').value;
  if (u) params.set('usuario', u);
  if (a) params.set('accion', a);
  if (d) params.set('desde', d);
  if (h) params.set('hasta', h);

  try {
    const filas = await apiFetch('/api/auditoria?' + params.toString());
    const tbody = document.getElementById('tbody-auditoria');
    if (!filas.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="text-align:center; padding:24px">Sin registros para los filtros aplicados.</td></tr>';
      return;
    }
    tbody.innerHTML = filas.map(f => `
      <tr>
        <td>${formatFechaHora(f.created_at)}</td>
        <td><code>${f.usuario || '—'}</code></td>
        <td>${ROLES[f.rol] || f.rol || '—'}</td>
        <td>${ACCIONES[f.accion] || f.accion}</td>
        <td>${ENTIDADES[f.entidad] || f.entidad || '—'}</td>
        <td>${f.entidad_id || '—'}</td>
        <td style="max-width:280px; font-size:12px; color:var(--text-muted)">${f.detalle ? escapeHtml(f.detalle) : '—'}</td>
      </tr>`).join('');
    if (window.initOrdenables) window.initOrdenables();
  } catch (err) {
    showAlert('Error al cargar auditoría: ' + err.message);
  }
}

function formatFechaHora(d) {
  if (!d) return '—';
  const f = new Date(d);
  return f.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

document.getElementById('btn-filtrar').addEventListener('click', cargarAuditoria);
cargarAuditoria();
