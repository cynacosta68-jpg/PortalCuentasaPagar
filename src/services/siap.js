'use strict';

/*
  Generador de TXT para SIAP — Retenciones Ganancias (RG 830)
  Formato: ancho fijo, un registro por operación, codificación Latin-1

  Diseño de registro según especificación ARCA (aplicativo SIAP Ganancias):
  Pos  Largo  Tipo  Campo
  1    2      N     Código de régimen (ej: "306", "105")   → 3 chars desde pos 1
  1    3      N     Código de régimen (largo oficial: 3)
  4    10     N     CUIT del retenido (sin guiones)
  14   1      A     Tipo de operación: "A" altas
  15   15     N     N° comprobante que genera la retención (punto_venta + numero)
  30   8      N     Fecha del comprobante retenido (DDMMAAAA)
  38   15     $     Importe de la operación (base de cálculo)
  53   15     $     Importe retenido
  68   8      N     Fecha de pago / retención (DDMMAAAA)
  76   3      N     Código de condición (01 = sujetos inscriptos, 02 = no inscriptos)
  79   1      A     Tipo de comprobante de retención (siempre "6" = certificado)
  80   16     N     N° de certificado de retención
  96   \n

  Nota: Los importes van sin coma decimal, 2 decimales implícitos, lado derecho, cero a izquierda.
  Ejemplo: $1234.56 → "000000000123456"
*/

function padLeft(val, len, ch = '0') {
  return String(val || '').padStart(len, ch);
}

function padRight(val, len, ch = ' ') {
  return String(val || '').padEnd(len, ch).slice(0, len);
}

function formatImporteSIAP(valor) {
  // 15 dígitos, sin separador decimal, 2 decimales implícitos
  const cents = Math.round(parseFloat(valor || 0) * 100);
  return padLeft(cents, 15);
}

function formatFechaSIAP(fecha) {
  // Input: DATE de PG (ej: "2025-03-15" o Date) → "15032025"
  if (!fecha) return '00000000';
  const d = new Date(typeof fecha === 'string' && !fecha.includes('T') ? fecha + 'T12:00:00' : fecha);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const aaaa = d.getFullYear();
  return `${dd}${mm}${aaaa}`;
}

function limpiarCuit(cuit) {
  // Quita guiones: "20-12345678-9" → "20123456789"
  return String(cuit || '').replace(/-/g, '').padStart(11, '0').slice(0, 11);
}

function nroComprobante(puntoVenta, numero) {
  // Formato: 00001-00000001 → sin guión como entero de 15 dígitos
  const pv = padLeft(puntoVenta, 5);
  const nr = padLeft(numero, 8);
  return padLeft(`${pv}${nr}`, 15);
}

// Mapea el tipo de comprobante interno (FA/FB/FC...) al código AFIP de 2 dígitos
function tipoComprobanteAfip(tipo) {
  const map = {
    FA: '01', NDA: '02', NCA: '03', FB: '06', NDB: '07', NCB: '08',
    FC: '11', NDC: '12', NCC: '13', FM: '51', NDM: '52', NCM: '53',
  };
  return map[String(tipo || '').toUpperCase()] || '01';
}

// Fecha DD/MM/AAAA
function formatFechaDMA(fecha) {
  if (!fecha) return '';
  const d = new Date(typeof fecha === 'string' && !fecha.includes('T') ? fecha + 'T12:00:00' : fecha);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// Importe con punto decimal y 2 decimales (sin separador de miles)
function importeSICORE(valor) {
  return (Math.round(parseFloat(valor || 0) * 100) / 100).toFixed(2);
}

/**
 * Genera el TXT de SICORE v9 Release 22 — 14 campos separados por coma,
 * un registro por retención, decimales con punto.
 */
function generarTxtSIAP(registros) {
  const lineas = registros.map(r => [
    tipoComprobanteAfip(r.tipo_comprobante),          // 1  Tipo de Comprobante
    '217',                                            // 2  Código de Impuesto (Ganancias)
    padLeft(r.regimen_codigo, 3),                     // 3  Código de Régimen
    '1',                                              // 4  Código de Operación
    importeSICORE(r.base_calculo),                    // 5  Base de Cálculo
    formatFechaDMA(r.fecha_pago),                     // 6  Fecha de Retención
    '01',                                             // 7  Código de Condición (inscripto)
    'S',                                              // 8  Sujeto Pasible de Retención
    '80',                                             // 9  Tipo de Documento (CUIT)
    limpiarCuit(r.cuit),                              // 10 Número de Documento
    '0.00',                                           // 11 Porcentaje de Exclusión
    formatFechaDMA(r.fecha_pago),                     // 12 Fecha de Emisión del Certificado
    String(r.nro_cert_numerico || '0').slice(-14),    // 13 Número de Certificado
    importeSICORE(r.importe),                         // 14 Importe de la Retención
  ].join(','));

  return lineas.join('\r\n') + (lineas.length ? '\r\n' : '');
}

module.exports = { generarTxtSIAP };
