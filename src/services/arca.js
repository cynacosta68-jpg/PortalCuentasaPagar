'use strict';
const cfg = require('../config');

async function arcanumGet(path) {
  if (!cfg.arcanumUrl || !cfg.arcanumApiKey) {
    throw new Error('ARCANUM_URL y ARCANUM_API_KEY son requeridos');
  }
  const base = cfg.arcanumUrl.replace(/\/+$/, ''); // sin barra final
  const res = await fetch(`${base}${path}`, {
    headers: { 'X-API-Key': cfg.arcanumApiKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw Object.assign(new Error(`Arcanum ${res.status}: ${texto}`), { status: res.status });
  }
  return res.json();
}

function arr(x) { return Array.isArray(x) ? x : (x ? [x] : []); }

// Busca recursivamente la primera key con ese nombre (fallback defensivo)
function deepFind(obj, key, depth = 6) {
  if (!obj || typeof obj !== 'object' || depth < 0) return undefined;
  if (obj[key] != null) return obj[key];
  for (const v of Object.values(obj)) {
    const r = deepFind(v, key, depth - 1);
    if (r != null) return r;
  }
  return undefined;
}

// Trae datos del contribuyente desde la Constancia (a5) de ARCA, vía gateway.
async function getDatosProveedor(cuit) {
  const rep = cfg.arcanumCuit;
  if (!rep) {
    throw new Error('Falta ARCANUM_CUIT (CUIT del certificado cargado en Arcanum) para consultar el padrón');
  }
  const data = await arcanumGet(`/api/padron/a5/${cuit}?cuit=${rep}`);

  // El gateway envuelve la respuesta: { ok, alcance, cuit, datos }
  const root = data?.datos || data?.persona || data || {};
  const g = root.datosGenerales || root;

  // Log liviano para diagnóstico de mapeo (sin volcar PII completa)
  try {
    console.log('[arca] datos keys:', Object.keys(root), '| generales:', Object.keys(g || {}));
  } catch { /* noop */ }

  return {
    razon_social:          extraerRazonSocial(g),
    actividad:             extraerActividad(root),
    condicion_fiscal:      extraerCondicionFiscal(root),
    categoria_monotributo: extraerCategoriaMonotributo(root),
    domicilio_fiscal:      extraerDomicilio(g),
    raw: data,
  };
}

function extraerRazonSocial(g) {
  if (g?.razonSocial) return g.razonSocial;
  const ap = g?.apellido, no = g?.nombre;
  if (ap || no) return [ap, no].filter(Boolean).join(', ');
  // fallback defensivo por si cambia el anidado
  return deepFind(g, 'razonSocial') ||
    [deepFind(g, 'apellido'), deepFind(g, 'nombre')].filter(Boolean).join(', ') || '';
}

function extraerActividad(root) {
  const rg = root?.datosRegimenGeneral || root?.datosMonotributo;
  const acts = arr(rg?.actividad);
  if (acts.length) {
    const a = acts.find(x => String(x.orden) === '1') || acts[0];
    return a?.descripcionActividad || '';
  }
  return '';
}

function extraerCondicionFiscal(root) {
  if (root?.datosMonotributo) return 'Monotributista';
  const rg = root?.datosRegimenGeneral;
  if (rg) {
    const imps = arr(rg.impuesto);
    const tieneIva = imps.some(i => /IVA/i.test(i?.descripcionImpuesto || ''));
    return tieneIva ? 'IVA Responsable Inscripto' : 'IVA Exento';
  }
  return ''; // sin datos suficientes: que el usuario complete a mano
}

function extraerCategoriaMonotributo(root) {
  const dm = root?.datosMonotributo;
  if (!dm) return null;
  let cat = dm.categoriaMonotributo || dm.descripcionCategoria || deepFind(dm, 'categoriaMonotributo');
  if (cat && typeof cat === 'object') {
    cat = cat.idCategoria || cat.categoria || cat.descripcionCategoria || null;
  }
  if (!cat) return null;
  // La categoría es una letra (A–K). El padrón suele devolver "E LOCACIONES DE
  // SERVICIOS": nos quedamos con el código y lo acotamos a la columna (VARCHAR 10).
  const code = String(cat).trim().split(/[\s-]+/)[0];
  return code.slice(0, 10);
}

function extraerDomicilio(g) {
  const d = g?.domicilioFiscal || (g && deepFind(g, 'domicilioFiscal'));
  if (!d) return '';
  const dom = Array.isArray(d) ? d[0] : d;
  return [dom.direccion, dom.localidad, dom.descripcionProvincia, dom.codPostal]
    .filter(Boolean).join(', ');
}

module.exports = { getDatosProveedor };
