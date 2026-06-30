'use strict';
const pool = require('../db/pool');

function register(router) {
  router.get('/api/egresos', listar);
  router.get('/api/egresos/:id', obtener);
  router.post('/api/egresos', crear);
  router.put('/api/egresos/:id', actualizar);
  router.delete('/api/egresos/:id', anular);
  router.get('/api/egresos/export/csv', exportarCsv);
}

async function listar(req, res) {
  const { estado, proveedor_id, desde, hasta } = req.query;
  const params = [];
  const filtros = [];

  if (estado) { params.push(estado); filtros.push(`e.estado = $${params.length}`); }
  else { filtros.push(`e.estado <> 'anulado'`); } // por defecto, ocultar eliminados
  if (proveedor_id) { params.push(proveedor_id); filtros.push(`e.proveedor_id = $${params.length}`); }
  if (desde) { params.push(desde); filtros.push(`e.fecha_comprobante >= $${params.length}`); }
  if (hasta) { params.push(hasta); filtros.push(`e.fecha_comprobante <= $${params.length}`); }

  const where = filtros.length ? 'WHERE ' + filtros.join(' AND ') : '';

  const { rows } = await pool.query(
    `SELECT e.id, e.tipo_comprobante, e.punto_venta, e.numero,
            e.fecha_comprobante, e.importe_total, e.fecha_vto_pago,
            e.concepto, e.categoria_egreso, e.estado, e.origen,
            p.razon_social, p.cuit
     FROM egresos e
     JOIN proveedores p ON p.id = e.proveedor_id
     ${where}
     ORDER BY e.fecha_vto_pago ASC NULLS LAST, e.fecha_comprobante ASC`,
    params
  );
  res.json(rows);
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    `SELECT e.*, p.razon_social, p.cuit, p.mail
     FROM egresos e JOIN proveedores p ON p.id = e.proveedor_id
     WHERE e.id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Egreso no encontrado' });
  res.json(rows[0]);
}

async function crear(req, res) {
  const b = req.body;
  const required = ['proveedor_id', 'tipo_comprobante', 'punto_venta', 'numero',
                    'fecha_comprobante', 'importe_total', 'cuit_emisor'];
  const faltantes = required.filter(k => b[k] == null);
  if (faltantes.length) {
    return res.status(400).json({ error: `Campos requeridos: ${faltantes.join(', ')}` });
  }

  // Control de duplicados: misma factura (tipo + punto de venta + número) del
  // mismo emisor (por CUIT o por proveedor, por si una carga vino del QR y otra manual).
  const cuitEmisor = String(b.cuit_emisor || '').replace(/-/g, '');
  const dup = await pool.query(
    `SELECT id FROM egresos
      WHERE tipo_comprobante = $1 AND punto_venta = $2 AND numero = $3
        AND (cuit_emisor = $4 OR proveedor_id = $5)`,
    [b.tipo_comprobante.toUpperCase(), b.punto_venta, b.numero, cuitEmisor, b.proveedor_id]
  );
  if (dup.rows.length) {
    return res.status(409).json({
      error: `Esta factura ya está cargada (${b.tipo_comprobante.toUpperCase()} ${String(b.punto_venta).padStart(4,'0')}-${String(b.numero).padStart(8,'0')}).`,
      id: dup.rows[0].id,
    });
  }

  let rows;
  try {
    ({ rows } = await pool.query(
    `INSERT INTO egresos (
       proveedor_id, tipo_comprobante, punto_venta, numero,
       fecha_comprobante, cuit_emisor,
       importe_neto, importe_iva, importe_otros, importe_total,
       moneda, cotizacion,
       concepto, categoria_egreso, regimen_ganancias, fecha_vto_pago, origen,
       raw_qr_data, raw_pdf_text
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      b.proveedor_id, b.tipo_comprobante.toUpperCase(), b.punto_venta, b.numero,
      b.fecha_comprobante, b.cuit_emisor,
      b.importe_neto || 0, b.importe_iva || 0, b.importe_otros || 0, b.importe_total,
      b.moneda || 'PES', b.cotizacion || 1,
      b.concepto || null, b.categoria_egreso || null, b.regimen_ganancias || null,
      b.fecha_vto_pago || null, b.origen || 'manual',
      b.raw_qr_data || null, b.raw_pdf_text || null,
    ]
    ));
  } catch (err) {
    if (err.code === '23505') { // restricción única: factura duplicada
      return res.status(409).json({
        error: `Esta factura ya está cargada (${b.tipo_comprobante.toUpperCase()} ${String(b.punto_venta).padStart(4,'0')}-${String(b.numero).padStart(8,'0')}).`,
      });
    }
    throw err;
  }
  res.status(201).json(rows[0]);
}

async function actualizar(req, res) {
  const b = req.body;
  const { rows } = await pool.query(
    `UPDATE egresos SET
       concepto = COALESCE($1, concepto),
       categoria_egreso = COALESCE($2, categoria_egreso),
       fecha_vto_pago = COALESCE($3, fecha_vto_pago),
       regimen_ganancias = $4,
       importe_neto = COALESCE($5, importe_neto),
       importe_iva = COALESCE($6, importe_iva),
       importe_otros = COALESCE($7, importe_otros),
       importe_total = COALESCE($8, importe_total),
       fecha_comprobante = COALESCE($9, fecha_comprobante),
       updated_at = now()
     WHERE id = $10 AND estado = 'pendiente'
     RETURNING *`,
    [b.concepto, b.categoria_egreso, b.fecha_vto_pago, b.regimen_ganancias || null,
     b.importe_neto, b.importe_iva, b.importe_otros, b.importe_total, b.fecha_comprobante,
     req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Egreso no encontrado o no editable (solo se pueden editar los pendientes)' });
  res.json(rows[0]);
}

async function anular(req, res) {
  const { rows } = await pool.query(
    `UPDATE egresos SET estado = 'anulado', updated_at = now()
     WHERE id = $1 AND estado = 'pendiente'
     RETURNING id`,
    [req.params.id]
  );
  if (!rows.length) return res.status(400).json({ error: 'Solo se pueden anular egresos pendientes' });
  res.json({ ok: true });
}

async function exportarCsv(req, res) {
  const { rows } = await pool.query(
    `SELECT p.cuit, p.razon_social, e.tipo_comprobante, e.punto_venta, e.numero,
            e.fecha_comprobante, e.importe_neto, e.importe_iva, e.importe_otros,
            e.importe_total, e.moneda, e.concepto, e.categoria_egreso,
            e.fecha_vto_pago, e.estado, e.origen, e.created_at
     FROM egresos e JOIN proveedores p ON p.id = e.proveedor_id
     ORDER BY e.fecha_comprobante DESC`
  );

  const cols = Object.keys(rows[0] || {});
  const csv = [
    cols.join(','),
    ...rows.map(r => cols.map(c => csvVal(r[c])).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="egresos.csv"');
  res.end('﻿' + csv); // BOM para que Excel abra correctamente
}

function csvVal(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

module.exports = { register };
