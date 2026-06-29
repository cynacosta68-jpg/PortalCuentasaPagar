/* Pantalla de proveedores */
let proveedores = [];
let editandoId = null;

async function cargarProveedores() {
  proveedores = await apiFetch('/api/proveedores');
  renderTabla(proveedores);
}

function renderTabla(lista) {
  const tbody = $('#prov-body');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No hay proveedores. ¡Agregá el primero!</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td><strong>${p.razon_social}</strong></td>
      <td class="text-muted">${formatCuit(p.cuit)}</td>
      <td>${p.condicion_fiscal || '—'}</td>
      <td>${p.mail}</td>
      <td class="text-center">${p.ret_ganancias ? '✓' : '—'}</td>
      <td class="text-center">${p.ret_iva ? '✓' : '—'}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editarProveedor(${p.id})">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="desactivarProveedor(${p.id}, '${p.razon_social}')">Dar de baja</button>
      </td>
    </tr>`).join('');
}

function formatCuit(cuit) {
  if (!cuit || cuit.length !== 11) return cuit;
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

// Búsqueda local en la tabla
$('#buscar').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  renderTabla(proveedores.filter(p =>
    p.razon_social.toLowerCase().includes(q) || p.cuit.includes(q)
  ));
});

// Abrir modal nuevo
$('#btn-nuevo').addEventListener('click', () => abrirModal());

function abrirModal(proveedor = null) {
  editandoId = proveedor?.id || null;
  limpiarForm();
  if (proveedor) {
    $('#modal-title').textContent = 'Editar proveedor';
    $('#f-cuit').value = formatCuit(proveedor.cuit);
    $('#f-cuit').readOnly = true;
    llenarCamposArca({
      razon_social: proveedor.razon_social,
      actividad: proveedor.actividad,
      condicion_fiscal: proveedor.condicion_fiscal,
      categoria_monotributo: proveedor.categoria_monotributo,
      domicilio_fiscal: proveedor.domicilio_fiscal,
    });
    $('#f-mail').value = proveedor.mail;
    $('#f-ret_ganancias').checked = proveedor.ret_ganancias;
    $('#f-ret_iva').checked = proveedor.ret_iva;
    toggleRetGanancias();
    toggleRetIva();
    if (proveedor.ret_ganancias_regimen) {
      $('#f-ret_ganancias_regimen').value = proveedor.ret_ganancias_regimen;
    }
    if (proveedor.ret_iva_alicuota) {
      $('#f-ret_iva_alicuota').value = proveedor.ret_iva_alicuota;
    }
  } else {
    $('#modal-title').textContent = 'Nuevo proveedor';
    $('#f-cuit').readOnly = false;
  }
  $('#modal-overlay').classList.remove('hidden');
}

function cerrarModal() {
  $('#modal-overlay').classList.add('hidden');
  editandoId = null;
}

$('#modal-close').addEventListener('click', cerrarModal);
$('#btn-cancelar').addEventListener('click', cerrarModal);
$('#modal-overlay').addEventListener('click', e => {
  if (e.target === $('#modal-overlay')) cerrarModal();
});

// Lookup ARCA
$('#btn-buscar-arca').addEventListener('click', async () => {
  const cuit = $('#f-cuit').value.replace(/-/g, '').trim();
  if (cuit.length !== 11) {
    showAlert('Ingresá un CUIT válido de 11 dígitos', 'error', $('#modal-alert'));
    return;
  }
  $('#arca-status').textContent = 'Consultando ARCA…';
  $('#btn-buscar-arca').disabled = true;
  try {
    const datos = await apiFetch(`/api/proveedores/arca/${cuit}`);
    llenarCamposArca(datos);
    $('#arca-status').textContent = '✓ Datos cargados desde ARCA';
    $('#arca-status').style.color = 'var(--success)';
  } catch (err) {
    const msg = err.status === 404 ? 'CUIT no encontrado en ARCA' : 'Error consultando ARCA: ' + err.message;
    $('#arca-status').textContent = msg;
    $('#arca-status').style.color = 'var(--danger)';
  } finally {
    $('#btn-buscar-arca').disabled = false;
  }
});

function llenarCamposArca(datos) {
  if (datos.razon_social) $('#f-razon_social').value = datos.razon_social;
  if (datos.actividad) $('#f-actividad').value = datos.actividad;
  if (datos.condicion_fiscal) $('#f-condicion_fiscal').value = datos.condicion_fiscal;
  if (datos.categoria_monotributo) $('#f-categoria_monotributo').value = datos.categoria_monotributo;
  if (datos.domicilio_fiscal) $('#f-domicilio_fiscal').value = datos.domicilio_fiscal;
}

// Toggles de retenciones
$('#f-ret_ganancias').addEventListener('change', toggleRetGanancias);
$('#f-ret_iva').addEventListener('change', toggleRetIva);

function toggleRetGanancias() {
  const sel = $('#f-ret_ganancias_regimen');
  sel.disabled = !$('#f-ret_ganancias').checked;
}
function toggleRetIva() {
  const sel = $('#f-ret_iva_alicuota');
  sel.disabled = !$('#f-ret_iva').checked;
}

// Guardar
$('#btn-guardar').addEventListener('click', async () => {
  const cuit = $('#f-cuit').value.replace(/-/g, '').trim();
  const razon_social = $('#f-razon_social').value.trim();
  const mail = $('#f-mail').value.trim();

  if (!razon_social || !mail) {
    showAlert('Razón social y mail son obligatorios', 'error', $('#modal-alert'));
    return;
  }

  const payload = {
    cuit,
    razon_social,
    actividad: $('#f-actividad').value || null,
    condicion_fiscal: $('#f-condicion_fiscal').value || null,
    categoria_monotributo: $('#f-categoria_monotributo').value || null,
    domicilio_fiscal: $('#f-domicilio_fiscal').value || null,
    mail,
    ret_ganancias: $('#f-ret_ganancias').checked,
    ret_ganancias_regimen: $('#f-ret_ganancias').checked ? $('#f-ret_ganancias_regimen').value || null : null,
    ret_iva: $('#f-ret_iva').checked,
    ret_iva_alicuota: $('#f-ret_iva').checked ? parseFloat($('#f-ret_iva_alicuota').value) || null : null,
  };

  try {
    if (editandoId) {
      await apiFetch(`/api/proveedores/${editandoId}`, { method: 'PUT', body: payload });
    } else {
      await apiFetch('/api/proveedores', { method: 'POST', body: payload });
    }
    cerrarModal();
    await cargarProveedores();
  } catch (err) {
    showAlert(err.message, 'error', $('#modal-alert'));
  }
});

async function editarProveedor(id) {
  const p = await apiFetch(`/api/proveedores/${id}`);
  abrirModal(p);
}

async function desactivarProveedor(id, nombre) {
  if (!confirm(`¿Dar de baja a "${nombre}"? Dejará de aparecer en las listas.`)) return;
  try {
    await apiFetch(`/api/proveedores/${id}`, { method: 'DELETE' });
    await cargarProveedores();
  } catch (err) {
    showAlert('Error al dar de baja: ' + err.message);
  }
}

function limpiarForm() {
  ['f-cuit','f-razon_social','f-condicion_fiscal','f-categoria_monotributo',
   'f-actividad','f-domicilio_fiscal','f-mail'].forEach(id => document.getElementById(id).value = '');
  $('#f-ret_ganancias').checked = false;
  $('#f-ret_iva').checked = false;
  $('#f-ret_ganancias_regimen').disabled = true;
  $('#f-ret_iva_alicuota').disabled = true;
  $('#arca-status').textContent = '';
  $('#arca-status').style.color = '';
  $('#modal-alert').innerHTML = '';
}

// Cargar regímenes RG830 disponibles en el select
async function cargarRegimenesGanancias() {
  try {
    const { rows } = await apiFetch('/api/retenciones/regimenes').catch(() => ({ rows: [] }));
    const sel = $('#f-ret_ganancias_regimen');
    rows.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.regimen_codigo;
      opt.textContent = `${r.regimen_codigo} — ${r.descripcion}`;
      sel.append(opt);
    });
  } catch { /* sin regímenes cargados aún */ }
}

// Init
cargarProveedores();
cargarRegimenesGanancias();
