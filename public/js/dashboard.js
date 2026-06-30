'use strict';
/* Dashboard — panel resumen */

(async () => {
  // Fecha de hoy
  document.getElementById('fecha-hoy').textContent =
    new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  try {
    const [metricas, tendencia, pagos, demora, topProv, estados, alertas] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/dashboard/tendencia-egresos'),
      apiFetch('/api/dashboard/tendencia-pagos'),
      apiFetch('/api/dashboard/demora-pago'),
      apiFetch('/api/dashboard/top-proveedores'),
      apiFetch('/api/dashboard/pagado-vs-pendiente'),
      apiFetch('/api/dashboard/alertas'),
    ]);

    // ── Alertas operativas ──────────────────────────────
    renderAlertas(alertas);

    // ── Métricas ────────────────────────────────────────
    document.getElementById('m-comprobantes').textContent = metricas.comprobantes.toLocaleString('es-AR');
    document.getElementById('m-importe').textContent = formatImporte(metricas.importe_total);
    document.getElementById('m-corridas').textContent = metricas.corridas.toLocaleString('es-AR');
    document.getElementById('m-proveedores').textContent = metricas.proveedores.toLocaleString('es-AR');

    // ── Gráfico tendencia ───────────────────────────────
    new Chart(document.getElementById('chart-tendencia'), {
      type: 'bar',
      data: {
        labels: tendencia.map(r => {
          const d = new Date(r.mes);
          return d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
        }),
        datasets: [{
          label: 'Total egresos',
          data: tendencia.map(r => parseFloat(r.total)),
          backgroundColor: 'rgba(67, 97, 238, 0.7)',
          borderColor: '#4361ee',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { display: false },
            ticks: {
              callback: v => '$ ' + (v / 1000).toLocaleString('es-AR') + 'k',
            },
          },
        },
      },
    });

    // ── Torta: estado de los egresos ────────────────────
    const { pagado = 0, pendiente = 0, en_proceso = 0 } = estados;
    new Chart(document.getElementById('chart-estados'), {
      type: 'doughnut',
      data: {
        labels: ['Pagada', 'Pendiente', 'En corrida de pago'],
        datasets: [{
          data: [parseFloat(pagado), parseFloat(pendiente), parseFloat(en_proceso)],
          backgroundColor: ['#16a34a', '#c0392b', '#cbd5e1'],
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
          tooltip: { callbacks: { label: ctx => ` ${formatImporte(ctx.raw)}` } },
        },
      },
    });

    // ── Demora de pago (barras, azul intermedio, sin líneas) ────
    new Chart(document.getElementById('chart-demora'), {
      type: 'bar',
      data: {
        labels: ['Antes del Vto.', 'En Vto.', 'Vencido <30d', 'Vencido >30d'],
        datasets: [{
          label: 'Egresos pagados',
          data: [demora.antes_vto, demora.en_vto, demora.venc_30, demora.venc_mas30],
          backgroundColor: '#3b82f6',
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.raw} comprobante(s)` } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { display: false }, beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });

    // ── Salida de fondos (línea continua, azul oscuro) ──────────
    new Chart(document.getElementById('chart-pagos'), {
      type: 'line',
      data: {
        labels: pagos.map(r => {
          const d = new Date(r.mes);
          return d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
        }),
        datasets: [{
          label: 'Salida de fondos',
          data: pagos.map(r => parseFloat(r.total)),
          borderColor: '#1e3a8a',
          backgroundColor: '#1e3a8a',
          borderWidth: 2,
          tension: 0.35,
          fill: false,
          pointRadius: 3,
          pointBackgroundColor: '#1e3a8a',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { display: false }, ticks: { callback: v => '$ ' + (v / 1000).toLocaleString('es-AR') + 'k' } },
        },
      },
    });

    // ── Top proveedores ─────────────────────────────────
    const tbody = document.getElementById('top-prov-body');
    tbody.innerHTML = topProv.length === 0
      ? '<tr><td colspan="4" class="text-center text-muted">Sin datos aún</td></tr>'
      : topProv.map(p => `
          <tr>
            <td><strong>${p.razon_social}</strong></td>
            <td class="text-muted" style="font-size:12px">${formatCuit(p.cuit)}</td>
            <td class="text-right importe">${formatImporte(p.total_imputado)}</td>
            <td class="text-right text-muted">${p.cantidad_comprobantes}</td>
          </tr>`).join('');

  } catch (err) {
    showAlert('Error al cargar el panel: ' + err.message);
  }
})();

// ── Alertas operativas ────────────────────────────────────────

function renderAlertas(a) {
  const container = document.getElementById('alertas-container');
  const items = [];

  if (a.egresos_vencidos.n > 0) {
    items.push({
      nivel: 'danger',
      icono: '🔴',
      texto: `<strong>${a.egresos_vencidos.n} egreso${a.egresos_vencidos.n > 1 ? 's' : ''} vencido${a.egresos_vencidos.n > 1 ? 's' : ''}</strong> sin pagar — total ${formatImporte(a.egresos_vencidos.total)}`,
      link: '/pagos.html',
      linkTexto: 'Ir a Pagos',
    });
  }

  if (a.egresos_por_vencer.n > 0) {
    items.push({
      nivel: 'warning',
      icono: '🟡',
      texto: `<strong>${a.egresos_por_vencer.n} egreso${a.egresos_por_vencer.n > 1 ? 's' : ''}</strong> vence${a.egresos_por_vencer.n > 1 ? 'n' : ''} en los próximos 3 días — ${formatImporte(a.egresos_por_vencer.total)}`,
      link: '/pagos.html',
      linkTexto: 'Ir a Pagos',
    });
  }

  if (a.corridas_pend_aprov > 0) {
    items.push({
      nivel: 'info',
      icono: '📋',
      texto: `<strong>${a.corridas_pend_aprov} corrida${a.corridas_pend_aprov > 1 ? 's' : ''}</strong> esperando aprobación de gerencia`,
      link: '/seguimiento.html',
      linkTexto: 'Ver Seguimiento',
    });
  }

  if (a.consultas_pendientes > 0) {
    items.push({
      nivel: 'info',
      icono: '💬',
      texto: `<strong>${a.consultas_pendientes} consulta${a.consultas_pendientes > 1 ? 's' : ''}</strong> sin responder`,
      link: '/consultas.html',
      linkTexto: 'Ir a Consultas',
    });
  }

  if (!items.length) {
    container.innerHTML = `
      <div style="background:#f0faf4; border:1px solid #86efac; border-radius:var(--radius); padding:12px 16px; font-size:13px; color:#166534">
        ✅ <strong>Todo al día</strong> — No hay egresos vencidos ni alertas pendientes.
      </div>`;
    return;
  }

  const colorMap = {
    danger:  { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
    warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
    info:    { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
  };

  container.innerHTML = items.map(item => {
    const c = colorMap[item.nivel];
    return `
      <div style="background:${c.bg}; border:1px solid ${c.border}; border-radius:var(--radius); padding:12px 16px; font-size:13px; color:${c.text}; display:flex; justify-content:space-between; align-items:center; gap:12px">
        <span>${item.icono} ${item.texto}</span>
        <a href="${item.link}" style="color:${c.text}; font-weight:600; white-space:nowrap; text-decoration:underline">${item.linkTexto} →</a>
      </div>`;
  }).join('');
}

function formatCuit(c) {
  if (!c || c.length !== 11) return c || '';
  return `${c.slice(0,2)}-${c.slice(2,10)}-${c.slice(10)}`;
}
