'use strict';
const pool = require('../db/pool');
const auth = require('../auth');

const ROLES_VALIDOS = ['gerencia', 'coordinacion', 'analista', 'auditor'];

async function listar(req, res) {
  const { rows } = await pool.query(
    `SELECT id, usuario, nombre, email, rol, debe_cambiar, activo, ultimo_acceso, created_at
     FROM usuarios ORDER BY activo DESC, nombre`
  );
  res.json(rows.map(u => ({ ...u, rol_label: auth.ROLES_LABEL[u.rol] || u.rol })));
}

async function crear(req, res) {
  const { usuario, nombre, email, rol, password } = req.body || {};
  if (!usuario || !nombre || !rol || !password) {
    return res.status(400).json({ error: 'Usuario, nombre, rol y contraseña son requeridos' });
  }
  if (!ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
  if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const user = String(usuario).trim().toLowerCase();
  const existe = await pool.query('SELECT 1 FROM usuarios WHERE usuario = $1', [user]);
  if (existe.rows.length) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });

  const { rows: [u] } = await pool.query(
    `INSERT INTO usuarios (usuario, nombre, email, rol, password_hash, debe_cambiar, activo)
     VALUES ($1,$2,$3,$4,$5,true,true)
     RETURNING id, usuario, nombre, email, rol, activo`,
    [user, nombre.trim(), email?.trim() || null, rol, auth.hashPassword(password)]
  );
  res.status(201).json(u);
}

async function actualizar(req, res) {
  const { nombre, email, rol, activo } = req.body || {};
  if (rol && !ROLES_VALIDOS.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });

  const sets = [], vals = [];
  if (nombre !== undefined) { vals.push(nombre.trim()); sets.push(`nombre = $${vals.length}`); }
  if (email !== undefined)  { vals.push(email?.trim() || null); sets.push(`email = $${vals.length}`); }
  if (rol !== undefined)    { vals.push(rol); sets.push(`rol = $${vals.length}`); }
  if (activo !== undefined) { vals.push(!!activo); sets.push(`activo = $${vals.length}`); }
  if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

  vals.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id`, vals
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
}

async function resetPassword(req, res) {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }
  const { rows } = await pool.query(
    'UPDATE usuarios SET password_hash = $1, debe_cambiar = true WHERE id = $2 RETURNING usuario',
    [auth.hashPassword(password), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true, mensaje: 'Contraseña restablecida. El usuario deberá cambiarla al ingresar.' });
}

function register(router) {
  router.get('/api/usuarios', listar);
  router.post('/api/usuarios', crear);
  router.put('/api/usuarios/:id', actualizar);
  router.post('/api/usuarios/:id/reset-password', resetPassword);
}

module.exports = { register };
