'use strict';
const pool = require('../db/pool');
const { generarTxtSIAP } = require('../services/siap');

function register(router) {
  // TXT SIAP para retenciones de Ganancias (RG 830)
  router.get('/api/descargas/siap-ganancias', exportarSIAPGanancias);

  // CSV de corridas por rango de fechas
  router.get('/api/descargas/corridas-csv', exportarCorridasCSV);

  // CSV de egresos por rango de fechas
  router.get('/api/descargas/egresos-csv', exportarEgresosCSV);
}

// ── TXT SIAP Ganancias ───────────────────────────────────────

async function exportarSIAPGanancias(req, res) {
  // ?periodo=YYYYMM  (ej: 202503)  — si se omite, usa el mes actual
  const periodo = req.query?.periodo || mesActual();
  if (!/^\d{6}$/.test(periodo)) {
    return res.status(400).json({ error: 'Formato de período inválido. Use YYYYMM (ej: 202503)' });
  }

  const anio = parseInt(periodo.slice(0, 4));
  const mes  = parseInt(periodo.slice(4, 6));
  // Primer y último día del período
  const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const hasta = ultimoDia(anio, mes);

  const { rows } = await pool.query(
    `SELECT
       cr.regimen_codigo,
       cr.base_calculo,
       cr.alicuota,
       cr.importe,
       cr.numero_cert,
       -- Extraer la parte numérica del número de cert para el campo de 16 dígitos
       REGEXP_REPLACE(cr.numero_cert, '[^0-9]', '', 'g') AS nro_cert_numerico,
       o.fecha_pago,
       p.cuit,
       p.razon_social,
       e.punto_venta,
       e.numero,
       e.fecha_comprobante,
       e.tipo_comprobante
     FROM certificados_retencion cr
     JOIN ordenes_pago o ON o.id = cr.orden_pago_id
     JOIN proveedores p ON p.id = o.proveedor_id
     -- Tomamos el primer egreso de la orden para los datos del comprobante
     -- (si hay varios se generan múltiples líneas, una por egreso)
     JOIN corrida_items ci ON ci.corrida_id = o.corrida_id AND ci.proveedor_id = o.proveedor_id
     JOIN egresos e ON e.id = ci.egreso_id
     WHERE cr.tipo_retencion = 'ganancias'
       AND o.fecha_pago BETWEEN $1 AND $2
     ORDER BY o.fecha_pago, p.cuit, e.fecha_comprobante`,
    [desde, hasta]
  );

  if (!rows.length) {
    // Devolver archivo vacío igualmente (SIAP acepta archivos sin registros)
    res.setHeader('Content-Type', 'text/plain; charset=windows-1252');
    res.setHeader('Content-Disposition', `attachment; filename="ret_ganancias_${periodo}.txt"`);
    return res.end('');
  }

  const txt = generarTxtSIAP(rows);

  res.setHeader('Content-Type', 'text/plain; charset=windows-1252');
  res.setHeader('Content-Disposition', `attachment; filename="ret_ganancias_${periodo}.txt"`);
  // Node envía UTF-8 nativo; para producción con caracteres especiales sería necesario
  // transcodificar a windows-1252, pero los datos (CUITs, números) son ASCII puro.
  res.end(txt, 'latin1');
}

// ── CSV Corridas ─────────────────────────────────────────────

async function exportarCorridasCSV(req, res) {
  const { desde, hasta } = req.query || {};

  const conds = ['1=1'];
  const vals  = [];

  if (desde) { vals.push(desde); conds.push(`fecha_pago >= $${vals.length}`); }
  if (hasta) { vals.push(hasta); conds.push(`fecha_pago <= $${vals.length}`); }

  const { rows } = await pool.query(
    `SELECT codigo_ref, tipo, estado, fecha_pago, medio_pago,
            importe_bruto, importe_retenciones, importe_neto, created_at
     FROM corridas_pago
     WHERE ${conds.join(' AND ')}
     ORDER BY fecha_pago DESC, created_at DESC`,
    vals
  );

  const header = 'Código,Tipo,Estado,Fecha pago,Medio pago,Importe bruto,Retenciones,Importe neto,Creada\n';
  const body = rows.map(r =>
    [
      r.codigo_ref, r.tipo, r.estado,
      r.fecha_pago ? String(r.fecha_pago).slice(0, 10) : '',
      r.medio_pago || '',
      r.importe_bruto, r.importe_retenciones, r.importe_neto,
      r.created_at ? String(r.created_at).slice(0, 19) : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="corridas_${mesActual()}.csv"`);
  // BOM UTF-8 para que Excel lo abra correctamente en Windows
  res.end('﻿' + header + body);
}

// ── CSV Egresos ──────────────────────────────────────────────

async function exportarEgresosCSV(req, res) {
  const { desde, hasta, estado } = req.query || {};

  const conds = ['1=1'];
  const vals  = [];

  if (desde)  { vals.push(desde);  conds.push(`e.fecha_comprobante >= $${vals.length}`); }
  if (hasta)  { vals.push(hasta);  conds.push(`e.fecha_comprobante <= $${vals.length}`); }
  if (estado) { vals.push(estado); conds.push(`e.estado = $${vals.length}`); }

  const { rows } = await pool.query(
    `SELECT p.razon_social, p.cuit,
            e.tipo_comprobante, e.punto_venta, e.numero,
            e.fecha_comprobante, e.fecha_vto_pago,
            e.importe_neto, e.importe_iva, e.importe_total,
            e.concepto, e.categoria_egreso, e.estado, e.origen,
            e.created_at
     FROM egresos e JOIN proveedores p ON p.id = e.proveedor_id
     WHERE ${conds.join(' AND ')}
     ORDER BY e.fecha_comprobante DESC`,
    vals
  );

  const header = 'Proveedor,CUIT,Tipo,Pto venta,Número,Fecha comp.,Vto pago,Neto,IVA,Total,Concepto,Categoría,Estado,Origen\n';
  const body = rows.map(r =>
    [
      r.razon_social, r.cuit,
      r.tipo_comprobante,
      String(r.punto_venta).padStart(4, '0'),
      String(r.numero).padStart(8, '0'),
      r.fecha_comprobante ? String(r.fecha_comprobante).slice(0, 10) : '',
      r.fecha_vto_pago    ? String(r.fecha_vto_pago).slice(0, 10)    : '',
      r.importe_neto, r.importe_iva, r.importe_total,
      r.concepto || '', r.categoria_egreso || '', r.estado, r.origen,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="egresos_${mesActual()}.csv"`);
  res.end('﻿' + header + body);
}

// ── Helpers ──────────────────────────────────────────────────

function mesActual() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function ultimoDia(anio, mes) {
  return new Date(anio, mes, 0).toISOString().slice(0, 10);
}

module.exports = { register };
