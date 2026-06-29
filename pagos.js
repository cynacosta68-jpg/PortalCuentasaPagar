'use strict';
const pool = require('../db/pool');
const { getDatosProveedor } = require('../services/arca');

// Registra todas las rutas de proveedores en el servidor http nativo
function register(router) {
  router.get('/api/proveedores', listar);
  router.get('/api/proveedores/:id', obtener);
  router.get('/api/proveedores/arca/:cuit', lookupArca);
  router.post('/api/proveedores', crear);
  router.put('/api/proveedores/:id', actualizar);
  router.delete('/api/proveedores/:id', desactivar);
}

async function listar(req, res) {
  const { rows } = await pool.query(
    `SELECT id, cuit, razon_social, condicion_fiscal, mail, activo,
            ret_ganancias, ret_iva, created_at
     FROM proveedores
     ORDER BY razon_social`
  );
  res.json(rows);
}

async function obtener(req, res) {
  const { rows } = await pool.query(
    'SELECT * FROM proveedores WHERE id = $1',
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json(rows[0]);
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
    if (err.status === 404) return res.status(404).json({ error: 'CUIT no encontrado en ARCA' });
    console.error('[proveedores] error ARCA:', err.message);
    res.status(502).json({ error: 'No se pudo consultar ARCA. Verificá la conexión con Arcanum.' });
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

  const { rows } = await pool.query(
    `INSERT INTO proveedores (
       cuit, razon_social, actividad, condicion_fiscal, categoria_monotributo,
       domicilio_fiscal, mail,
       ret_ganancias, ret_ganancias_regimen,
       ret_iva, ret_iva_alicuota,
       datos_arca_json, datos_arca_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     RETURNING *`,
    [
      cuit, b.razon_social, b.actividad || null, b.condicion_fiscal || null,
      b.categoria_monotributo || null, b.domicilio_fiscal || null, b.mail,
      b.ret_ganancias || false, b.ret_ganancias_regimen || null,
      b.ret_iva || false, b.ret_iva_alicuota || null,
      b.datos_arca_json ? JSON.stringify(b.datos_arca_json) : null,
    ]
  );
  res.status(201).json(rows[0]);
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
       updated_at = now()
     WHERE id = $11
     RETURNING *`,
    [
      b.razon_social, b.actividad, b.condicion_fiscal, b.categoria_monotributo,
      b.domicilio_fiscal, b.mail,
      b.ret_ganancias, b.ret_ganancias_regimen,
      b.ret_iva, b.ret_iva_alicuota,
      req.params.id,
    ]
  );
  if (!rows.length) return res.status(404).json({ error: 'Proveedor no encontrado' });
  res.json(rows[0]);
}

async function desactivar(req, res) {
  await pool.query(
    'UPDATE proveedores SET activo = false, updated_at = now() WHERE id = $1',
    [req.params.id]
  );
  res.json({ ok: true });
}

module.exports = { register };
