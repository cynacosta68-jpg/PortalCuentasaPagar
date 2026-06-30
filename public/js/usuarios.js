/* Gestión de usuarios (solo Gerencia) */
const ROLES = { gerencia: 'Gerencia', coordinacion: 'Coordinación', analista: 'Analista Contable', auditor: 'Auditor' };
let editandoId = null;

async function cargarUsuarios() {
  try {
    const usuarios = await apiFetch('/api/usuarios');
    const tbody = document.getElementById('tbody-usuarios');
    tbody.innerHTML = usuarios.map(u => `
      <tr style="${u.activo ? '' : 'opacity:.5'}">
        <td>${u.nombre}</td>
        <td><code>${u.usuario}</code></td>
        <td>${u.email || '—'}</td>
        <td>${ROLES[u.rol] || u.rol}</td>
        <td>${u.activo ? 'Activo' : 'Inactivo'}</td>
        <td>${u.ultimo_acceso ? formatFecha(u.ultimo_acceso) : 'Nunca'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-secondary btn-sm" onclick='editarUsuario(${JSON.stringify(u)})'>Editar</button>
          <button class="btn btn-secondary btn-sm" onclick="resetPassword(${u.id}, '${u.usuario}')">Resetear clave</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleActivo(${u.id}, ${!u.activo})">${u.activo ? 'Desactivar' : 'Activar'}</button>
        </td>
      </tr>`).join('');
    if (window.initOrdenables) window.initOrdenables();
  } catch (err) {
    showAlert('Error al cargar usuarios: ' + err.message);
  }
}

function abrirNuevo() {
  editandoId = null;
  document.getElementById('modal-titulo').textContent = 'Nuevo usuario';
  document.getElementById('grupo-password').style.display = '';
  ['u-nombre', 'u-usuario', 'u-email', 'u-password'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('u-usuario').disabled = false;
  document.getElementById('u-rol').value = 'analista';
  document.getElementById('usuario-alert').innerHTML = '';
  document.getElementById('modal-usuario').classList.remove('hidden');
}

function editarUsuario(u) {
  editandoId = u.id;
  document.getElementById('modal-titulo').textContent = 'Editar usuario';
  document.getElementById('grupo-password').style.display = 'none';
  document.getElementById('u-nombre').value = u.nombre;
  document.getElementById('u-usuario').value = u.usuario;
  document.getElementById('u-usuario').disabled = true;
  document.getElementById('u-email').value = u.email || '';
  document.getElementById('u-rol').value = u.rol;
  document.getElementById('usuario-alert').innerHTML = '';
  document.getElementById('modal-usuario').classList.remove('hidden');
}

async function guardarUsuario() {
  const nombre = document.getElementById('u-nombre').value.trim();
  const usuario = document.getElementById('u-usuario').value.trim();
  const email = document.getElementById('u-email').value.trim();
  const rol = document.getElementById('u-rol').value;
  const password = document.getElementById('u-password').value;
  const alert = document.getElementById('usuario-alert');

  try {
    if (editandoId) {
      await apiFetch(`/api/usuarios/${editandoId}`, { method: 'PUT', body: { nombre, email, rol } });
      showAlert('Usuario actualizado', 'success');
    } else {
      if (!nombre || !usuario || !password) {
        alert.innerHTML = '<div class="alert alert-error">Nombre, usuario y contraseña son obligatorios.</div>';
        return;
      }
      await apiFetch('/api/usuarios', { method: 'POST', body: { nombre, usuario, email, rol, password } });
      showAlert('Usuario creado. Deberá cambiar la contraseña al ingresar.', 'success');
    }
    document.getElementById('modal-usuario').classList.add('hidden');
    await cargarUsuarios();
  } catch (err) {
    alert.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

async function resetPassword(id, usuario) {
  const nueva = prompt(`Nueva contraseña temporal para "${usuario}" (mínimo 8 caracteres).\nLa persona deberá cambiarla al ingresar:`);
  if (!nueva) return;
  try {
    await apiFetch(`/api/usuarios/${id}/reset-password`, { method: 'POST', body: { password: nueva } });
    showAlert('Contraseña restablecida', 'success');
  } catch (err) { showAlert('Error: ' + err.message); }
}

async function toggleActivo(id, activar) {
  try {
    await apiFetch(`/api/usuarios/${id}`, { method: 'PUT', body: { activo: activar } });
    await cargarUsuarios();
  } catch (err) { showAlert('Error: ' + err.message); }
}

document.getElementById('btn-nuevo').addEventListener('click', abrirNuevo);
document.getElementById('btn-guardar-usuario').addEventListener('click', guardarUsuario);
cargarUsuarios();
