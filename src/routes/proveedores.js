'use strict';
const pool = require('../db/pool');
const { getDatosProveedor } = require('../services/arca');

// Registra todas las rutas de proveedores en el servidor http nativo
function register(router) {
  router.get('/api/proveedores', listar);
  router.get('/api/retenciones/regimenes', listarRegimenes);
  router.get('/api/proveedores/:id', obtener);
  router.get('/api/proveedores/arca/:cuit', lookupArca);
  router.post('/api/proveedores', crear);
  router.put('/api/proveedores/:id', actualizar);
  router.delete('/api/proveedores/:id', desactivar);
}

async function listar(req, res) {
  const { rows } = await pool.query(
    `SELECT p.id, p.cuit, p.razon_social, p.condicion_fiscal, p.mail, p.activo,
            p.ret_ganancias, p.ret_iva, p.created_at,
            COALESCE(
              (SELECT array_agg(prg.regimen_codigo ORDER BY prg.regimen_codigo)
                 FROM proveedor_regimenes_ganancias prg
                WHERE prg.proveedor_id = p.id),
              '{}'
            ) AS regimenes_ganancias
     FROM proveedores p
     ORDER BY p.razon_social`
  );
  res.json(rows);
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM proveedores WHERE id = $1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
  const regimenes_ganancias = await regimenesDe(rows[0].id);
  res.json({ ...rows[0], regimenes_ganancias });
}

// Consulta ARCA a través de Arcanum y devuelve los datos para autocompletar el formulario
async function lookupArca(req, res) {
  const { cuit } = req.params;
  if (!/^\d{11}$/.test(cuit.replace(/-/g, ''))) {
    return res.status(400).json({ error: 'CUIT inválido' });
  }
  const cuitLimpio = cuit.replace(/-/g, '');
  try {
    const datos = await getDatosProveedor(cuitLimpio);
    res.json(datos);
  } catch (err) {
    // Log siempre el detalle real que devuelve Arcanum (incluido el cuerpo del 404).
    console.error(`[proveedores] error ARCA (status ${err.status || '?'}):`, err.message);
    if (err.status === 404) {
      return res.status(404).json({ error: 'CUIT no encontrado en ARCA', detalle: err.message });
    }
    res.status(502).json({ error: 'No se pudo consultar ARCA. Verificá la conexión con Arcanum.', detalle: err.message });
  }
}

async function crear(req, res) {
  const b = req.body;
  if (!b.cuit || !b.razon_social || !b.mail) {
    return res.status(400).json({ error: 'cuit, razon_social y mail son obligatorios' });
  }
  const cuit = b.cuit.replace(/-/g, '');

  // Verificar si ya existe
  const existe = await pool.query('SELECT id FROM proveedores WHERE cuit = $1', [cuit]);
  if (existe.rows.length) {
    return res.status(409).json({ error: 'Ya existe un proveedor con ese CUIT', id: existe.rows[0].id });
  }

  const regimenes = Array.isArray(b.regimenes_ganancias) ? b.regimenes_ganancias.filter(Boolean) : [];

  const { rows } = await pool.query(
    `INSERT INTO proveedores (
       cuit, razon_social, actividad, condicion_fiscal, categoria_monotributo,
       domicilio_fiscal, mail,
       ret_ganancias, ret_ganancias_regimen,
       ret_iva, ret_iva_alicuota,
       ret_iibb, ret_iibb_alicuota, ret_iibb_jurisdiccion, ret_iibb_regimen,
       ret_suss, ret_suss_alicuota,
       datos_arca_json, datos_arca_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
     RETURNING *`,
    [
      cuit, b.razon_social, b.actividad || null, b.condicion_fiscal || null,
      b.categoria_monotributo || null, b.domicilio_fiscal || null, b.mail,
      b.ret_ganancias || false, regimenes[0] || null,
      b.ret_iva || false, b.ret_iva_alicuota || null,
      b.ret_iibb || false, b.ret_iibb_alicuota || null, b.ret_iibb_jurisdiccion || 'Chubut', b.ret_iibb_regimen || null,
      b.ret_suss || false, b.ret_suss_alicuota || null,
      b.datos_arca_json ? JSON.stringify(b.datos_arca_json) : null,
    ]
  );
  await guardarRegimenes(rows[0].id, regimenes);
  res.status(201).json({ ...rows[0], regimenes_ganancias: regimenes });
}

// Reemplaza el set de regímenes de Ganancias de un proveedor
async function guardarRegimenes(proveedorId, regimenes) {
  await pool.query('DELETE FROM proveedor_regimenes_ganancias WHERE proveedor_id = $1', [proveedorId]);
  for (const reg of [...new Set(regimenes)]) {
    await pool.query(
      `INSERT INTO proveedor_regimenes_ganancias (proveedor_id, regimen_codigo)
       VALUES ($1,$2) ON CONFLICT (proveedor_id, regimen_codigo) DO NOTHING`,
      [proveedorId, reg]
    );
  }
}

async function actualizar(req, res) {
  const b = req.body;
  const { rows } = await pool.query(
    `UPDATE proveedores SET
       razon_social = COALESCE($1, razon_social),
       actividad = COALESCE($2, actividad),
       condicion_fiscal = COALESCE($3, condicion_fiscal),
       categoria_monotributo = COALESCE($4, categoria_monotributo),
       domicilio_fiscal = COALESCE($5, domicilio_fiscal),
       mail = COALESCE($6, mail),
       ret_ganancias = COALESCE($7, ret_ganancias),
       ret_ganancias_regimen = COALESCE($8, ret_ganancias_regimen),
       ret_iva = COALESCE($9, ret_iva),
       ret_iva_alicuota = COALESCE($10, ret_iva_alicuota),
       ret_iibb = COALESCE($11, ret_iibb),
       ret_iibb_alicuota = COALESCE($12, ret_iibb_alicuota),
       ret_iibb_jurisdiccion = COALESCE($13, ret_iibb_jurisdiccion),
       ret_iibb_regimen = COALESCE($14, ret_iibb_regimen),
       ret_suss = COALESCE($15, ret_suss),
       ret_suss_alicuota = COALESCE($16, ret_suss_alicuota),
       updated_at = now()
     WHERE id = $17
     RETURNING *`,
    [
      b.razon_social, b.actividad, b.condicion_fiscal, b.categoria_monotributo,
      b.domicilio_fiscal, b.mail,
      b.ret_ganancias, b.ret_ganancias_regimen,
      b.ret_iva, b.ret_iva_alicuota,
      b.ret_iibb, b.ret_iibb_alicuota, b.ret_iibb_jurisdiccion, b.ret_iibb_regimen,
      b.ret_suss, b.ret_suss_alicuota,
      req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
  if (Array.isArray(b.regimenes_ganancias)) {
    await guardarRegimenes(rows[0].id, b.regimenes_ganancias.filter(Boolean));
  }
  const regs = await regimenesDe(rows[0].id);
  res.json({ ...rows[0], regimenes_ganancias: regs });
}

// Devuelve los códigos de régimen de Ganancias de un proveedor
async function regimenesDe(proveedorId) {
  const { rows } = await pool.query(
    'SELECT regimen_codigo FROM proveedor_regimenes_ganancias WHERE proveedor_id = $1 ORDER BY regimen_codigo',
    [proveedorId]
  );
  return rows.map(r => r.regimen_codigo);
}

async function desactivar(req, res) {
  await pool.query(
    'UPDATE proveedores SET activo = false, updated_at = now() WHERE id = $1',
    [req.params.id]
  );
  res.json({ ok: true });
}

// Lista los regímenes RG830 vigentes para poblar el select del ABM
async function listarRegimenes(req, res) {
  const { rows } = await pool.query(
    `SELECT regimen_codigo, descripcion
       FROM tablas_ret_ganancias
      WHERE vigencia_desde <= CURRENT_DATE
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURRENT_DATE)
      ORDER BY regimen_codigo::int`
  );
  res.json({ rows });
}

module.exports = { register };
