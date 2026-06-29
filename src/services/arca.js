'use strict';
const cfg = require('../config');

async function arcanumGet(path) {
  if (!cfg.arcanumUrl || !cfg.arcanumApiKey) {
    throw new Error('ARCANUM_URL y ARCANUM_API_KEY son requeridos');
  }
  const res = await fetch(`${cfg.arcanumUrl}${path}`, {
    headers: { 'X-API-Key': cfg.arcanumApiKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    throw Object.assign(new Error(`Arcanum ${res.status}: ${texto}`), { status: res.status });
  }
  return res.json();
}

// Trae datos del contribuyente desde el Padrón A5 de ARCA
async function getDatosProveedor(cuit) {
  const data = await arcanumGet(`/api/padron/a5/${cuit}`);
  // Normalizar respuesta de Arcanum al formato que usa el portal
  const p = data?.persona || data;
  return {
    razon_social:        p.razonSocial || p.apellidoNombre || '',
    actividad:           extraerActividad(p),
    condicion_fiscal:    extraerCondicionFiscal(p),
    categoria_monotributo: extraerCategoriaMonotributo(p),
    domicilio_fiscal:    extraerDomicilio(p),
    raw: data,
  };
}

function extraerActividad(p) {
  if (p.actividades?.actividad?.length > 0) {
    const act = p.actividades.actividad.find(a => a.orden === 1) || p.actividades.actividad[0];
    return act?.descripcionActividad || '';
  }
  return p.actividadPrincipal || '';
}

function extraerCondicionFiscal(p) {
  const cat = p.categoriasMonotributo?.categoriaMonotributo;
  if (cat) return 'Monotributista';
  if (p.impuestos?.impuesto) {
    const iva = p.impuestos.impuesto.find(i => i.idImpuesto === 32 || i.idImpuesto === '32');
    if (iva?.descripcionEstado === 'ACTIVO') return 'Responsable Inscripto';
  }
  return p.tipoPersona === 'JURIDICA' ? 'Responsable Inscripto' : 'Consumidor Final';
}

function extraerCategoriaMonotributo(p) {
  const cats = p.categoriasMonotributo?.categoriaMonotributo;
  if (!cats) return null;
  const arr = Array.isArray(cats) ? cats : [cats];
  const activa = arr.find(c => c.estado === 'ACTIVO') || arr[0];
  return activa?.categoria || null;
}

function extraerDomicilio(p) {
  const d = p.domicilioFiscal;
  if (!d) return '';
  return [d.direccion, d.localidad, d.descripcionProvincia, d.codPostal]
    .filter(Boolean).join(', ');
}

module.exports = { getDatosProveedor };
