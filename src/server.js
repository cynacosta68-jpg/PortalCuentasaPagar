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
  require('./routes/usuarios'),
  require('./routes/auditoria'),
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

  // Compatibilidad: los handlers están escritos estilo Express (res.status().json()),
  // pero esto es http nativo. Le agregamos esos métodos al response.
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => {
    if (!res.headersSent) {
      res.writeHead(res.statusCode || 200, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify(body));
    return res;
  };
  // Envía HTML/texto plano (usado, por ej., por el link de autorización de gerencia)
  res.send = (body) => {
    if (!res.headersSent) {
      res.writeHead(res.statusCode || 200, { 'Content-Type': 'text/html; charset=utf-8' });
    }
    res.end(typeof body === 'string' ? body : String(body));
    return res;
  };

  const url = new URL(req.url, `http://localhost`);
  req.params = {};
  req.query = Object.fromEntries(url.searchParams.entries());

  // ── Gate de autenticación ──────────────────────────────
  const usuario = auth.getUsuario(req); // { usuario, rol } | null
  const authed = !!usuario;
  req.usuario = usuario;
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
      // Control de acceso por rol (salvo endpoints públicos o de auth)
      if (authed && !isPublicApi(url.pathname) && !url.pathname.startsWith('/api/auth/')) {
        const cap = capacidadRequerida(method, url.pathname);
        if (cap && !auth.puede(req.usuario.rol, cap)) {
          return json(res, 403, { error: 'No tenés permisos para esta acción' });
        }
      }
      try {
        req.body = await readBody(req);
        await handler(req, res);
        // Auditoría de mutaciones exitosas
        if (authed && ['POST', 'PUT', 'DELETE'].includes(method) &&
            !url.pathname.startsWith('/api/auth/') && (res.statusCode || 200) < 400) {
          registrarAuditoria(req, method, url.pathname).catch(e => console.error('[auditoria]', e.message));
        }
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
  // Para subidas de archivo (multipart) NO consumimos el stream: lo lee el handler.
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) return {};
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

// Capacidad requerida según método y ruta (para el control por rol)
function capacidadRequerida(method, pathname) {
  if (pathname.startsWith('/api/usuarios'))  return 'usuarios';
  if (pathname.startsWith('/api/auditoria')) return 'auditoria';
  if (method === 'GET') return 'ver';
  if (/\/autorizar(\b|$)/.test(pathname)) return 'autorizar';
  if (/\/ejecutar(\b|$)/.test(pathname))  return 'ejecutar';
  if (pathname.startsWith('/api/corridas') || pathname.startsWith('/api/pagos')) return 'corridas';
  return 'cargar'; // egresos, proveedores, comprobantes, consultas
}

// Deriva acción y entidad desde la ruta, para el registro de auditoría
function parseAccionEntidad(method, pathname) {
  const segs = pathname.split('/').filter(Boolean); // ['api','egresos','5','ejecutar']
  const entidad = (segs[1] || '').replace(/s$/, '');
  let entidad_id = null, accion = null;
  if (segs[2] && /^\d+$/.test(segs[2])) entidad_id = segs[2];
  const verbo = segs[3] || (segs[2] && !/^\d+$/.test(segs[2]) ? segs[2] : null);
  if (verbo) accion = verbo.replace(/-/g, '_');
  else if (method === 'POST') accion = 'crear';
  else if (method === 'PUT') accion = 'editar';
  else if (method === 'DELETE') accion = 'eliminar';
  return { entidad, entidad_id, accion };
}

async function registrarAuditoria(req, method, pathname) {
  const { entidad, entidad_id, accion } = parseAccionEntidad(method, pathname);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  let detalle = null;
  if (req.body && typeof req.body === 'object') {
    const limpio = { ...req.body };
    for (const k of ['password', 'nueva', 'actual', 'password_hash']) delete limpio[k];
    const s = JSON.stringify(limpio);
    if (s && s !== '{}') detalle = s.length > 500 ? s.slice(0, 500) : s;
  }
  await pool.query(
    `INSERT INTO auditoria (usuario, rol, accion, entidad, entidad_id, detalle, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.usuario.usuario, req.usuario.rol, accion, entidad, entidad_id, detalle, ip || null]
  );
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
    // Diagnóstico del lector de QR (librerías opcionales con binario)
    try {
      require('@napi-rs/canvas');
      require('jsqr');
      console.log('[server] Lector de QR de facturas: HABILITADO ✓');
    } catch (e) {
      console.log('[server] Lector de QR de facturas: DESHABILITADO (se usará parser de texto). Motivo:', e.message);
    }
  });
}

main();
