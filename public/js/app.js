/* Utilidades globales del portal */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function formatImporte(n, decimals = 2) {
  if (n == null) return '—';
  return '$ ' + Number(n).toLocaleString('es-AR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatFecha(d) {
  if (!d) return '—';
  const dt = new Date(d + (d.length === 10 ? 'T12:00:00' : ''));
  return dt.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function badge(estado) {
  return `<span class="badge badge-${estado}">${estado.replace(/_/g, ' ')}</span>`;
}

async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

function showAlert(msg, type = 'error', container = document.body) {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  container.prepend(el);
  setTimeout(() => el.remove(), 5000);
}

// Marcar enlace activo en la sidebar
document.querySelectorAll('.nav-link').forEach(a => {
  if (a.href === location.href) a.classList.add('active');
  else a.classList.remove('active');
});

// Mostrar fecha actual
const fechaEl = document.getElementById('fecha-hoy');
if (fechaEl) {
  fechaEl.textContent = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}
