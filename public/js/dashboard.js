/* Dashboard — panel resumen */
(async () => {
  try {
    const [metricas, tendencia, topProv, estados] = await Promise.all([
      apiFetch('/api/dashboard'),
      apiFetch('/api/dashboard/tendencia-egresos'),
      apiFetch('/api/dashboard/top-proveedores'),
      apiFetch('/api/dashboard/pagado-vs-pendiente'),
    ]);

    // Métricas
    $('#m-comprobantes').textContent = metricas.comprobantes.toLocaleString('es-AR');
    $('#m-importe').textContent = formatImporte(metricas.importe_total);
    $('#m-corridas').textContent = metricas.corridas.toLocaleString('es-AR');
    $('#m-proveedores').textContent = metricas.proveedores.toLocaleString('es-AR');

    // Gráfico tendencia de egresos
    new Chart($('#chart-tendencia'), {
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
        plugins: { legend: { display: false } },
        scales: {
          y: {
            ticks: {
              callback: v => '$ ' + (v / 1000).toLocaleString('es-AR') + 'k',
            },
          },
        },
      },
    });

    // Gráfico pagado vs pendiente
    const { pagado = 0, pendiente = 0, en_proceso = 0 } = estados;
    new Chart($('#chart-estados'), {
      type: 'doughnut',
      data: {
        labels: ['Pagado', 'Pendiente', 'En proceso'],
        datasets: [{
          data: [parseFloat(pagado), parseFloat(pendiente), parseFloat(en_proceso)],
          backgroundColor: ['#22c55e', '#f59e0b', '#60a5fa'],
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${formatImporte(ctx.raw)}`,
            },
          },
        },
      },
    });

    // Top proveedores
    const tbody = $('#top-prov-body');
    tbody.innerHTML = topProv.length === 0
      ? '<tr><td colspan="4" class="text-center text-muted">Sin datos</td></tr>'
      : topProv.map(p => `
          <tr>
            <td>${p.razon_social}</td>
            <td class="text-muted">${p.cuit}</td>
            <td class="text-right importe">${formatImporte(p.total_imputado)}</td>
            <td class="text-right">${p.cantidad_comprobantes}</td>
          </tr>`).join('');

  } catch (err) {
    showAlert('Error al cargar el panel: ' + err.message);
  }
})();
