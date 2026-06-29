/* Login del portal */
const form = document.getElementById('login-form');
const alertBox = document.getElementById('login-alert');
const btn = document.getElementById('btn-ingresar');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertBox.innerHTML = '';
  const password = document.getElementById('password').value;

  btn.disabled = true;
  btn.textContent = 'Ingresando…';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo ingresar');
    // Sesión iniciada → al panel.
    location.href = '/';
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    btn.disabled = false;
    btn.textContent = 'Ingresar';
    document.getElementById('password').focus();
  }
});
