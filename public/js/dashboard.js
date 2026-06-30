'use strict';
/* Dashboard — panel resumen */

(async () => {
  document.getElementById('fecha-hoy').textContent =
    new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const V = getComputedStyle(document.documentElement);
  const v = n => V.getPropertyValue('--' + n).trim() || '#2563eb';

  // Elige la unidad (pesos / miles / millones) según el set de datos
  const escala = valores => {
    const max = Math.max(0, ...valores.map(x => Math.abs(parseFloat(x) || 0)));
    if (max >= 1e6) return { div: 1e6, unidad: 'en millones de pesos' };
    if (max >= 1e3) return { div: 1e3, unidad: 'en miles de pesos' };
    return { div: 1, unidad: 'en pesos' };
  };
  const tickEje = (val, div) => (val / div).toLocaleString('es-AR', { maximumFractionDigits: div > 1 ? 1 : 0 });

  try {
    const [metricas, tendencia, pagos, topProv, estados, alertas, consultas] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/dashboard/tendencia-egresos'),
      apiFetch('/api/dashboard/tendencia-pagos'),
      apiFetch('/api/dashboard/top-proveedores'),
      apiFetch('/api/dashboard/pagado-vs-pendiente'),
      apiFetch('/api/dashboard/alertas'),
      apiFetch('/api/consultas').catch(() => []),
    ]);

    // ── Métricas ────────────────────────────────────────
    document.getElementById('m-comprobantes').textContent = metricas.comprobantes.toLocaleString('es-AR');
    document.getElementById('m-importe').textContent = formatImporte(metricas.importe_total);
    document.getElementById('m-corridas').textContent = metricas.corridas.toLocaleString('es-AR');
    document.getElementById('m-proveedores').textContent = metricas.proveedores.toLocaleString('es-AR');

    const mesCorto = iso => new Date(iso).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });

    // ── 1. Egresos devengados (barras finas, azul) ───
    const escEg = escala(tendencia.map(r => r.total));
    new Chart(document.getElementById('chart-tendencia'), {
      type: 'bar',
      data: {
        labels: tendencia.map(r => mesCorto(r.mes)),
        datasets: [{
          data: tendencia.map(r => parseFloat(r.total)),
          backgroundColor: v('v2'),
          borderRadius: 6,
          maxBarThickness: 16,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatImporte(ctx.raw)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            grid: { display: false },
            ticks: { font: { size: 11 }, callback: x => tickEje(x, escEg.div) },
            title: { display: true, text: escEg.unidad, font: { size: 10 }, color: '#9aa0b0' },
          },
        },
      },
    });

    // ── 2. Torta: estado de egresos (violeta, leyenda con %) ──
    const { pagado = 0, pendiente = 0, en_proceso = 0 } = estados;
    const vals = [parseFloat(pagado), parseFloat(pendiente), parseFloat(en_proceso)];
    const totalEst = vals.reduce((a, b) => a + b, 0) || 1;
    new Chart(document.getElementById('chart-estados'), {
      type: 'doughnut',
      data: {
        labels: ['Pagada', 'Pendiente', 'En corrida de pago'],
        datasets: [{ data: vals, backgroundColor: [v('v2'), v('v4'), v('v6')], borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: { size: 12 }, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14,
              generateLabels: chart => chart.data.labels.map((lab, i) => ({
                text: `${lab}  ${Math.round(vals[i] / totalEst * 100)}%`,
                fillStyle: chart.data.datasets[0].backgroundColor[i],
                strokeStyle: chart.data.datasets[0].backgroundColor[i],
                index: i,
              })),
            },
          },
          tooltip: { callbacks: { label: ctx => ` ${formatImporte(ctx.raw)}` } },
        },
      },
    });

    // ── 3. Salida de fondos (línea, azul) ────────────
    const escPg = escala(pagos.map(r => r.total));
    new Chart(document.getElementById('chart-pagos'), {
      type: 'line',
      data: {
        labels: pagos.map(r => mesCorto(r.mes)),
        datasets: [{
          data: pagos.map(r => parseFloat(r.total)),
          borderColor: v('v1'), backgroundColor: 'rgba(37,99,235,.10)',
          borderWidth: 2.5, tension: 0.4, fill: true,
          pointRadius: 3, pointBackgroundColor: v('v1'), pointBorderColor: '#fff', pointBorderWidth: 1.5,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatImporte(ctx.raw)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: {
            grid: { display: false },
            ticks: { font: { size: 11 }, callback: x => tickEje(x, escPg.div) },
            title: { display: true, text: escPg.unidad, font: { size: 10 }, color: '#9aa0b0' },
          },
        },
      },
    });

    // ── 4. Egresos por proveedor (barras horizontales, desc) ──
    const tp = topProv.slice(0, 7);
    const escPr = escala(tp.map(p => p.total_imputado));
    new Chart(document.getElementById('chart-proveedores'), {
      type: 'bar',
      data: {
        labels: tp.map(p => p.razon_social.length > 22 ? p.razon_social.slice(0, 21) + '…' : p.razon_social),
        datasets: [{
          data: tp.map(p => parseFloat(p.total_imputado)),
          backgroundColor: v('v3'), borderRadius: 6, maxBarThickness: 16,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${formatImporte(ctx.raw)}` } } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 }, callback: x => tickEje(x, escPr.div) },
            title: { display: true, text: escPr.unidad, font: { size: 10 }, color: '#9aa0b0' },
          },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });

    // ── Panel: próximos vencimientos ────────────────────
    renderVencimientos(alertas);

    // ── Panel: últimas consultas y reclamos ─────────────
    renderConsultas(consultas);

  } catch (err) {
    showAlert('Error al cargar el panel: ' + err.message);
  }
})();

function renderVencimientos(a) {
  const cont = document.getElementById('panel-vencimientos');
  const items = [];
  items.push({
    ic: '⏰', cls: 'danger',
    label: 'Egresos vencidos sin pagar',
    sub: a.egresos_vencidos.n > 0 ? formatImporte(a.egresos_vencidos.total) : 'Todo al día',
    val: a.egresos_vencidos.n,
  });
  items.push({
    ic: '📅', cls: 'warning',
    label: 'Vencen en los próximos 3 días',
    sub: a.egresos_por_vencer.n > 0 ? formatImporte(a.egresos_por_vencer.total) : 'Sin vencimientos cercanos',
    val: a.egresos_por_vencer.n,
  });
  items.push({
    ic: '📋', cls: 'info',
    label: 'Corridas esperando aprobación',
    sub: 'En Seguimiento',
    val: a.corridas_pend_aprov,
  });
  items.push({
    ic: '💬', cls: 'info',
    label: 'Consultas sin responder',
    sub: 'En Consultas',
    val: a.consultas_pendientes,
  });

  cont.innerHTML = items.map(i => `
    <li>
      <span class="li-ic">${i.ic}</span>
      <span class="li-main">
        <strong>${i.label}</strong>
        <div class="li-sub">${i.sub}</div>
      </span>
      <span class="li-val">${i.val}</span>
    </li>`).join('');
}

function renderConsultas(lista) {
  const cont = document.getElementById('panel-consultas');
  if (!Array.isArray(lista) || lista.length === 0) {
    cont.innerHTML = '<li class="text-muted">Todavía no hay consultas ni reclamos.</li>';
    return;
  }
  const estiloEstado = {
    pendiente:  { bg: '#fdf6e8', tx: '#b9791a', t: 'Pendiente' },
    respondido: { bg: '#eaf5ee', tx: '#2e7d52', t: 'Respondido' },
    cerrado:    { bg: '#e8f0fe', tx: '#1e40af', t: 'Cerrado' },
  };
  cont.innerHTML = lista.slice(0, 6).map(c => {
    const e = estiloEstado[c.estado] || estiloEstado.pendiente;
    const ic = c.tipo === 'reclamo' ? '⚠️' : '💬';
    const cuando = c.created_at ? new Date(c.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : '';
    return `
      <li>
        <span class="li-ic">${ic}</span>
        <span class="li-main">
          <strong>${c.asunto || (c.tipo === 'reclamo' ? 'Reclamo' : 'Consulta')}</strong>
          <div class="li-sub">${c.razon_social || 'Sin proveedor'} · ${cuando}</div>
        </span>
        <span class="li-badge" style="background:${e.bg}; color:${e.tx}">${e.t}</span>
      </li>`;
  }).join('');
}

function formatCuit(c) {
  if (!c || c.length !== 11) return c || '';
  return `${c.slice(0,2)}-${c.slice(2,10)}-${c.slice(10)}`;
}
