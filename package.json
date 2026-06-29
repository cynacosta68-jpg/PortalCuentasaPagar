'use strict';
const pool = require('../db/pool');

function register(router) {
  router.get('/api/consultas', listar);
  router.get('/api/consultas/:id', obtener);
  router.post('/api/consultas', crear);
  router.post('/api/consultas/:id/responder', responder);
  router.post('/api/consultas/:id/cerrar', cerrar);
}

async function listar(req, res) {
  const { estado, tipo } = req.query || {};
  const conds = ['1=1'];
  const vals  = [];

  if (estado) { vals.push(estado); conds.push(`c.estado = $${vals.length}`); }
  if (tipo)   { vals.push(tipo);   conds.push(`c.tipo = $${vals.length}`); }

  const { rows } = await pool.query(
    `SELECT c.id, c.tipo, c.asunto, c.estado, c.created_at, c.respondido_at,
            p.razon_social, p.cuit, p.mail
     FROM consultas_reclamos c
     LEFT JOIN proveedores p ON p.id = c.proveedor_id
     WHERE ${conds.join(' AND ')}
     ORDER BY
       CASE c.estado WHEN 'pendiente' THEN 0 WHEN 'respondido' THEN 1 ELSE 2 END,
       c.created_at DESC`,
    vals
  );
  res.json(rows);
}

async function obtener(req, res) {
  const { rows: [c] } = await pool.query(
    `SELECT c.*, p.razon_social, p.cuit, p.mail
     FROM consultas_reclamos c
     LEFT JOIN proveedores p ON p.id = c.proveedor_id
     WHERE c.id = $1`,
    [req.params.id]
  );
  if (!c) return res.status(404).json({ error: 'Consulta no encontrada' });
  res.json(c);
}

async function crear(req, res) {
  const { proveedor_id, tipo = 'consulta', asunto, mensaje } = req.body || {};
  if (!asunto?.trim() || !mensaje?.trim()) {
    return res.status(400).json({ error: 'Asunto y mensaje son requeridos' });
  }
  const { rows: [c] } = await pool.query(
    `INSERT INTO consultas_reclamos (proveedor_id, tipo, asunto, mensaje)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [proveedor_id || null, tipo, asunto.trim(), mensaje.trim()]
  );
  res.status(201).json(c);
}

async function responder(req, res) {
  const { respuesta } = req.body || {};
  if (!respuesta?.trim()) {
    return res.status(400).json({ error: 'La respuesta no puede estar vacía' });
  }
  const { rows: [c] } = await pool.query(
    `UPDATE consultas_reclamos
     SET respuesta = $1, estado = 'respondido', respondido_at = now()
     WHERE id = $2 AND estado != 'cerrado'
     RETURNING *`,
    [respuesta.trim(), req.params.id]
  );
  if (!c) return res.status(404).json({ error: 'Consulta no encontrada o ya cerrada' });
  res.json(c);
}

async function cerrar(req, res) {
  const { rows: [c] } = await pool.query(
    `UPDATE consultas_reclamos SET estado = 'cerrado'
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!c) return res.status(404).json({ error: 'Consulta no encontrada' });
  res.json(c);
}

module.exports = { register };
