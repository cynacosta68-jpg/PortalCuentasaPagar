'use strict';
const PDFDocument = require('pdfkit');

// ── Helpers ──────────────────────────────────────────────────

function formatImporte(n) {
  return '$ ' + parseFloat(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatFecha(d) {
  if (!d) return '—';
  const dt = new Date(d + (d.includes('T') ? '' : 'T12:00:00'));
  return dt.toLocaleDateString('es-AR');
}

function formatCuit(c) {
  if (!c || c.length !== 11) return c || '';
  return `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}`;
}

// Genera un Buffer con el PDF usando la función provista
async function generarPDFBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      buildFn(doc);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Orden de Pago ────────────────────────────────────────────

/**
 * @param {object} datos
 * @param {object} datos.orden       — registro de ordenes_pago
 * @param {object} datos.proveedor   — datos del proveedor
 * @param {object} datos.empresa     — { razon_social, cuit, domicilio }
 * @param {Array}  datos.egresos     — comprobantes incluidos
 * @param {Array}  datos.certs       — certificados de retención vinculados
 */
async function generarOrdenPago(datos) {
  const { orden, proveedor, empresa, egresos, certs } = datos;

  return generarPDFBuffer(doc => {
    const W = doc.page.width - 100; // ancho útil

    // ── Encabezado ─────────────────────────────────────────
    doc.fontSize(18).font('Helvetica-Bold').text('ORDEN DE PAGO', { align: 'center' });
    doc.fontSize(11).font('Helvetica').text(orden.numero_orden, { align: 'center' });
    doc.moveDown(0.5);

    // Línea separadora
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);

    // Datos de la empresa emisora (izq) y del documento (der)
    const yRef = doc.y;
    doc.fontSize(9).font('Helvetica-Bold').text('EMITIDO POR:', 50, yRef);
    doc.font('Helvetica').text(empresa.razon_social || '', 50, doc.y);
    doc.text(`CUIT: ${formatCuit(empresa.cuit || '')}`, 50, doc.y);
    if (empresa.domicilio) doc.text(empresa.domicilio, 50, doc.y);

    doc.fontSize(9).font('Helvetica-Bold').text('Fecha de pago:', 350, yRef);
    doc.font('Helvetica').text(formatFecha(orden.fecha_pago), 350, doc.y);
    doc.font('Helvetica-Bold').text('Medio de pago:', 350, doc.y);
    doc.font('Helvetica').text(orden.medio_pago || 'Transferencia', 350, doc.y);

    doc.moveDown(1.5);

    // ── Datos del proveedor ─────────────────────────────────
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica-Bold').text('PROVEEDOR:');
    doc.fontSize(9).font('Helvetica').text(`${proveedor.razon_social}   |   CUIT: ${formatCuit(proveedor.cuit)}`);
    if (proveedor.mail) doc.text(`Mail: ${proveedor.mail}`);
    doc.moveDown(0.8);

    // ── Tabla de comprobantes ───────────────────────────────
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica-Bold');

    const col = { tipo: 50, nro: 130, fecha: 300, importe: 440 };
    doc.text('Tipo', col.tipo, doc.y, { continued: false });
    const yHead = doc.y - doc.currentLineHeight();
    doc.text('Comprobante', col.nro, yHead);
    doc.text('Fecha', col.fecha, yHead);
    doc.text('Importe', col.importe, yHead, { align: 'right', width: 100 });

    doc.moveDown(0.2);
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#eeeeee').stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(8);
    for (const eg of (egresos || [])) {
      const yRow = doc.y;
      const nroComp = `${eg.tipo_comprobante} ${String(eg.punto_venta).padStart(4, '0')}-${String(eg.numero).padStart(8, '0')}`;
      doc.text(eg.tipo_comprobante, col.tipo, yRow);
      doc.text(nroComp, col.nro, yRow);
      doc.text(formatFecha(eg.fecha_comprobante), col.fecha, yRow);
      doc.text(formatImporte(eg.importe_total), col.importe, yRow, { align: 'right', width: 100 });
      doc.moveDown(0.4);
    }

    // ── Retenciones ─────────────────────────────────────────
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.4);
    doc.fontSize(9).font('Helvetica-Bold').text('RETENCIONES:');
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(8);

    for (const cert of (certs || [])) {
      const label = cert.tipo_retencion === 'ganancias'
        ? `Ret. Ganancias (Reg. ${cert.regimen_codigo || '—'}) — Base: ${formatImporte(cert.base_calculo)} × ${cert.alicuota}%`
        : `Ret. IVA — Base: ${formatImporte(cert.base_calculo)} × ${cert.alicuota}%`;
      const yRow = doc.y;
      doc.text(label, 60, yRow);
      doc.text(`(${cert.numero_cert})`, 340, yRow);
      doc.text(`- ${formatImporte(cert.importe)}`, col.importe, yRow, { align: 'right', width: 100 });
      doc.moveDown(0.4);
    }
    if (!certs?.length) {
      doc.text('Sin retenciones aplicadas.', 60, doc.y);
      doc.moveDown(0.4);
    }

    // ── Total a pagar ────────────────────────────────────────
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.4);

    const yTot = doc.y;
    doc.fontSize(9).font('Helvetica');
    doc.text(`Total bruto: ${formatImporte(orden.importe_bruto)}`, 350, yTot);
    doc.text(`Total retenciones: - ${formatImporte(orden.importe_total_ret)}`, 350, doc.y);
    doc.fontSize(11).font('Helvetica-Bold');
    doc.text(`TOTAL A PAGAR: ${formatImporte(orden.importe_neto)}`, 50, doc.y + 4, { align: 'right', width: W });

    // ── Pie ──────────────────────────────────────────────────
    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.4);
    doc.fontSize(7).font('Helvetica').fillColor('#999999')
      .text('Documento generado automáticamente por Portal Cuentas a Pagar. No requiere firma.', { align: 'center' });
  });
}

// ── Certificado de Retención ─────────────────────────────────

/**
 * @param {object} datos
 * @param {object} datos.cert        — registro certificados_retencion
 * @param {object} datos.orden       — orden_pago vinculada
 * @param {object} datos.proveedor   — proveedor al que se le retiene
 * @param {object} datos.empresa     — agente de retención (empresa que paga)
 */
async function generarCertificadoRetencion(datos) {
  const { cert, orden, proveedor, empresa } = datos;

  const tipoLabel = cert.tipo_retencion === 'ganancias'
    ? 'RETENCIÓN DE IMPUESTO A LAS GANANCIAS'
    : 'RETENCIÓN DE IVA';

  const regimenLabel = cert.tipo_retencion === 'ganancias'
    ? `Régimen ${cert.regimen_codigo || '—'} — RG 830 ARCA`
    : `Alícuota ${cert.alicuota}% — RG 2854 ARCA`;

  return generarPDFBuffer(doc => {
    const W = doc.page.width - 100;

    // Encabezado
    doc.fontSize(16).font('Helvetica-Bold')
      .text('CERTIFICADO DE RETENCIÓN', { align: 'center' });
    doc.fontSize(11).font('Helvetica')
      .text(tipoLabel, { align: 'center' });
    doc.fontSize(9).text(cert.numero_cert, { align: 'center' });
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.6);

    // Bloque: Agente de retención
    doc.fontSize(9).font('Helvetica-Bold').text('AGENTE DE RETENCIÓN (quien paga):');
    doc.font('Helvetica')
      .text(`Razón Social: ${empresa.razon_social || ''}`)
      .text(`CUIT: ${formatCuit(empresa.cuit || '')}`)
      .text(`Domicilio: ${empresa.domicilio || ''}`);
    doc.moveDown(0.8);

    // Bloque: Sujeto retenido
    doc.font('Helvetica-Bold').text('SUJETO RETENIDO (proveedor):');
    doc.font('Helvetica')
      .text(`Razón Social: ${proveedor.razon_social}`)
      .text(`CUIT: ${formatCuit(proveedor.cuit)}`);
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.6);

    // Datos de la retención
    doc.font('Helvetica-Bold').text('DATOS DE LA RETENCIÓN:');
    doc.font('Helvetica')
      .text(`Régimen: ${regimenLabel}`)
      .text(`Período fiscal: ${cert.periodo_fiscal || ''}`)
      .text(`Fecha de pago: ${formatFecha(orden.fecha_pago)}`)
      .text(`Orden de pago N°: ${orden.numero_orden}`);
    doc.moveDown(0.8);

    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.6);

    // Cálculo
    doc.font('Helvetica-Bold').text('CÁLCULO:');
    doc.moveDown(0.3);

    const colL = 60;
    const colR = 400;

    doc.font('Helvetica');
    const rows = [
      ['Base de cálculo:', formatImporte(cert.base_calculo)],
      [`Alícuota aplicada (${cert.alicuota}%):`, `${cert.alicuota}%`],
      ['Importe retenido:', formatImporte(cert.importe)],
    ];

    for (const [label, valor] of rows) {
      const yRow = doc.y;
      doc.text(label, colL, yRow);
      doc.text(valor, colR, yRow, { align: 'right', width: 100 });
      doc.moveDown(0.4);
    }

    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#333333').stroke();
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica-Bold');
    const yTotal = doc.y;
    doc.text('IMPORTE RETENIDO:', colL, yTotal);
    doc.text(formatImporte(cert.importe), colR, yTotal, { align: 'right', width: 100 });

    // Pie
    doc.moveDown(3);
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.4);
    doc.fontSize(7).font('Helvetica').fillColor('#999999')
      .text('Certificado generado por Portal Cuentas a Pagar conforme RG ARCA vigente.', { align: 'center' });
    doc.text('Este documento tiene validez como constancia de retención practicada.', { align: 'center' });
  });
}

module.exports = { generarOrdenPago, generarCertificadoRetencion };
