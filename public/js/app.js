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
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status, detalle: data.detalle });
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

// Botón de cerrar sesión al pie de la sidebar (se inyecta en todas las páginas)
const sidebarEl = document.querySelector('.sidebar');
if (sidebarEl && !sidebarEl.querySelector('.sidebar-footer')) {
  const footer = document.createElement('div');
  footer.className = 'sidebar-footer';
  footer.innerHTML = `<button class="logout-btn" id="btn-logout"><span class="icon">⏏</span> Cerrar sesión</button>`;
  sidebarEl.appendChild(footer);
  footer.querySelector('#btn-logout').addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    location.href = '/login.html';
  });
}

// Mostrar fecha actual
const fechaEl = document.getElementById('fecha-hoy');
if (fechaEl) {
  fechaEl.textContent = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// ── Ordenamiento de tablas por columna ────────────────────────
// Hace que todas las tablas (.table) se puedan ordenar al hacer clic
// en el encabezado. Alterna ascendente/descendente. Detecta números
// (importes en formato argentino), fechas DD/MM/AAAA y texto.
(function () {
  function parseValor(texto) {
    const t = (texto || '').trim();
    const f = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (f) return new Date(+f[3], +f[2] - 1, +f[1]).getTime();
    let s = t.replace(/[^\d,.\-]/g, '').replace(/\./g, '').replace(',', '.');
    if (/^-?\d+(\.\d+)?$/.test(s) && /\d/.test(t)) return parseFloat(s);
    return t.toLowerCase();
  }

  function ordenarTabla(tabla, idx, th) {
    const tbody = tabla.tBodies[0];
    if (!tbody) return;
    const filas = [...tbody.rows].filter(r => r.cells.length > idx && !r.querySelector('[colspan]'));
    if (filas.length < 2) return;
    const asc = th.getAttribute('data-sort-dir') !== 'asc';

    [...th.parentNode.cells].forEach(c => {
      c.removeAttribute('data-sort-dir');
      const s = c.querySelector('.sort-ind');
      if (s) s.remove();
    });
    th.setAttribute('data-sort-dir', asc ? 'asc' : 'desc');

    filas.sort((a, b) => {
      const va = parseValor(a.cells[idx].textContent);
      const vb = parseValor(b.cells[idx].textContent);
      if (typeof va === 'number' && typeof vb === 'number') return asc ? va - vb : vb - va;
      return asc
        ? String(va).localeCompare(String(vb), 'es', { numeric: true })
        : String(vb).localeCompare(String(va), 'es', { numeric: true });
    });
    filas.forEach(f => tbody.appendChild(f));

    const ind = document.createElement('span');
    ind.className = 'sort-ind';
    ind.textContent = asc ? ' ▲' : ' ▼';
    ind.style.fontSize = '9px';
    ind.style.opacity = '.7';
    th.appendChild(ind);
  }

  function initOrdenables(root) {
    (root || document).querySelectorAll('table.table').forEach(tabla => {
      const thead = tabla.tHead;
      if (!thead || !thead.rows.length || tabla.dataset.sortReady) return;
      tabla.dataset.sortReady = '1';
      [...thead.rows[0].cells].forEach((th, idx) => {
        if (!th.textContent.trim()) return; // columnas sin título (acciones)
        th.style.cursor = 'pointer';
        th.style.userSelect = 'none';
        th.title = 'Clic para ordenar';
        th.addEventListener('click', () => ordenarTabla(tabla, idx, th));
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => initOrdenables());
  // Reintenta tras la carga async de datos
  window.addEventListener('load', () => initOrdenables());
  window.initOrdenables = initOrdenables;
})();
