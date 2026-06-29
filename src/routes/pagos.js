'use strict';
const pool = require('../db/pool');
const { calcularRetencionesOrden } = require('../services/retenciones');

function register(router) {
  router.get('/api/corridas', listarCorridas);
  router.get('/api/corridas/:id', obtenerCorrida);
  router.post('/api/corridas/preview', previewCorrida);   // calcula sin guardar
  router.post('/api/corridas', crearCorrida);             // guarda corrida
  router.post('/api/corridas/:id/ejecutar', ejecutarCorrida);
  router.post('/api/corridas/:id/planificar', planificarCorrida);
  router.get('/api/corridas/:id/autorizar', autorizarCorrida); // link de gerencia
  router.post('/api/corridas/:id/rechazar', rechazarCorrida);
  router.get('/api/ordenes/:id/pdf', pdfOrden);
}

// Genera el preview de una corrida sin persistir nada
async function previewCorrida(req, res) {
  const { egreso_ids, fecha_pago, medio_pago } = req.body;
  if (!egreso_ids?.length) return res.status(400).json({ error: 'Seleccioná al menos un egreso' });

  const { rows: egresos } = await pool.query(
    `SELECT e.*, p.* FROM egresos e
     JOIN proveedores p ON p.id = e.proveedor_id
     WHERE e.id = ANY($1::int[]) AND e.estado = 'pendiente'`,
    [egreso_ids]
  );

  if (egresos.length !== egreso_ids.length) {
    return res.status(400).json({ error: 'Algunos egresos no están disponibles o ya están en proceso' });
  }

  const porProveedor = agruparPorProveedor(egresos);
  const ordenes = await Promise.all(
    Object.entries(porProveedor).map(async ([provId, items]) => {
      const proveedor = items[0]; // el JOIN incluye datos del proveedor
      const calc = await calcularRetencionesOrden(proveedor, items);
      return {
        proveedor_id: parseInt(provId),
        cuit: proveedor.cuit,
        razon_social: proveedor.razon_social,
        mail: proveedor.mail,
        egresos: items.map(e => ({ id: e.id, tipo_comprobante: e.tipo_comprobante,
          punto_venta: e.punto_venta, numero: e.numero,
          fecha_comprobante: e.fecha_comprobante, importe_total: e.importe_total })),
        ...calc,
      };
    })
  );

  const totales = {
    importe_bruto: sumar(ordenes, 'importeBruto'),
    total_retenciones: sumar(ordenes, 'totalRetenciones'),
    importe_neto: sumar(ordenes, 'importeNetoPago'),
  };

  res.json({ ordenes, totales, fecha_pago, medio_pago });
}

// Persiste la corrida en estado 'borrador' con sus items
async function crearCorrida(req, res) {
  const { egreso_ids, tipo, fecha_pago, medio_pago } = req.body;
  if (!egreso_ids?.length || !tipo) {
    return res.status(400).json({ error: 'egreso_ids y tipo son requeridos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar que todos los egresos siguen pendientes y bloquearlos
    const { rows: egresos } = await client.query(
      `SELECT e.*, p.id as prov_id, p.cuit, p.razon_social, p.mail,
              p.ret_ganancias, p.ret_ganancias_regimen, p.ret_iva, p.ret_iva_alicuota
       FROM egresos e JOIN proveedores p ON p.id = e.proveedor_id
       WHERE e.id = ANY($1::int[]) AND e.estado = 'pendiente'
       FOR UPDATE OF e`,
      [egreso_ids]
    );

    if (egresos.length !== egreso_ids.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Algunos egresos ya no están disponibles' });
    }

    // Generar código de corrida
    const { rows: [{ nro }] } = await client.query(
      `UPDATE configuracion SET valor = (valor::int + 1)::text WHERE clave = 'nro_siguiente_corrida' RETURNING valor::int - 1 as nro`
    );
    const codigoRef = `CORR-${fechaCompacta()}-${String(nro).padStart(4, '0')}`;

    const porProveedor = agruparPorProveedor(egresos);
    let importeBruto = 0, totalRet = 0, importeNeto = 0;

    const { rows: [corrida] } = await client.query(
      `INSERT INTO corridas_pago (codigo_ref, tipo, estado, fecha_pago, medio_pago,
         importe_bruto, importe_retenciones, importe_neto)
       VALUES ($1,$2,'borrador',$3,$4,0,0,0) RETURNING *`,
      [codigoRef, tipo, fecha_pago || null, medio_pago || null]
    );

    // Crear items y calcular totales
    const ordenesCalc = await Promise.all(
      Object.entries(porProveedor).map(async ([, items]) => {
        const proveedor = items[0];
        const calc = await calcularRetencionesOrden(proveedor, items);
        importeBruto += calc.importeBruto;
        totalRet += calc.totalRetenciones;
        importeNeto += calc.importeNetoPago;

        for (const e of items) {
          await client.query(
            `INSERT INTO corrida_items (corrida_id, egreso_id, proveedor_id, importe_egreso)
             VALUES ($1,$2,$3,$4)`,
            [corrida.id, e.id, e.prov_id, e.importe_total]
          );
          await client.query(
            `UPDATE egresos SET estado = 'en_corrida', corrida_pago_id = $1, updated_at = now()
             WHERE id = $2`,
            [corrida.id, e.id]
          );
        }
        return { proveedor, items, calc };
      })
    );

    await client.query(
      `UPDATE corridas_pago SET importe_bruto=$1, importe_retenciones=$2, importe_neto=$3
       WHERE id=$4`,
      [redondear(importeBruto), redondear(totalRet), redondear(importeNeto), corrida.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...corrida, importe_bruto: redondear(importeBruto),
      importe_retenciones: redondear(totalRet), importe_neto: redondear(importeNeto) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Genera órdenes de pago y pasa a estado 'ejecutada'
async function ejecutarCorrida(req, res) {
  const { id } = req.params;
  const { rows: [corrida] } = await pool.query(
    'SELECT * FROM corridas_pago WHERE id = $1', [id]
  );
  if (!corrida) return res.status(404).json({ error: 'Corrida no encontrada' });
  if (!['borrador', 'aprobada'].includes(corrida.estado)) {
    return res.status(400).json({ error: `No se puede ejecutar una corrida en estado: ${corrida.estado}` });
  }

  const { rows: items } = await pool.query(
    `SELECT ci.egreso_id, ci.importe_egreso, ci.proveedor_id,
            e.tipo_comprobante, e.punto_venta, e.numero, e.fecha_comprobante,
            e.importe_neto, e.importe_iva,
            p.razon_social, p.cuit, p.mail,
            p.ret_ganancias, p.ret_ganancias_regimen, p.ret_iva, p.ret_iva_alicuota
     FROM corrida_items ci
     JOIN egresos e ON e.id = ci.egreso_id
     JOIN proveedores p ON p.id = ci.proveedor_id
     WHERE ci.corrida_id = $1`,
    [id]
  );

  const porProveedor = agruparPorProveedor(items.map(i => ({
    ...i, id: i.egreso_id, importe_total: i.importe_egreso,
  })));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ordenes = [];

    for (const [, egs] of Object.entries(porProveedor)) {
      const p = egs[0];
      const calc = await calcularRetencionesOrden(p, egs);

      const { rows: [{ nro }] } = await client.query(
        `UPDATE configuracion SET valor = (valor::int + 1)::text WHERE clave = 'nro_siguiente_orden' RETURNING valor::int - 1 as nro`
      );
      const numeroOrden = `OP-${fechaCompacta()}-${String(nro).padStart(4, '0')}`;

      const { rows: [orden] } = await client.query(
        `INSERT INTO ordenes_pago (
           corrida_id, proveedor_id, numero_orden, fecha_pago,
           importe_bruto, ret_ganancias, ret_iva, ret_otros,
           importe_total_ret, importe_neto, medio_pago, mail_destinatario
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11) RETURNING *`,
        [
          id, p.proveedor_id || p.prov_id, numeroOrden,
          corrida.fecha_pago || new Date().toISOString().slice(0, 10),
          calc.importeBruto, calc.retGanancias.importe, calc.retIva.importe,
          calc.totalRetenciones, calc.importeNetoPago,
          corrida.medio_pago || 'Transferencia', p.mail,
        ]
      );

      // Crear certificados de retención
      if (calc.retGanancias.importe > 0) {
        await generarCertificado(client, orden.id, 'ganancias',
          p.ret_ganancias_regimen, calc.retGanancias);
      }
      if (calc.retIva.importe > 0) {
        await generarCertificado(client, orden.id, 'iva', null, calc.retIva);
      }

      ordenes.push({ ...orden, calc });
    }

    await client.query(
      `UPDATE corridas_pago SET estado = 'ejecutada', updated_at = now() WHERE id = $1`, [id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, corrida_id: parseInt(id), ordenes_generadas: ordenes.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Envía a gerencia para aprobación (corridas planificadas)
async function planificarCorrida(req, res) {
  const { id } = req.params;
  const { email_gerencia } = req.body;

  const token = require('crypto').randomUUID();
  const expira = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72hs

  await pool.query(
    `UPDATE corridas_pago SET estado = 'pendiente_aprob', token_aprobacion = $1,
      token_expira_at = $2, updated_at = now() WHERE id = $3 AND estado = 'borrador'`,
    [token, expira, id]
  );

  // TODO: enviar mail a gerencia con link de autorización
  // await emailService.enviarAprobacion(email_gerencia, corrida, token);

  res.json({ ok: true, mensaje: 'Corrida enviada a gerencia para aprobación' });
}

// Endpoint que llega gerencia cuando hace clic en "Autorizar" del mail
async function autorizarCorrida(req, res) {
  const { id } = req.params;
  const { token } = req.query;

  const { rows: [corrida] } = await pool.query(
    `SELECT * FROM corridas_pago WHERE id = $1 AND token_aprobacion = $2
     AND estado = 'pendiente_aprob' AND token_expira_at > now()`,
    [id, token]
  );

  if (!corrida) {
    return res.status(400).send('<h2>Link inválido o expirado. Solicitá una nueva corrida de pagos.</h2>');
  }

  await pool.query(
    `UPDATE corridas_pago SET estado = 'aprobada', aprobado_at = now(), updated_at = now()
     WHERE id = $1`,
    [id]
  );

  res.send(`<h2>✓ Corrida ${corrida.codigo_ref} autorizada correctamente. El equipo contable fue notificado.</h2>`);
}

async function rechazarCorrida(req, res) {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE corridas_pago SET estado = 'rechazada', updated_at = now()
       WHERE id = $1 AND estado IN ('borrador','pendiente_aprob','aprobada')`,
      [id]
    );
    // Devolver egresos a pendiente
    await client.query(
      `UPDATE egresos SET estado = 'pendiente', corrida_pago_id = NULL, updated_at = now()
       WHERE corrida_pago_id = $1`,
      [id]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function pdfOrden(req, res) {
  // TODO: generar PDF con pdfkit
  res.status(501).json({ error: 'PDF en construcción' });
}

async function listarCorridas(req, res) {
  const { rows } = await pool.query(
    `SELECT id, codigo_ref, tipo, estado, fecha_pago, medio_pago,
            importe_bruto, importe_retenciones, importe_neto, created_at
     FROM corridas_pago ORDER BY created_at DESC`
  );
  res.json(rows);
}

async function obtenerCorrida(req, res) {
  const { rows: [corrida] } = await pool.query(
    'SELECT * FROM corridas_pago WHERE id = $1', [req.params.id]
  );
  if (!corrida) return res.status(404).json({ error: 'Corrida no encontrada' });

  const { rows: items } = await pool.query(
    `SELECT ci.*, e.tipo_comprobante, e.punto_venta, e.numero,
            e.fecha_comprobante, e.importe_total, e.concepto,
            p.razon_social, p.cuit
     FROM corrida_items ci
     JOIN egresos e ON e.id = ci.egreso_id
     JOIN proveedores p ON p.id = ci.proveedor_id
     WHERE ci.corrida_id = $1`,
    [req.params.id]
  );

  const { rows: ordenes } = await pool.query(
    `SELECT o.*, p.razon_social, p.cuit
     FROM ordenes_pago o JOIN proveedores p ON p.id = o.proveedor_id
     WHERE o.corrida_id = $1`,
    [req.params.id]
  );

  res.json({ ...corrida, items, ordenes });
}

// Helpers
function agruparPorProveedor(egresos) {
  return egresos.reduce((acc, e) => {
    const pid = e.proveedor_id || e.prov_id;
    if (!acc[pid]) acc[pid] = [];
    acc[pid].push(e);
    return acc;
  }, {});
}

async function generarCertificado(client, ordenId, tipo, regimen, calc) {
  const { rows: [{ nro }] } = await client.query(
    `UPDATE configuracion SET valor = (valor::int + 1)::text WHERE clave = 'nro_siguiente_cert' RETURNING valor::int - 1 as nro`
  );
  const numeroCert = `CERT-${fechaCompacta()}-${String(nro).padStart(4, '0')}`;
  const periodo = new Date().toISOString().slice(0, 7).replace('-', '');

  await client.query(
    `INSERT INTO certificados_retencion (orden_pago_id, tipo_retencion, regimen_codigo,
       base_calculo, alicuota, importe, periodo_fiscal, numero_cert)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ordenId, tipo, regimen, calc.base, calc.alicuota, calc.importe, periodo, numeroCert]
  );
}

function fechaCompacta() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function redondear(n) { return Math.round(n * 100) / 100; }
function sumar(arr, k) { return arr.reduce((s, o) => s + (o[k] || 0), 0); }

module.exports = { register };
