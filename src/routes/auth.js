'use strict';
const cfg = require('../config');
const auth = require('../auth');
const pool = require('../db/pool');

function setJson(res, code) { res.writeHead(code, { 'Content-Type': 'application/json' }); }

async function login(req, res) {
  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    setJson(res, 400); return res.end(JSON.stringify({ error: 'Usuario y contraseña requeridos' }));
  }
  const { rows } = await pool.query(
    'SELECT * FROM usuarios WHERE usuario = $1 AND activo = true', [String(usuario).trim().toLowerCase()]
  );
  const u = rows[0];
  if (!u || !auth.verifyPassword(password, u.password_hash)) {
    setJson(res, 401); return res.end(JSON.stringify({ error: 'Usuario o contraseña incorrectos' }));
  }
  await pool.query('UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1', [u.id]);
  const secure = cfg.nodeEnv === 'production';
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': auth.sessionCookie(auth.makeToken(u.usuario, u.rol), secure),
  });
  res.end(JSON.stringify({ ok: true, debe_cambiar: u.debe_cambiar, rol: u.rol, nombre: u.nombre }));
}

function logout(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': auth.clearCookie() });
  res.end(JSON.stringify({ ok: true }));
}

async function me(req, res) {
  const ident = auth.getUsuario(req);
  if (!ident) { setJson(res, 200); return res.end(JSON.stringify({ authed: false })); }
  const { rows } = await pool.query(
    'SELECT usuario, nombre, email, rol, debe_cambiar FROM usuarios WHERE usuario = $1 AND activo = true',
    [ident.usuario]
  );
  const u = rows[0];
  if (!u) { setJson(res, 200); return res.end(JSON.stringify({ authed: false })); }
  setJson(res, 200);
  res.end(JSON.stringify({
    authed: true, usuario: u.usuario, nombre: u.nombre, email: u.email,
    rol: u.rol, rol_label: auth.ROLES_LABEL[u.rol] || u.rol,
    debe_cambiar: u.debe_cambiar, permisos: auth.PERMISOS[u.rol] || {},
  }));
}

async function cambiarPassword(req, res) {
  const ident = auth.getUsuario(req);
  if (!ident) { setJson(res, 401); return res.end(JSON.stringify({ error: 'No autenticado' })); }
  const { actual, nueva } = req.body || {};
  if (!nueva || String(nueva).length < 8) {
    setJson(res, 400); return res.end(JSON.stringify({ error: 'La nueva contraseña debe tener al menos 8 caracteres' }));
  }
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [ident.usuario]);
  const u = rows[0];
  if (!u) { setJson(res, 404); return res.end(JSON.stringify({ error: 'Usuario no encontrado' })); }
  // Si no es el primer cambio obligatorio, exigir la contraseña actual
  if (!u.debe_cambiar && !auth.verifyPassword(actual, u.password_hash)) {
    setJson(res, 401); return res.end(JSON.stringify({ error: 'La contraseña actual es incorrecta' }));
  }
  await pool.query(
    'UPDATE usuarios SET password_hash = $1, debe_cambiar = false WHERE id = $2',
    [auth.hashPassword(nueva), u.id]
  );
  setJson(res, 200); res.end(JSON.stringify({ ok: true }));
}

function register(router) {
  router.post('/api/auth/login', login);
  router.post('/api/auth/logout', logout);
  router.get('/api/auth/me', me);
  router.post('/api/auth/cambiar-password', cambiarPassword);
}

module.exports = { register };
