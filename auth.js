'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cargar variables de entorno desde .env si existe
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const cfg = require('./config');
const pool = require('./db/pool');
const auth = require('./auth');

// Rutas de API
const routeModules = [
  require('./routes/auth'),
  require('./routes/dashboard'),
  require('./routes/proveedores'),
  require('./routes/egresos'),
  require('./routes/pagos'),
  require('./routes/comprobantes'),
  require('./routes/descargas'),
  require('./routes/consultas'),
];

// Endpoints de API accesibles sin sesión.
const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
]);

// Archivos estáticos necesarios para mostrar el login.
const PUBLIC_STATIC = new Set([
  '/login.html',
  '/css/app.css',
  '/js/login.js',
]);

function isPublicApi(pathname) {
  if (PUBLIC_API.has(pathname)) return true;
  // Link de aprobación de gerencia: protegido por su propio token UUID.
  if (pathname.startsWith('/api/corridas/') && pathname.endsWith('/autorizar')) return true;
  return false;
}

// Mini router: mapa de rutas registradas
const routes = { GET: {}, POST: {}, PUT: {}, DELETE: {} };

const router = {
  get:    (p, h) => (routes.GET[p]    = h),
  post:   (p, h) => (routes.POST[p]   = h),
  put:    (p, h) => (routes.PUT[p]    = h),
  delete: (p, h) => (routes.DELETE[p] = h),
};

for (const mod of routeModules) mod.register(router);

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const server = http.createServer(async (req, res) => {
  // CORS básico para desarrollo
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost`);
  req.params = {};
  req.query = Object.fromEntries(url.searchParams.entries());

  // ── Gate de autenticación ──────────────────────────────
  const authed = auth.isAuthed(req);
  if (url.pathname.startsWith('/api/')) {
    if (!authed && !isPublicApi(url.pathname)) {
      return json(res, 401, { error: 'No autenticado' });
    }
  } else {
    // Estáticos: sin sesión sólo se sirve lo necesario para el login.
    if (!authed && !PUBLIC_STATIC.has(url.pathname)) {
      res.writeHead(302, { Location: '/login.html' });
      return res.end();
    }
    // Ya logueado entrando al login → mandarlo al panel.
    if (authed && url.pathname === '/login.html') {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
  }

  // Health check
  if (url.pathname === '/api/health') {
    try {
      await pool.query('SELECT 1');
      return json(res, 200, { ok: true, service: 'portal-cuentas-pagar', version: '0.1.0' });
    } catch {
      return json(res, 503, { ok: false, error: 'DB no disponible' });
    }
  }

  // Rutas de API — resolución con params dinámicos (:id, :cuit, etc.)
  if (url.pathname.startsWith('/api/')) {
    const method = req.method.toUpperCase();
    const handler = resolveRoute(routes[method] || {}, url.pathname, req);

    if (handler) {
      try {
        req.body = await readBody(req);
        await handler(req, res);
      } catch (err) {
        console.error(`[server] ${method} ${url.pathname}:`, err.message);
        json(res, 500, { error: 'Error interno del servidor' });
      }
      return;
    }
    return json(res, 404, { error: 'Ruta no encontrada' });
  }

  // Archivos estáticos
  serveStatic(res, url.pathname);
});

function resolveRoute(table, pathname, req) {
  if (table[pathname]) return table[pathname];
  for (const pattern of Object.keys(table)) {
    const params = matchPattern(pattern, pathname);
    if (params) { req.params = params; return table[pattern]; }
  }
  return null;
}

function matchPattern(pattern, pathname) {
  const pp = pattern.split('/');
  const rp = pathname.split('/');
  if (pp.length !== rp.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) { params[pp[i].slice(1)] = decodeURIComponent(rp[i]); }
    else if (pp[i] !== rp[i]) return null;
  }
  return params;
}

async function readBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return {};
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(res, pathname) {
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

// Ejecutar migraciones y arrancar
async function main() {
  console.log('[server] ejecutando migraciones...');
  try {
    execSync('node src/db/migrate.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (err) {
    console.error('[server] error en migraciones:', err.message);
    process.exit(1);
  }

  server.listen(cfg.port, () => {
    console.log(`[server] Portal de Cuentas a Pagar corriendo en http://localhost:${cfg.port}`);
    console.log(`[server] Arcanum (ARCA gateway): ${cfg.arcanumUrl}`);
  });
}

main();
