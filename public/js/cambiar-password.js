/* Cambio de contraseña */
const form = document.getElementById('cp-form');
const alertBox = document.getElementById('cp-alert');
const btn = document.getElementById('btn-cp');
let primerIngreso = true;

(async function init() {
  try {
    const me = await (await fetch('/api/auth/me')).json();
    if (!me.authed) { location.href = '/login.html'; return; }
    primerIngreso = !!me.debe_cambiar;
    if (!primerIngreso) {
      document.getElementById('grupo-actual').style.display = '';
      document.getElementById('sub').textContent = 'Actualizá tu contraseña';
    }
  } catch { location.href = '/login.html'; }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  const actual = document.getElementById('actual').value;
  const nueva = document.getElementById('nueva').value;
  const confirmar = document.getElementById('confirmar').value;

  if (nueva.length < 8) {
    alertBox.innerHTML = '<div class="alert alert-error">La contraseña debe tener al menos 8 caracteres.</div>';
    return;
  }
  if (nueva !== confirmar) {
    alertBox.innerHTML = '<div class="alert alert-error">Las contraseñas no coinciden.</div>';
    return;
  }

  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const res = await fetch('/api/auth/cambiar-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual, nueva }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo cambiar la contraseña');
    location.href = '/';
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    btn.disabled = false; btn.textContent = 'Guardar contraseña';
  }
});
