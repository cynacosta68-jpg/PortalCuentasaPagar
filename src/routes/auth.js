'use strict';
const cfg = require('../config');
const auth = require('../auth');

function login(req, res) {
  const { password } = req.body || {};
  if (!auth.passwordOk(password)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Contraseña incorrecta' }));
  }
  const secure = cfg.nodeEnv === 'production';
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': auth.sessionCookie(auth.makeToken(), secure),
  });
  res.end(JSON.stringify({ ok: true }));
}

function logout(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': auth.clearCookie(),
  });
  res.end(JSON.stringify({ ok: true }));
}

function me(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ authed: auth.isAuthed(req) }));
}

function register(router) {
  router.post('/api/auth/login', login);
  router.post('/api/auth/logout', logout);
  router.get('/api/auth/me', me);
}

module.exports = { register };
