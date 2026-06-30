'use strict';
const PDFDocument = require('pdfkit');

// ── Helpers de formato ───────────────────────────────────────

function formatImporte(n) {
  return '$ ' + parseFloat(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function formatFecha(d) {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : new Date(d).toISOString();
  const dt = new Date(s + (s.includes('T') ? '' : 'T12:00:00'));
  return dt.toLocaleDateString('es-AR');
}

function formatCuit(c) {
  c = String(c || '').replace(/\D/g, '');
  if (c.length !== 11) return c || '';
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}

// Importe a letras (es-AR). Soporta hasta miles de millones + centavos.
function importeEnLetras(n) {
  n = Math.round(parseFloat(n || 0) * 100) / 100;
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  const letras = numeroALetras(entero);
  const txt = `${letras} con ${String(centavos).padStart(2, '0')}/100`;
  return 'Son pesos: ' + txt.charAt(0).toUpperCase() + txt.slice(1) + '.';
}

function numeroALetras(num) {
  if (num === 0) return 'cero';
  const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
    'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

  function hasta999(x) {
    if (x === 100) return 'cien';
    let r = '';
    const c = Math.floor(x / 100); x %= 100;
    if (c) r += C[c] + ' ';
    if (x < 30) r += U[x];
    else { const d = Math.floor(x / 10), u = x % 10; r += D[d] + (u ? ' y ' + U[u] : ''); }
    return r.trim();
  }

  let r = '';
  const millones = Math.floor(num / 1e6); num %= 1e6;
  const miles = Math.floor(num / 1e3); num %= 1e3;
  if (millones) r += (millones === 1 ? 'un millón' : hasta999(millones) + ' millones') + ' ';
  if (miles) r += (miles === 1 ? 'mil' : hasta999(miles) + ' mil') + ' ';
  if (num) r += hasta999(num);
  return r.trim().replace(/\s+/g, ' ');
}

// Etiquetas de impuesto/régimen por tipo de retención
function etiquetaRetencion(cert) {
  switch (cert.tipo_retencion) {
    case 'ganancias':
      return { impuesto: 'Impuesto a las Ganancias',
               regimen: `Régimen ${cert.regimen_codigo || '—'} (RG 830 ARCA)`, corto: 'Ganancias' };
    case 'iva':
      return { impuesto: 'Impuesto al Valor Agregado',
               regimen: `RG 2854 ARCA — alícuota ${cert.alicuota}%`, corto: 'IVA' };
    case 'iibb':
      return { impuesto: `Ingresos Brutos${cert.regimen_codigo ? ' — ' + cert.regimen_codigo : ''}`,
               regimen: `Régimen provincial — alícuota ${cert.alicuota}%`, corto: 'IIBB' };
    case 'suss':
      return { impuesto: 'Sistema Único de Seguridad Social (SUSS)',
               regimen: `${cert.regimen_codigo || 'RG 1784'} — alícuota ${cert.alicuota}%`, corto: 'SUSS' };
    default:
      return { impuesto: cert.tipo_retencion, regimen: `Alícuota ${cert.alicuota}%`, corto: cert.tipo_retencion };
  }
}

async function generarPDFBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try { buildFn(doc); doc.end(); } catch (err) { reject(err); }
  });
}

const GRIS = '#888880', LINEA = '#cccccc', SUAVE = '#eeeeee';

// ── Orden de Pago ────────────────────────────────────────────
/**
 * @param {object} datos
 * @param {object} datos.orden     — registro de ordenes_pago
 * @param {object} datos.proveedor — datos del proveedor (incluye banco/cbu si están)
 * @param {object} datos.empresa   — { razon_social, cuit, domicilio }
 * @param {Array}  datos.egresos   — comprobantes incluidos
 * @param {Array}  datos.certs     — certificados de retención vinculados
 */
async function generarOrdenPago(datos) {
  const { orden, proveedor, empresa, egresos, certs } = datos;
  const L = 50, R = 545, W = R - L;

  return generarPDFBuffer(doc => {
    // Encabezado: emisor (izq) / título y número (der)
    const yTop = doc.y;
    doc.fontSize(13).font('Helvetica-Bold').text(empresa.razon_social || '', L, yTop, { width: 300 });
    doc.fontSize(9).font('Helvetica').fillColor(GRIS)
      .text(`CUIT ${formatCuit(empresa.cuit)} · IVA Responsable Inscripto`, L, doc.y, { width: 300 });
    if (empresa.domicilio) doc.text(empresa.domicilio, L, doc.y, { width: 300 });
    doc.fillColor('black');

    doc.fontSize(15).font('Helvetica-Bold').text('ORDEN DE PAGO', 320, yTop, { width: W - 270, align: 'right' });
    doc.fontSize(9).font('Helvetica')
      .text(`N° ${orden.numero_orden}`, 320, doc.y, { width: W - 270, align: 'right' })
      .text(`Fecha de pago: ${formatFecha(orden.fecha_pago)}`, 320, doc.y, { width: W - 270, align: 'right' });
    if (orden.corrida_codigo)
      doc.fillColor(GRIS).text(`Corrida ${orden.corrida_codigo}`, 320, doc.y, { width: W - 270, align: 'right' }).fillColor('black');

    let y = Math.max(doc.y, yTop + 56) + 8;
    hr(doc, L, R, y); y += 12;

    // Proveedor (izq) / Medio de pago (der)
    const yBloque = y;
    label(doc, 'PROVEEDOR', L, y);
    doc.fontSize(10).font('Helvetica-Bold').text(proveedor.razon_social || '', L, y + 12, { width: 250 });
    doc.fontSize(9).font('Helvetica')
      .text(`CUIT ${formatCuit(proveedor.cuit)}${proveedor.condicion_fiscal ? ' · ' + proveedor.condicion_fiscal : ''}`, L, doc.y, { width: 250 });
    if (proveedor.domicilio_fiscal) doc.text(proveedor.domicilio_fiscal, L, doc.y, { width: 250 });
    if (proveedor.mail) doc.fillColor(GRIS).text(proveedor.mail, L, doc.y, { width: 250 }).fillColor('black');
    const yIzq = doc.y;

    label(doc, 'MEDIO DE PAGO', 320, yBloque);
    doc.fontSize(10).font('Helvetica-Bold').text(orden.medio_pago || 'Transferencia', 320, yBloque + 12, { width: 225 });
    doc.fontSize(9).font('Helvetica');
    if (proveedor.banco) doc.text(proveedor.banco, 320, doc.y, { width: 225 });
    if (proveedor.cbu) doc.text(`CBU ${proveedor.cbu}`, 320, doc.y, { width: 225 });

    y = Math.max(yIzq, doc.y) + 10;
    hr(doc, L, R, y); y += 10;

    // Tabla de comprobantes
    label(doc, 'COMPROBANTES CANCELADOS', L, y); y += 14;
    const col = { comp: L, fecha: 250, cat: 340, imp: R - 110 };
    doc.fontSize(8).font('Helvetica-Bold').fillColor(GRIS);
    doc.text('Comprobante', col.comp, y); doc.text('Fecha', col.fecha, y);
    doc.text('Categoría', col.cat, y); doc.text('Importe', col.imp, y, { width: 110, align: 'right' });
    doc.fillColor('black'); y += 12; hr(doc, L, R, y, SUAVE); y += 4;

    doc.fontSize(8).font('Helvetica');
    for (const e of (egresos || [])) {
      const nro = `${e.tipo_comprobante} ${String(e.punto_venta).padStart(4, '0')}-${String(e.numero).padStart(8, '0')}`;
      doc.text(nro, col.comp, y, { width: 195 });
      doc.text(formatFecha(e.fecha_comprobante), col.fecha, y);
      doc.text(e.categoria_egreso || '—', col.cat, y, { width: 90 });
      doc.text(formatImporte(e.importe_total), col.imp, y, { width: 110, align: 'right' });
      y += 14;
    }
    y += 4; hr(doc, L, R, y); y += 12;

    // Totales (derecha)
    const xLbl = 320, xVal = R - 130;
    const linea = (lbl, val, opts = {}) => {
      doc.fontSize(opts.big ? 11 : 9).font(opts.bold ? 'Helvetica-Bold' : 'Helvetica');
      if (opts.color) doc.fillColor(opts.color);
      doc.text(lbl, xLbl, y, { width: 150 });
      doc.text(val, xVal, y, { width: 130, align: 'right' });
      doc.fillColor('black');
      y += opts.big ? 18 : 14;
    };
    linea('Subtotal bruto', formatImporte(orden.importe_bruto));
    if (parseFloat(orden.ret_ganancias) > 0) linea('Ret. Ganancias (RG830)', '- ' + formatImporte(orden.ret_ganancias));
    if (parseFloat(orden.ret_iva) > 0)       linea('Ret. IVA',               '- ' + formatImporte(orden.ret_iva));
    if (parseFloat(orden.ret_iibb) > 0)      linea('Ret. Ingresos Brutos',   '- ' + formatImporte(orden.ret_iibb));
    if (parseFloat(orden.ret_suss) > 0)      linea('Ret. SUSS',              '- ' + formatImporte(orden.ret_suss));
    y += 2; hr(doc, xLbl, R, y); y += 6;
    linea('NETO A PAGAR', formatImporte(orden.importe_neto), { bold: true, big: true });

    y += 6;
    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#555550')
      .text(importeEnLetras(orden.importe_neto), L, y, { width: W });
    doc.fillColor('black'); y = doc.y + 30;

    // Pie de firmas
    const w3 = (W - 40) / 3;
    [['Confeccionó', L], ['Revisó', L + w3 + 20], ['Autorizó (gerencia)', L + 2 * w3 + 40]].forEach(([t, x]) => {
      hr(doc, x, x + w3, y, '#999990');
      doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(t, x, y + 4, { width: w3, align: 'center' });
    });
    doc.fillColor('black');
  });
}

// ── Certificado de Retención (formato SICORE) ────────────────
/**
 * @param {object} datos
 * @param {object} datos.cert      — registro certificados_retencion
 * @param {object} datos.orden     — orden_pago vinculada
 * @param {object} datos.proveedor — sujeto retenido
 * @param {object} datos.empresa   — agente de retención (quien paga)
 */
async function generarCertificadoRetencion(datos) {
  const { cert, orden, proveedor, empresa } = datos;
  const L = 50, R = 545, W = R - L;
  const et = etiquetaRetencion(cert);

  return generarPDFBuffer(doc => {
    // Marco superior
    doc.fontSize(14).font('Helvetica-Bold').text('SI.CO.RE. — Sistema de Control de Retenciones', L, doc.y, { width: W, align: 'left' });
    doc.fontSize(9).font('Helvetica').fillColor(GRIS)
      .text(`Certificado N° ${cert.numero_cert}`, L, doc.y, { width: W })
      .text(`Fecha: ${formatFecha(orden.fecha_pago)}`, L, doc.y, { width: W });
    doc.fillColor('black');
    let y = doc.y + 8; hr(doc, L, R, y); y += 12;

    // A — Agente de retención
    seccion(doc, 'A — Datos del Agente de Retención', L, y); y = doc.y + 4;
    y = kv(doc, 'Apellido y Nombre o Denominación', empresa.razon_social || '', L, y);
    y = kv(doc, 'C.U.I.T.', formatCuit(empresa.cuit), L, y);
    y = kv(doc, 'Domicilio', empresa.domicilio || '', L, y);
    y += 8;

    // B — Sujeto retenido
    seccion(doc, 'B — Datos del Sujeto Retenido', L, y); y = doc.y + 4;
    y = kv(doc, 'Apellido y Nombre o Denominación', proveedor.razon_social || '', L, y);
    y = kv(doc, 'C.U.I.T.', formatCuit(proveedor.cuit), L, y);
    y = kv(doc, 'Domicilio', proveedor.domicilio_fiscal || '', L, y);
    y += 8;

    // C — Datos de la retención
    seccion(doc, 'C — Datos de la Retención Practicada', L, y); y = doc.y + 4;
    y = kv(doc, 'Impuesto', et.impuesto, L, y);
    y = kv(doc, 'Régimen', et.regimen, L, y);
    y = kv(doc, 'Comprobante que origina la Retención', `Orden de Pago N° ${orden.numero_orden}`, L, y);
    y = kv(doc, 'Período fiscal', formatPeriodo(cert.periodo_fiscal), L, y);
    y = kv(doc, 'Monto base de la Retención', formatImporte(cert.base_calculo), L, y);
    y = kv(doc, 'Alícuota aplicada', `${cert.alicuota}%`, L, y);
    y = kv(doc, 'Monto de la Retención', formatImporte(cert.importe), L, y, { bold: true });
    y = kv(doc, 'Imposibilidad de Retención', 'NO', L, y);
    y += 24;

    // Firma
    hr(doc, L, L + 220, y, '#999990');
    doc.fontSize(8).font('Helvetica').fillColor(GRIS)
      .text('Firma del Agente de Retención', L, y + 4, { width: 220 });
    y = doc.y + 14;
    doc.fontSize(7).font('Helvetica-Oblique').fillColor('#777770').text(
      'Declaro que los datos consignados en este formulario son correctos y completos, ' +
      'siendo fiel expresión de la verdad.', L, y, { width: W });
    doc.fillColor('black');
  });
}

// ── primitivas de dibujo ─────────────────────────────────────
function hr(doc, x1, x2, y, color = LINEA) {
  doc.moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(0.5).stroke();
}
function label(doc, txt, x, y) {
  doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS).text(txt.toUpperCase(), x, y);
  doc.fillColor('black');
}
function seccion(doc, txt, x, y) {
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#1a1a18').text(txt, x, y);
  doc.fillColor('black');
}
function kv(doc, k, v, x, y, opts = {}) {
  doc.fontSize(9).font('Helvetica').fillColor(GRIS).text(k + ':', x + 8, y, { width: 200 });
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('black').text(v, x + 215, y, { width: 280 });
  doc.fillColor('black');
  return Math.max(doc.y, y + 14);
}
function formatPeriodo(p) {
  if (!p || p.length !== 6) return p || '';
  return `${p.slice(4)}/${p.slice(0, 4)}`;
}

// ── Listado de comprobantes de una corrida (adjunto del mail de aprobación) ──
async function generarListadoCorrida(datos) {
  const { corrida, items = [], empresa = {} } = datos;
  const L = 50, R = 545, W = R - L;

  return generarPDFBuffer(doc => {
    const yTop = doc.y;
    doc.fontSize(13).font('Helvetica-Bold').text(empresa.razon_social || 'Cuentas a Pagar', L, yTop, { width: 320 });
    if (empresa.cuit) doc.fontSize(9).font('Helvetica').fillColor(GRIS)
      .text(`CUIT ${formatCuit(empresa.cuit)}`, L, doc.y, { width: 320 }).fillColor('black');

    doc.fontSize(14).font('Helvetica-Bold').text('SOLICITUD DE APROBACIÓN', 300, yTop, { width: W - 250, align: 'right' });
    doc.fontSize(9).font('Helvetica')
      .text(`Corrida ${corrida.codigo_ref}`, 300, doc.y, { width: W - 250, align: 'right' })
      .text(`Fecha de pago: ${formatFecha(corrida.fecha_pago)}`, 300, doc.y, { width: W - 250, align: 'right' })
      .text(`Medio: ${corrida.medio_pago || 'Transferencia'}`, 300, doc.y, { width: W - 250, align: 'right' });

    let y = Math.max(doc.y, yTop + 56) + 10;
    hr(doc, L, R, y); y += 14;

    seccion(doc, 'Comprobantes incluidos', L, y); y += 16;

    // Encabezado de tabla
    const cols = { prov: L, comp: L + 150, fecha: L + 270, conc: L + 350, imp: R };
    doc.fontSize(8).font('Helvetica-Bold').fillColor(GRIS);
    doc.text('PROVEEDOR', cols.prov, y);
    doc.text('COMPROBANTE', cols.comp, y);
    doc.text('FECHA', cols.fecha, y);
    doc.text('CONCEPTO', cols.conc, y);
    doc.text('IMPORTE', cols.imp - 90, y, { width: 90, align: 'right' });
    doc.fillColor('black'); y += 12;
    hr(doc, L, R, y); y += 6;

    doc.fontSize(8.5).font('Helvetica');
    items.forEach(it => {
      if (y > 760) { doc.addPage(); y = 50; }
      const comp = `${it.tipo_comprobante} ${String(it.punto_venta).padStart(4, '0')}-${String(it.numero).padStart(8, '0')}`;
      doc.text(it.razon_social || '', cols.prov, y, { width: 145, ellipsis: true });
      doc.text(comp, cols.comp, y, { width: 115 });
      doc.text(formatFecha(it.fecha_comprobante), cols.fecha, y, { width: 75 });
      doc.text(it.concepto || '—', cols.conc, y, { width: 110, ellipsis: true });
      doc.text(formatImporte(it.importe_total), cols.imp - 90, y, { width: 90, align: 'right' });
      y += 16;
    });

    y += 6; hr(doc, L, R, y); y += 14;

    // Resumen: total comprobantes / retenciones / total a pagar
    const bx = R - 240;
    const fila = (lbl, val, bold, color) => {
      doc.fontSize(9.5).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(color || 'black');
      doc.text(lbl, bx, y, { width: 130 });
      doc.text(val, bx + 130, y, { width: 110, align: 'right' });
      doc.fillColor('black'); y += 18;
    };
    fila('Total comprobantes', formatImporte(corrida.importe_bruto), false);
    fila('Retenciones', '- ' + formatImporte(corrida.importe_retenciones), false, '#b23b3b');
    hr(doc, bx, R, y); y += 8;
    fila('Total a pagar', formatImporte(corrida.importe_neto), true);
  });
}

module.exports = { generarOrdenPago, generarCertificadoRetencion, generarListadoCorrida, importeEnLetras };
