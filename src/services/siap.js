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

// Importe con punto decimal (2 dec.), alineado a la derecha con ceros, ancho fijo
function importeFW(valor, ancho) {
  const v = (Math.round(parseFloat(valor || 0) * 100) / 100).toFixed(2);
  return v.padStart(ancho, '0').slice(-ancho);
}

// Fecha DD/MM/AAAA
function formatFechaDMA(fecha) {
  if (!fecha) return ' '.repeat(10);
  const d = new Date(typeof fecha === 'string' && !fecha.includes('T') ? fecha + 'T12:00:00' : fecha);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Genera el TXT de SICORE para retenciones de Ganancias.
 * Formato de ancho fijo de 145 caracteres por registro (diseño de registro
 * vigente del aplicativo SICORE), un registro por retención, CRLF entre líneas.
 */
function generarTxtSIAP(registros) {
  const lineas = registros.map(r => {
    const fecha   = formatFechaDMA(r.fecha_pago);                 // 2 y 9
    const cuit    = limpiarCuit(r.cuit);                          // 11 dígitos
    return [
      '05',                                  // 1  Cód. de comprobante
      fecha,                                 // 2  Fecha de retención (10)
      '0'.repeat(16),                        // 3  Nro. de comprobante (16)
      importeFW(r.base_calculo, 16),         // 4  Importe del comprobante (16)
      '0217',                                // 5  Código de impuesto (4)
      padLeft(r.regimen_codigo, 3),          // 6  Código de régimen (3)
      '1',                                   // 7  Código de operación (1)
      importeFW(r.base_calculo, 14),         // 8  Base de cálculo (14)
      fecha,                                 // 9  Fecha de emisión retención (10)
      '01',                                  // 10 Código de condición (2)
      importeFW(r.importe, 15),              // 11 Importe de la retención (15)
      '0'.repeat(6),                         // 12 Porcentaje de exclusión (6)
      ' '.repeat(10),                        // 13 Fecha emisión certificado (10, en blanco)
      '80',                                  // 14 Tipo de documento (2)
      cuit.padStart(20, ' '),                // 15 Número de documento (20)
      '0'.repeat(14),                        // 16 Número de certificado (14)
    ].join('');
  });

  return lineas.join('\r\n') + (lineas.length ? '\r\n' : '');
}

module.exports = { generarTxtSIAP };
