'use strict';

// Setear período actual como default
(function initDefaults() {
  const hoy = new Date();
  const yyyymm = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('siap-periodo').value = yyyymm;

  // Rango del mes actual para los CSV
  const primerDia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);
  ['corr-desde', 'eg-desde'].forEach(id => document.getElementById(id).value = primerDia);
  ['corr-hasta', 'eg-hasta'].forEach(id => document.getElementById(id).value = ultimoDia);
})();

// ── SIAP Ganancias ───────────────────────────────────────────

document.getElementById('btn-siap').addEventListener('click', async () => {
  const periodoInput = document.getElementById('siap-periodo').value; // "YYYY-MM"
  if (!periodoInput) {
    return showAlert('Seleccioná un período', 'error');
  }
  const periodo = periodoInput.replace('-', ''); // "YYYYMM"

  const info = document.getElementById('siap-info');
  info.textContent = 'Generando archivo...';

  try {
    const resp = await fetch(`/api/descargas/siap-ganancias?periodo=${periodo}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || resp.statusText);
    }
    const blob = await resp.blob();
    const filename = `ret_ganancias_${periodo}.txt`;
    descargarBlob(blob, filename);
    info.textContent = `✓ Archivo ${filename} descargado. Importalo en SIAP › Ganancias › Retenciones y Percepciones › Importar.`;
  } catch (err) {
    info.textContent = '';
    showAlert('Error: ' + err.message, 'error');
  }
});

// ── CSV Corridas ─────────────────────────────────────────────

document.getElementById('btn-corridas-csv').addEventListener('click', async () => {
  const desde = document.getElementById('corr-desde').value;
  const hasta = document.getElementById('corr-hasta').value;
  const params = new URLSearchParams();
  if (desde) params.set('desde', desde);
  if (hasta) params.set('hasta', hasta);

  try {
    const resp = await fetch(`/api/descargas/corridas-csv?${params}`);
    if (!resp.ok) throw new Error(resp.statusText);
    const blob = await resp.blob();
    descargarBlob(blob, `corridas_${mesCompacto()}.csv`);
  } catch (err) {
    showAlert('Error: ' + err.message, 'error');
  }
});

// ── CSV Egresos ──────────────────────────────────────────────

document.getElementById('btn-egresos-csv').addEventListener('click', async () => {
  const desde  = document.getElementById('eg-desde').value;
  const hasta  = document.getElementById('eg-hasta').value;
  const estado = document.getElementById('eg-estado').value;
  const params = new URLSearchParams();
  if (desde)  params.set('desde', desde);
  if (hasta)  params.set('hasta', hasta);
  if (estado) params.set('estado', estado);

  try {
    const resp = await fetch(`/api/descargas/egresos-csv?${params}`);
    if (!resp.ok) throw new Error(resp.statusText);
    const blob = await resp.blob();
    descargarBlob(blob, `egresos_${mesCompacto()}.csv`);
  } catch (err) {
    showAlert('Error: ' + err.message, 'error');
  }
});

// ── Helpers ──────────────────────────────────────────────────

function descargarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function mesCompacto() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}
