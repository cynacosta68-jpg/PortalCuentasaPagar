'use strict';
const pool = require('../db/pool');
const { calcularRetencionesOrden } = require('../services/retenciones');
const { generarOrdenPago, generarCertificadoRetencion } = require('../services/pdf');
const { enviarOrdenPago, enviarAprobacionGerencia, enviarNotificacionEjecutada } = require('../services/email');

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
  router.post('/api/ordenes/:id/certificados/regenerar', regenerarCertificados);
  router.get('/api/certificados/:id/pdf', pdfCertificado);
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
      const calc = await calcularRetencionesOrden(proveedor, items, { periodo: periodoDe(fecha_pago) });
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
              p.ret_ganancias, p.ret_ganancias_regimen, p.ret_iva, p.ret_iva_alicuota,
            p.ret_iibb, p.ret_iibb_alicuota, p.ret_iibb_jurisdiccion, p.ret_iibb_regimen, p.ret_suss, p.ret_suss_alicuota
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
        const calc = await calcularRetencionesOrden(proveedor, items, { periodo: periodoDe(fecha_pago) });
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
            e.importe_neto, e.importe_iva, e.regimen_ganancias,
            p.razon_social, p.cuit, p.mail,
            p.ret_ganancias, p.ret_ganancias_regimen, p.ret_iva, p.ret_iva_alicuota,
            p.ret_iibb, p.ret_iibb_alicuota, p.ret_iibb_jurisdiccion, p.ret_iibb_regimen, p.ret_suss, p.ret_suss_alicuota
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
      const calc = await calcularRetencionesOrden(p, egs, { periodo: periodoDe(corrida.fecha_pago) });

      const { rows: [{ nro }] } = await client.query(
        `UPDATE configuracion SET valor = (valor::int + 1)::text WHERE clave = 'nro_siguiente_orden' RETURNING valor::int - 1 as nro`
      );
      const numeroOrden = `OP-${fechaCompacta()}-${String(nro).padStart(4, '0')}`;

      const { rows: [orden] } = await client.query(
        `INSERT INTO ordenes_pago (
           corrida_id, proveedor_id, numero_orden, fecha_pago,
           importe_bruto, ret_ganancias, ret_iva, ret_iibb, ret_suss, ret_otros,
           importe_total_ret, importe_neto, medio_pago, mail_destinatario
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,$12,$13) RETURNING *`,
        [
          id, p.proveedor_id || p.prov_id, numeroOrden,
          corrida.fecha_pago || new Date().toISOString().slice(0, 10),
          calc.importeBruto, calc.retGanancias.importe, calc.retIva.importe,
          calc.retIibb.importe, calc.retSuss.importe,
          calc.totalRetenciones, calc.importeNetoPago,
          corrida.medio_pago || 'Transferencia', p.mail,
        ]
      );

      // Crear certificados de retención
      for (const rg of calc.retencionesGanancias) {
        if (rg.importe > 0) {
          await generarCertificado(client, orden.id, 'ganancias', rg.regimen, rg);
        }
      }
      if (calc.retIva.importe > 0) {
        await generarCertificado(client, orden.id, 'iva', null, calc.retIva);
      }
      if (calc.retIibb.importe > 0) {
        await generarCertificado(client, orden.id, 'iibb', p.ret_iibb_jurisdiccion || 'Chubut', calc.retIibb);
      }
      if (calc.retSuss.importe > 0) {
        await generarCertificado(client, orden.id, 'suss', 'RG 1784', calc.retSuss);
      }

      // Registrar el acumulado mensual de Ganancias por régimen (base y retención
      // de ESTE pago), para que los pagos siguientes del mes resten lo ya retenido.
      const periodo = periodoDe(corrida.fecha_pago);
      for (const rg of calc.retencionesGanancias) {
        await client.query(
          `INSERT INTO retenciones_acumuladas
             (proveedor_id, regimen_codigo, periodo, orden_pago_id, base, retencion)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [orden.proveedor_id, rg.regimen, periodo, orden.id, rg.base, rg.importe]
        );
      }

      ordenes.push({ ...orden, calc, proveedor: p });
    }

    await client.query(
      `UPDATE corridas_pago SET estado = 'ejecutada', updated_at = now() WHERE id = $1`, [id]
    );
    await client.query('COMMIT');

    // Enviar mails a proveedores en background (no bloquea la respuesta)
    enviarMailsOrdenes(corrida, ordenes).catch(err =>
      console.error('[pagos] Error enviando mails:', err)
    );

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

  const { rows: [corridaActualizada] } = await pool.query(
    'SELECT * FROM corridas_pago WHERE id = $1', [id]
  );

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  enviarAprobacionGerencia({
    emailGerencia: email_gerencia,
    corrida: corridaActualizada,
    token,
    baseUrl,
  }).catch(err => console.error('[pagos] Error enviando mail gerencia:', err));

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
  const { id } = req.params;

  const { rows: [orden] } = await pool.query(
    `SELECT o.*, p.razon_social, p.cuit, p.mail
     FROM ordenes_pago o JOIN proveedores p ON p.id = o.proveedor_id
     WHERE o.id = $1`,
    [id]
  );
  if (!orden) return res.status(404).json({ error: 'Orden no encontrada' });

  const { rows: egresos } = await pool.query(
    `SELECT e.tipo_comprobante, e.punto_venta, e.numero, e.fecha_comprobante, e.importe_total
     FROM corrida_items ci JOIN egresos e ON e.id = ci.egreso_id
     WHERE ci.corrida_id = $1 AND ci.proveedor_id = $2`,
    [orden.corrida_id, orden.proveedor_id]
  );

  const { rows: certs } = await pool.query(
    'SELECT * FROM certificados_retencion WHERE orden_pago_id = $1 ORDER BY tipo_retencion',
    [id]
  );

  const empresa = {
    razon_social: process.env.EMPRESA_NOMBRE || '',
    cuit: process.env.EMPRESA_CUIT || '',
    domicilio: process.env.EMPRESA_DOMICILIO || '',
  };

  const proveedor = { razon_social: orden.razon_social, cuit: orden.cuit, mail: orden.mail };
  const buffer = await generarOrdenPago({ orden, proveedor, empresa, egresos, certs });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${orden.numero_orden}.pdf"`);
  res.end(buffer);
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

  // Adjuntar los certificados de retención de cada orden (para descargar su PDF)
  for (const o of ordenes) {
    const { rows: certs } = await pool.query(
      `SELECT id, tipo_retencion, regimen_codigo, importe, numero_cert
         FROM certificados_retencion WHERE orden_pago_id = $1
        ORDER BY tipo_retencion`,
      [o.id]
    );
    o.certificados = certs;
  }

  res.json({ ...corrida, items, ordenes });
}

// ── PDF de certificado individual ────────────────────────────
async function pdfCertificado(req, res) {
  const { id } = req.params;

  const { rows: [cert] } = await pool.query(
    `SELECT cr.*, o.numero_orden, o.fecha_pago, o.corrida_id, o.proveedor_id
     FROM certificados_retencion cr JOIN ordenes_pago o ON o.id = cr.orden_pago_id
     WHERE cr.id = $1`,
    [id]
  );
  if (!cert) return res.status(404).json({ error: 'Certificado no encontrado' });

  const { rows: [proveedor] } = await pool.query(
    'SELECT razon_social, cuit FROM proveedores WHERE id = $1', [cert.proveedor_id]
  );

  const empresa = {
    razon_social: process.env.EMPRESA_NOMBRE || '',
    cuit: process.env.EMPRESA_CUIT || '',
    domicilio: process.env.EMPRESA_DOMICILIO || '',
  };

  const orden = { numero_orden: cert.numero_orden, fecha_pago: cert.fecha_pago };
  const buffer = await generarCertificadoRetencion({ cert, orden, proveedor, empresa });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${cert.numero_cert}.pdf"`);
  res.end(buffer);
}

// ── Envío masivo de mails post-ejecución ─────────────────────
async function enviarMailsOrdenes(corrida, ordenes) {
  const empresa = {
    razon_social: process.env.EMPRESA_NOMBRE || '',
    cuit: process.env.EMPRESA_CUIT || '',
    domicilio: process.env.EMPRESA_DOMICILIO || '',
  };

  for (const ordenData of ordenes) {
    const { calc } = ordenData;

    // Re-fetch la orden guardada con id real
    const { rows: [orden] } = await pool.query(
      `SELECT o.*, p.razon_social, p.cuit, p.mail
       FROM ordenes_pago o JOIN proveedores p ON p.id = o.proveedor_id
       WHERE o.corrida_id = $1 AND o.proveedor_id = $2`,
      [corrida.id, ordenData.proveedor_id || ordenData.calc?.proveedor_id]
    );
    if (!orden || !orden.mail) continue;

    const { rows: egresos } = await pool.query(
      `SELECT e.tipo_comprobante, e.punto_venta, e.numero, e.fecha_comprobante, e.importe_total
       FROM corrida_items ci JOIN egresos e ON e.id = ci.egreso_id
       WHERE ci.corrida_id = $1 AND ci.proveedor_id = $2`,
      [corrida.id, orden.proveedor_id]
    );

    const { rows: certs } = await pool.query(
      'SELECT * FROM certificados_retencion WHERE orden_pago_id = $1', [orden.id]
    );

    const proveedor = { razon_social: orden.razon_social, cuit: orden.cuit, mail: orden.mail };
    const pdfOrdenBuf = await generarOrdenPago({ orden, proveedor, empresa, egresos, certs });

    const certsPdf = [];
    for (const cert of certs) {
      const buf = await generarCertificadoRetencion({
        cert,
        orden: { numero_orden: orden.numero_orden, fecha_pago: orden.fecha_pago },
        proveedor,
        empresa,
      });
      certsPdf.push({ nombre: cert.numero_cert, buffer: buf });
    }

    await enviarOrdenPago({
      destinatario: orden.mail,
      razonSocial: orden.razon_social,
      orden,
      pdfOrden: pdfOrdenBuf,
      certsPdf,
    });

    // Marcar mail enviado
    await pool.query(
      `UPDATE ordenes_pago SET mail_enviado_at = now() WHERE id = $1`, [orden.id]
    );
  }

  // Notificar al equipo interno si hay mail configurado
  if (process.env.EMAIL_INTERNO) {
    await enviarNotificacionEjecutada({
      emailInterno: process.env.EMAIL_INTERNO,
      corrida,
      cantOrdenes: ordenes.length,
    });
  }
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

// Regenera los certificados FALTANTES de una orden ya ejecutada (rescate de
// órdenes que quedaron sin certificado). Ganancias: desde retenciones_acumuladas
// (con imponible/alícuota del régimen). IVA/IIBB/SUSS: desde los montos de la orden.
async function regenerarCertificados(req, res) {
  const { id } = req.params;
  const { rows: [orden] } = await pool.query(
    `SELECT o.*, p.ret_iva_alicuota, p.ret_iibb_alicuota, p.ret_iibb_jurisdiccion, p.ret_suss_alicuota
       FROM ordenes_pago o JOIN proveedores p ON p.id = o.proveedor_id
      WHERE o.id = $1`, [id]
  );
  if (!orden) return res.status(404).json({ error: 'Orden de pago no encontrada' });

  const { rows: existentes } = await pool.query(
    'SELECT tipo_retencion, regimen_codigo FROM certificados_retencion WHERE orden_pago_id = $1', [id]
  );
  const yaExiste = (tipo, reg) =>
    existentes.some(c => c.tipo_retencion === tipo && (c.regimen_codigo || '') === (reg || ''));

  const baseDesdeImporte = (importe, alic) => (alic && alic > 0 ? redondear(importe / (alic / 100)) : importe);

  const client = await pool.connect();
  let creados = 0;
  try {
    await client.query('BEGIN');

    // Ganancias: una por régimen, desde los acumulados de esa orden
    const { rows: acum } = await client.query(
      'SELECT regimen_codigo, base, retencion FROM retenciones_acumuladas WHERE orden_pago_id = $1', [id]
    );
    for (const a of acum) {
      const ret = parseFloat(a.retencion);
      if (ret <= 0 || yaExiste('ganancias', a.regimen_codigo)) continue;
      const { rows: [t] } = await client.query(
        `SELECT escala_json, minimo_no_imponible FROM tablas_ret_ganancias
          WHERE regimen_codigo = $1 AND vigencia_desde <= CURRENT_DATE
            AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURRENT_DATE)
          ORDER BY vigencia_desde DESC LIMIT 1`, [a.regimen_codigo]
      );
      const mni = t ? parseFloat(t.minimo_no_imponible) || 0 : 0;
      const imponible = Math.max(0, parseFloat(a.base) - mni);
      let alicuota = 0;
      if (t) {
        const tr = t.escala_json.find(x => imponible >= x.desde && (x.hasta === null || imponible <= x.hasta));
        if (tr) alicuota = tr.alicuota;
      }
      await generarCertificado(client, id, 'ganancias', a.regimen_codigo,
        { base: imponible || parseFloat(a.base), alicuota, importe: ret });
      creados++;
    }

    // IVA / IIBB / SUSS: desde los montos guardados en la orden
    if (parseFloat(orden.ret_iva) > 0 && !yaExiste('iva', null)) {
      const al = parseFloat(orden.ret_iva_alicuota) || 0;
      await generarCertificado(client, id, 'iva', null,
        { base: baseDesdeImporte(parseFloat(orden.ret_iva), al), alicuota: al, importe: parseFloat(orden.ret_iva) });
      creados++;
    }
    if (parseFloat(orden.ret_iibb) > 0 && !yaExiste('iibb', orden.ret_iibb_jurisdiccion || 'Chubut')) {
      const al = parseFloat(orden.ret_iibb_alicuota) || 0;
      await generarCertificado(client, id, 'iibb', orden.ret_iibb_jurisdiccion || 'Chubut',
        { base: baseDesdeImporte(parseFloat(orden.ret_iibb), al), alicuota: al, importe: parseFloat(orden.ret_iibb) });
      creados++;
    }
    if (parseFloat(orden.ret_suss) > 0 && !yaExiste('suss', 'RG 1784')) {
      const al = parseFloat(orden.ret_suss_alicuota) || 0;
      await generarCertificado(client, id, 'suss', 'RG 1784',
        { base: baseDesdeImporte(parseFloat(orden.ret_suss), al), alicuota: al, importe: parseFloat(orden.ret_suss) });
      creados++;
    }

    await client.query('COMMIT');
    res.json({ ok: true, creados });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
// Período mensual 'YYYY-MM' a partir de una fecha de pago (o el mes actual)
function periodoDe(fecha) {
  const f = fecha ? new Date(fecha) : new Date();
  return f.toISOString().slice(0, 7);
}

module.exports = { register };
