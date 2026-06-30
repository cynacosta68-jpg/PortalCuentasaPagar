'use strict';
const pool = require('../db/pool');
const { parsearQrArca, parsearPdfArca } = require('../services/comprobante');

// Maneja multipart/form-data sin dependencias externas (Node 20+)
async function leerMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parsearMultipart(buffer, boundary) {
  const sep = Buffer.from('--' + boundary);
  const partes = [];
  let start = 0;

  while (start < buffer.length) {
    const sepIdx = buffer.indexOf(sep, start);
    if (sepIdx === -1) break;
    const headerStart = sepIdx + sep.length + 2; // saltar \r\n
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), headerStart);
    if (headerEnd === -1) break;

    const headerStr = buffer.slice(headerStart, headerEnd).toString();
    const contentEnd = buffer.indexOf(sep, headerEnd + 4) - 2; // -2 para \r\n antes del sep

    if (contentEnd > headerEnd + 4) {
      const content = buffer.slice(headerEnd + 4, contentEnd);
      const nameMatch = headerStr.match(/name="([^"]+)"/);
      const filenameMatch = headerStr.match(/filename="([^"]+)"/);
      const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

      partes.push({
        name: nameMatch ? nameMatch[1] : null,
        filename: filenameMatch ? filenameMatch[1] : null,
        contentType: typeMatch ? typeMatch[1].trim() : 'text/plain',
        data: content,
      });
    }
    start = sepIdx + sep.length;
  }
  return partes;
}

function register(router) {
  router.post('/api/comprobantes/parse-qr', parseQr);
  router.post('/api/comprobantes/parse-pdf', parsePdf);
  router.get('/api/comprobantes/qr-status', qrStatus);
}

// Diagnóstico: indica si las librerías de lectura de QR están disponibles
// en este servidor (binario @napi-rs/canvas instalado).
async function qrStatus(req, res) {
  const estado = { canvas: false, pdfjs: false, jsqr: false };
  let motivo = null;
  try { require('@napi-rs/canvas'); estado.canvas = true; } catch (e) { motivo = e.message; }
  try { require('jsqr'); estado.jsqr = true; } catch (e) { motivo = motivo || e.message; }
  try { await import('pdfjs-dist/legacy/build/pdf.mjs'); estado.pdfjs = true; } catch (e) { motivo = motivo || e.message; }
  const disponible = estado.canvas && estado.pdfjs && estado.jsqr;
  res.json({ disponible, estado, motivo, lectura: disponible ? 'QR habilitado' : 'solo texto (QR no disponible)' });
}

// Recibe { qr_url } y devuelve los datos del comprobante
async function parseQr(req, res) {
  const { qr_url, qr_texto } = req.body;
  const input = qr_url || qr_texto;
  if (!input) return res.status(400).json({ error: 'Se requiere qr_url o qr_texto' });

  try {
    const datos = parsearQrArca(input);

    // Buscar proveedor por CUIT del emisor
    const { rows: [proveedor] } = await pool.query(
      'SELECT id, razon_social FROM proveedores WHERE cuit = $1 AND activo = true',
      [datos.cuit_emisor]
    );

    res.json({ ...datos, proveedor });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo leer el QR: ' + err.message });
  }
}

// Recibe un PDF como multipart/form-data y devuelve los datos extraídos
async function parsePdf(req, res) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  if (!boundaryMatch) return res.status(400).json({ error: 'Content-Type debe ser multipart/form-data' });

  try {
    const rawBody = await leerMultipart(req);
    const partes = parsearMultipart(rawBody, boundaryMatch[1]);
    const archivo = partes.find(p => p.filename && p.contentType.includes('pdf'));

    if (!archivo) return res.status(400).json({ error: 'No se encontró un archivo PDF en la solicitud' });
    if (archivo.data.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'El PDF no puede superar 10 MB' });
    }

    const datos = await parsearPdfArca(archivo.data);

    // Buscar proveedor por CUIT del emisor
    let proveedor = null;
    if (datos.cuit_emisor) {
      const { rows: [p] } = await pool.query(
        'SELECT id, razon_social FROM proveedores WHERE cuit = $1 AND activo = true',
        [datos.cuit_emisor]
      );
      proveedor = p || null;
    }

    res.json({ ...datos, proveedor, archivo: archivo.filename });
  } catch (err) {
    console.error('[comprobantes] error parseando PDF:', err.message);
    res.status(500).json({ error: 'Error al procesar el PDF: ' + err.message });
  }
}

module.exports = { register };
