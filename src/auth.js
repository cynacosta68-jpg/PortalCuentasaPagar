'use strict';
// Sesión sin estado: cookie firmada con HMAC-SHA256 usando SESSION_SECRET.
// No requiere store ni dependencias externas. La cookie sólo guarda la fecha
// de expiración firmada; si la firma no valida o venció, no hay sesión.
const crypto = require('crypto');
const cfg = require('./config');

const COOKIE_NAME = 'portal_sess';
const MAX_AGE_SEC = 60 * 60 * 12; // 12 horas

function hmac(payload) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update(payload).digest('hex');
}

function makeToken() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload = `auth.${exp}`;
  return `${payload}.${hmac(payload)}`;
}

function verifyToken(token) {
  if (!token) return false;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = hmac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const exp = parseInt(payload.split('.')[1], 10);
  if (!exp || Date.now() / 1000 > exp) return false;
  return true;
}

function sessionCookie(token, secure) {
  const flags = ['HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${MAX_AGE_SEC}`];
  if (secure) flags.push('Secure');
  return `${COOKIE_NAME}=${token}; ${flags.join('; ')}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function isAuthed(req) {
  return verifyToken(parseCookies(req)[COOKIE_NAME]);
}

// Comparación de contraseñas en tiempo constante.
function passwordOk(input) {
  const a = Buffer.from(String(input || ''));
  const b = Buffer.from(String(cfg.adminPass));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  COOKIE_NAME, MAX_AGE_SEC,
  makeToken, verifyToken, sessionCookie, clearCookie, isAuthed, passwordOk,
};
