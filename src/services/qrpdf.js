'use strict';

// Extrae la URL del QR de ARCA embebido en un PDF de factura.
// Rasteriza cada página (a escalas crecientes) y decodifica el QR con jsQR.
// Devuelve la URL (string) o null si no encuentra QR.
//
// Usa librerías con binarios precompilados (sin dependencias del sistema):
//   pdfjs-dist (render), @napi-rs/canvas (canvas), jsqr (decodificación).
// Si alguna no carga en el entorno, la función devuelve null y el flujo
// cae al parser de texto, sin romper.

let napi, jsQR, pdfjsPromise;

function cargarLibs() {
  if (!napi) {
    napi = require('@napi-rs/canvas');
    jsQR = require('jsqr');
    // pdfjs (legacy) espera estos globals
    globalThis.Path2D = globalThis.Path2D || napi.Path2D;
    globalThis.DOMMatrix = globalThis.DOMMatrix || napi.DOMMatrix;
    globalThis.ImageData = globalThis.ImageData || napi.ImageData;
  }
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsPromise;
}

class NodeCanvasFactory {
  create(w, h) { const canvas = napi.createCanvas(w, h); return { canvas, context: canvas.getContext('2d') }; }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; }
}

const ESCALAS = [3, 4, 6];

async function extraerQrDePdf(buffer) {
  let pdfjs;
  try {
    pdfjs = await cargarLibs();
  } catch (e) {
    console.warn('[qrpdf] librerías de QR no disponibles, se usará el parser de texto:', e.message);
    return null;
  }

  try {
    const data = new Uint8Array(buffer);
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true, canvasFactory: new NodeCanvasFactory() }).promise;
    // El QR de ARCA está en la página 1; escaneamos solo esa (rápido, sin timeouts).
    const page = await doc.getPage(1);
    for (const scale of ESCALAS) {
      const vp = page.getViewport({ scale });
      const canvas = napi.createCanvas(vp.width, vp.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
      if (code && /\/fe\/qr\//.test(code.data)) {
        await doc.destroy().catch(() => {});
        return code.data;
      }
    }
    await doc.destroy().catch(() => {});
    return null;
  } catch (e) {
    console.warn('[qrpdf] no se pudo extraer QR del PDF:', e.message);
    return null;
  }
}

module.exports = { extraerQrDePdf };
