'use strict';

// Parsea el QR de ARCA (URL con base64) y devuelve los datos del comprobante
function parsearQrArca(qrUrl) {
  // El QR de ARCA es una URL tipo:
  // https://www.afip.gob.ar/fe/qr/?p=BASE64_JSON
  const match = qrUrl.match(/[?&]p=([A-Za-z0-9+/=]+)/);
  if (!match) throw new Error('QR inválido: no contiene parámetro p');

  const json = Buffer.from(match[1], 'base64').toString('utf8');
  const data = JSON.parse(json);

  // Estructura del JSON de ARCA:
  // { ver, fecha, cuit, ptoVta, tipoCmp, nroCmp, importe, moneda, ctz, tipoDocRec, nroDocRec, tipoCodAut, codAut }
  return {
    cuit_emisor:      String(data.cuit),
    tipo_comprobante: tipoComprobante(data.tipoCmp),
    punto_venta:      data.ptoVta,
    numero:           data.nroCmp,
    fecha_comprobante: data.fecha,          // YYYY-MM-DD
    importe_total:    parseFloat(data.importe),
    moneda:           data.moneda || 'PES',
    cotizacion:       parseFloat(data.ctz || 1),
    cod_autorizacion: data.codAut,
    raw_qr_data:      qrUrl,
  };
}

// Extrae datos de texto de un PDF de factura ARCA
// pdf-parse devuelve texto plano; las facturas ARCA tienen texto seleccionable
async function parsearPdfArca(buffer) {
  // 1) Intentar leer el QR embebido (método principal, confiable)
  try {
    const { extraerQrDePdf } = require('./qrpdf');
    const qrUrl = await extraerQrDePdf(buffer);
    if (qrUrl) {
      const datos = parsearQrArca(qrUrl);
      return {
        ...datos,
        importe_neto: 0,   // el QR no discrimina neto/IVA en B y C: los completa el usuario
        importe_iva: 0,
        origen_lectura: 'qr',
        confianza: 95,
      };
    }
  } catch (e) {
    // si falla la extracción de QR, seguimos con el parser de texto
    console.warn('[comprobante] QR no disponible, uso parser de texto:', e.message);
  }

  // 2) Fallback: extraer texto y parsear con expresiones regulares
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  const texto = data.text;

  // Buscar CUIT del emisor
  const cuitMatch = texto.match(/C\.U\.I\.T\.?[\s:]+(\d{2}-?\d{8}-?\d)/i)
    || texto.match(/CUIT[\s:]+(\d{2}-?\d{8}-?\d)/i);
  const cuit_emisor = cuitMatch ? cuitMatch[1].replace(/-/g, '') : null;

  // Tipo y número de comprobante
  const tipoMatch = texto.match(/FACTURA\s+([A-E])/i)
    || texto.match(/NOTA DE CRÉDITO\s+([A-E])/i)
    || texto.match(/NOTA DE DÉBITO\s+([A-E])/i);
  const tipo_letra = tipoMatch ? tipoMatch[1].toUpperCase() : null;
  const esFcred = /FACTURA DE CRÉDITO/i.test(texto);
  const esNc = /NOTA DE CR[EÉ]DITO/i.test(texto);
  const esNd = /NOTA DE D[EÉ]BITO/i.test(texto);

  let tipo_comprobante = null;
  if (tipo_letra) {
    if (esNc) tipo_comprobante = 'NC' + tipo_letra;
    else if (esNd) tipo_comprobante = 'ND' + tipo_letra;
    else tipo_comprobante = 'F' + tipo_letra;
  }

  // Punto de venta y número
  const nroMatch = texto.match(/(\d{4,5})\s*[-–]\s*(\d{7,8})/);
  const punto_venta = nroMatch ? parseInt(nroMatch[1]) : null;
  const numero = nroMatch ? parseInt(nroMatch[2]) : null;

  // Fecha
  const fechaMatch = texto.match(/Fecha de Emisi[oó]n[\s:]+(\d{2}\/\d{2}\/\d{4})/i)
    || texto.match(/(\d{2}\/\d{2}\/\d{4})/);
  const fecha_comprobante = fechaMatch
    ? fechaMatch[1].split('/').reverse().join('-')  // DD/MM/YYYY → YYYY-MM-DD
    : null;

  // Importes
  const totalMatch = texto.match(/(?:Importe Total|Total a Pagar|Total)[\s:$]+([0-9.,]+)/i);
  const importe_total = totalMatch
    ? parseFloat(totalMatch[1].replace(/\./g, '').replace(',', '.'))
    : null;

  const netoMatch = texto.match(/(?:Neto Gravado|Subtotal Neto)[\s:$]+([0-9.,]+)/i);
  const importe_neto = netoMatch
    ? parseFloat(netoMatch[1].replace(/\./g, '').replace(',', '.'))
    : null;

  const ivaMatch = texto.match(/(?:I\.V\.A\.|IVA)\s+(?:21%|10,5%|27%)?[\s:$]+([0-9.,]+)/i);
  const importe_iva = ivaMatch
    ? parseFloat(ivaMatch[1].replace(/\./g, '').replace(',', '.'))
    : null;

  return {
    cuit_emisor,
    tipo_comprobante,
    punto_venta,
    numero,
    fecha_comprobante,
    importe_total,
    importe_neto: importe_neto || 0,
    importe_iva: importe_iva || 0,
    raw_pdf_text: texto.slice(0, 3000), // guardar primeros 3000 chars para auditoría
    confianza: calcularConfianza({ cuit_emisor, tipo_comprobante, numero, fecha_comprobante, importe_total }),
  };
}

function calcularConfianza(campos) {
  const completos = Object.values(campos).filter(v => v != null).length;
  return Math.round((completos / Object.keys(campos).length) * 100);
}

function tipoComprobante(codigo) {
  const tipos = {
    1: 'FA', 2: 'NDA', 3: 'NCA',
    6: 'FB', 7: 'NDB', 8: 'NCB',
    11: 'FC', 12: 'NDC', 13: 'NCC',
    51: 'FM', 52: 'NDM', 53: 'NCM',
    201: 'FCA', 206: 'FCB', 211: 'FCC',
  };
  return tipos[codigo] || String(codigo);
}

module.exports = { parsearQrArca, parsearPdfArca };
