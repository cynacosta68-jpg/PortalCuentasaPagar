'use strict';
const pool = require('../db/pool');

function register(router) {
  router.get('/api/dashboard', metricas);
  router.get('/api/dashboard/tendencia-egresos', tendenciaEgresos);
  router.get('/api/dashboard/tendencia-pagos', tendenciaPagos);
  router.get('/api/dashboard/top-proveedores', topProveedores);
  router.get('/api/dashboard/pagado-vs-pendiente', pagadoVsPendiente);
  router.get('/api/dashboard/alertas', alertas);
}

async function metricas(req, res) {
  const [comprobantes, importeTotal, corridas, proveedores] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM egresos WHERE estado != 'anulado'`),
    pool.query(`SELECT COALESCE(SUM(importe_total),0) as total FROM egresos WHERE estado != 'anulado'`),
    pool.query(`SELECT COUNT(*) FROM corridas_pago WHERE estado NOT IN ('rechazada')`),
    pool.query(`SELECT COUNT(*) FROM proveedores WHERE activo = true`),
  ]);

  res.json({
    comprobantes: parseInt(comprobantes.rows[0].count),
    importe_total: parseFloat(importeTotal.rows[0].total),
    corridas: parseInt(corridas.rows[0].count),
    proveedores: parseInt(proveedores.rows[0].count),
  });
}

async function tendenciaEgresos(req, res) {
  const { rows } = await pool.query(
    `SELECT DATE_TRUNC('month', fecha_comprobante) as mes,
            SUM(importe_total) as total,
            COUNT(*) as cantidad
     FROM egresos
     WHERE estado != 'anulado'
       AND fecha_comprobante >= CURRENT_DATE - INTERVAL '12 months'
     GROUP BY mes
     ORDER BY mes`
  );
  res.json(rows);
}

async function tendenciaPagos(req, res) {
  const { rows } = await pool.query(
    `SELECT DATE_TRUNC('month', o.fecha_pago) as mes,
            SUM(o.importe_neto) as total,
            COUNT(*) as cantidad
     FROM ordenes_pago o
     JOIN corridas_pago c ON c.id = o.corrida_id
     WHERE c.estado = 'ejecutada'
       AND o.fecha_pago >= CURRENT_DATE - INTERVAL '12 months'
     GROUP BY mes
     ORDER BY mes`
  );
  res.json(rows);
}

async function topProveedores(req, res) {
  const { rows } = await pool.query(
    `SELECT p.razon_social, p.cuit,
            SUM(e.importe_total) as total_imputado,
            COUNT(e.id) as cantidad_comprobantes
     FROM egresos e JOIN proveedores p ON p.id = e.proveedor_id
     WHERE e.estado != 'anulado'
     GROUP BY p.id, p.razon_social, p.cuit
     ORDER BY total_imputado DESC
     LIMIT 10`
  );
  res.json(rows);
}

async function pagadoVsPendiente(req, res) {
  const { rows } = await pool.query(
    `SELECT
       SUM(CASE WHEN estado = 'pagado' THEN importe_total ELSE 0 END) as pagado,
       SUM(CASE WHEN estado = 'pendiente' THEN importe_total ELSE 0 END) as pendiente,
       SUM(CASE WHEN estado = 'en_corrida' THEN importe_total ELSE 0 END) as en_proceso
     FROM egresos WHERE estado != 'anulado'`
  );
  res.json(rows[0]);
}

async function alertas(req, res) {
  const [vencidos, porVencer, pendAprov, consultasPend] = await Promise.all([
    // Egresos con vto de pago pasado y aún pendiente
    pool.query(
      `SELECT COUNT(*) as n, COALESCE(SUM(importe_total),0) as total
       FROM egresos
       WHERE estado = 'pendiente' AND fecha_vto_pago < CURRENT_DATE`
    ),
    // Egresos que vencen en los próximos 3 días
    pool.query(
      `SELECT COUNT(*) as n, COALESCE(SUM(importe_total),0) as total
       FROM egresos
       WHERE estado = 'pendiente'
         AND fecha_vto_pago BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'`
    ),
    // Corridas esperando aprobación de gerencia
    pool.query(
      `SELECT COUNT(*) as n FROM corridas_pago
       WHERE estado = 'pendiente_aprob' AND token_expira_at > now()`
    ),
    // Consultas sin responder
    pool.query(
      `SELECT COUNT(*) as n FROM consultas_reclamos WHERE estado = 'pendiente'`
    ),
  ]);

  res.json({
    egresos_vencidos:   { n: parseInt(vencidos.rows[0].n),    total: parseFloat(vencidos.rows[0].total) },
    egresos_por_vencer: { n: parseInt(porVencer.rows[0].n),   total: parseFloat(porVencer.rows[0].total) },
    corridas_pend_aprov: parseInt(pendAprov.rows[0].n),
    consultas_pendientes: parseInt(consultasPend.rows[0].n),
  });
}

module.exports = { register };
