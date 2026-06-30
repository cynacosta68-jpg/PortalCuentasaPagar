'use strict';
const pool = require('../db/pool');

async function listar(req, res) {
  const { usuario, accion, entidad, desde, hasta } = req.query || {};
  const conds = ['1=1'], vals = [];
  if (usuario) { vals.push(usuario); conds.push(`usuario = $${vals.length}`); }
  if (accion)  { vals.push(accion);  conds.push(`accion = $${vals.length}`); }
  if (entidad) { vals.push(entidad); conds.push(`entidad = $${vals.length}`); }
  if (desde)   { vals.push(desde);   conds.push(`created_at >= $${vals.length}`); }
  if (hasta)   { vals.push(hasta + ' 23:59:59'); conds.push(`created_at <= $${vals.length}`); }

  const { rows } = await pool.query(
    `SELECT id, usuario, nombre, rol, accion, entidad, entidad_id, detalle, created_at
     FROM auditoria WHERE ${conds.join(' AND ')}
     ORDER BY created_at DESC LIMIT 500`, vals
  );
  res.json(rows);
}

function register(router) {
  router.get('/api/auditoria', listar);
}

module.exports = { register };
