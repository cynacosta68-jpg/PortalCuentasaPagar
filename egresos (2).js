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

/**
 * Genera el contenido TXT SIAP para un período dado.
 * @param {Array} registros — filas de la query (ver descargas.js)
 * @returns {string} contenido del archivo TXT
 */
function generarTxtSIAP(registros) {
  const lineas = registros.map(r => {
    const regimen    = padLeft(r.regimen_codigo, 3);          // pos  1-3
    const cuit       = limpiarCuit(r.cuit);                   // pos  4-13  (10 chars)
    const tipoOp     = 'A';                                   // pos 14     alta
    const nroComp    = nroComprobante(r.punto_venta, r.numero); // pos 15-29
    const fechaComp  = formatFechaSIAP(r.fecha_comprobante);  // pos 30-37
    const importeOp  = formatImporteSIAP(r.base_calculo);     // pos 38-52
    const importeRet = formatImporteSIAP(r.importe);          // pos 53-67
    const fechaPago  = formatFechaSIAP(r.fecha_pago);         // pos 68-75
    const condicion  = padLeft('01', 3);                      // pos 76-78  inscriptos RI
    const tipoComp   = '6';                                   // pos 79     certificado
    const nroCert    = padLeft(r.nro_cert_numerico || 0, 16); // pos 80-95

    return `${regimen}${cuit}${tipoOp}${nroComp}${fechaComp}${importeOp}${importeRet}${fechaPago}${condicion}${tipoComp}${nroCert}`;
  });

  return lineas.join('\r\n') + (lineas.length ? '\r\n' : '');
}

module.exports = { generarTxtSIAP };
