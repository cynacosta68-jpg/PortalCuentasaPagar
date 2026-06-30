'use strict';
// Sesión sin estado: cookie firmada con HMAC-SHA256 (SESSION_SECRET).
// El token lleva la identidad (usuario + rol). Las contraseñas se guardan
// hasheadas con scrypt (sin dependencias externas).
const crypto = require('crypto');
const cfg = require('./config');

const COOKIE_NAME = 'portal_sess';
const MAX_AGE_SEC = 60 * 60 * 12; // 12 horas

// ── Contraseñas (scrypt) ─────────────────────────────────────
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `scrypt$${salt}$${h}`;
}

function verifyPassword(plain, stored) {
  if (!stored) return false;
  const [algo, salt, h] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !h) return false;
  const test = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(test, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Token de sesión (HMAC firmado, lleva usuario y rol) ──────
function hmac(payload) {
  return crypto.createHmac('sha256', cfg.sessionSecret).update(payload).digest('hex');
}

function makeToken(usuario, rol) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const datos = Buffer.from(JSON.stringify({ u: usuario, r: rol, exp })).toString('base64url');
  return `${datos}.${hmac(datos)}`;
}

// Devuelve { usuario, rol } si el token es válido, o null
function readToken(token) {
  if (!token) return null;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const datos = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(datos));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
    if (!obj.exp || Date.now() / 1000 > obj.exp) return null;
    return { usuario: obj.u, rol: obj.r };
  } catch { return null; }
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

// Identidad del request (o null si no hay sesión válida)
function getUsuario(req) {
  return readToken(parseCookies(req)[COOKIE_NAME]);
}

// ── Permisos por rol ─────────────────────────────────────────
const PERMISOS = {
  gerencia:     { ver: true, cargar: true, corridas: true, autorizar: true,  ejecutar: true,  usuarios: true,  auditoria: true },
  coordinacion: { ver: true, cargar: true, corridas: true, autorizar: false, ejecutar: true,  usuarios: false, auditoria: false },
  analista:     { ver: true, cargar: true, corridas: true, autorizar: false, ejecutar: false, usuarios: false, auditoria: false },
  auditor:      { ver: true, cargar: false, corridas: false, autorizar: false, ejecutar: false, usuarios: false, auditoria: true },
};

function puede(rol, capacidad) {
  return !!(PERMISOS[rol] && PERMISOS[rol][capacidad]);
}

const ROLES_LABEL = {
  gerencia: 'Gerencia', coordinacion: 'Coordinación', analista: 'Analista Contable', auditor: 'Auditor',
};

module.exports = {
  COOKIE_NAME, MAX_AGE_SEC,
  hashPassword, verifyPassword,
  makeToken, readToken, sessionCookie, clearCookie, getUsuario,
  PERMISOS, puede, ROLES_LABEL,
};
