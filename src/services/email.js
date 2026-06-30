'use strict';
const nodemailer = require('nodemailer');

// ── Transporter ──────────────────────────────────────────────
// Configurar con variables de entorno. Si no están definidas, usa ethereal para test.

let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    // Cuenta de prueba Ethereal (solo para desarrollo, no envía mails reales)
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('[email] SMTP no configurado — usando Ethereal. URL de preview en consola.');
  }

  return _transporter;
}

function remitente() {
  const nombre = process.env.EMPRESA_NOMBRE || 'Portal Cuentas a Pagar';
  const mail = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@ejemplo.com';
  return `"${nombre}" <${mail}>`;
}

// ── Orden de pago + certificados al proveedor ────────────────

/**
 * @param {object} opts
 * @param {string} opts.destinatario   — mail del proveedor
 * @param {string} opts.razonSocial    — nombre del proveedor
 * @param {object} opts.orden          — datos de la orden de pago
 * @param {Buffer} opts.pdfOrden       — PDF de la orden de pago
 * @param {Array}  opts.certsPdf       — [{nombre, buffer}] certificados de retención
 */
async function enviarOrdenPago({ destinatario, razonSocial, orden, pdfOrden, certsPdf = [] }) {
  const transporter = await getTransporter();

  const importeNeto = parseFloat(orden.importe_neto || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  const attachments = [
    {
      filename: `${orden.numero_orden}.pdf`,
      content: pdfOrden,
      contentType: 'application/pdf',
    },
    ...certsPdf.map(c => ({
      filename: `${c.nombre}.pdf`,
      content: c.buffer,
      contentType: 'application/pdf',
    })),
  ];

  const info = await transporter.sendMail({
    from: remitente(),
    to: destinatario,
    subject: `Orden de Pago ${orden.numero_orden} — Importe neto: $ ${importeNeto}`,
    html: `
      <p>Estimado/a <strong>${razonSocial}</strong>,</p>
      <p>
        Adjunto encontrará la <strong>Orden de Pago N° ${orden.numero_orden}</strong>
        correspondiente al pago realizado el <strong>${formatFecha(orden.fecha_pago)}</strong>
        por <strong>$ ${importeNeto}</strong> mediante ${orden.medio_pago || 'transferencia'}.
      </p>
      ${certsPdf.length ? `
        <p>
          También se adjuntan los <strong>certificados de retención</strong> practicadas sobre este pago.
          Por favor, conservelos para su declaración impositiva.
        </p>
      ` : ''}
      <p style="color:#666; font-size:12px; margin-top:24px">
        Este mail fue generado automáticamente. Ante cualquier consulta, responda a este correo.
      </p>
    `,
    attachments,
  });

  // En desarrollo con Ethereal, loguear la URL de preview
  if (nodemailer.getTestMessageUrl(info)) {
    console.log('[email] Preview:', nodemailer.getTestMessageUrl(info));
  }

  return info;
}

// ── Mail de aprobación a gerencia ────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.emailGerencia
 * @param {object} opts.corrida        — datos de la corrida
 * @param {string} opts.token          — UUID de aprobación
 * @param {string} opts.baseUrl        — ej: "https://portal.miempresa.com"
 */
async function enviarAprobacionGerencia({ emailGerencia, corrida, token, baseUrl, items = [], empresa = {} }) {
  const transporter = await getTransporter();

  const linkAutorizar = `${baseUrl}/api/corridas/${corrida.id}/autorizar?token=${token}`;
  const fmt = n => parseFloat(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const importeNeto = fmt(corrida.importe_neto);
  const importeBruto = fmt(corrida.importe_bruto);
  const importeRet = fmt(corrida.importe_retenciones);

  // Adjuntar el listado de comprobantes en PDF
  const attachments = [];
  try {
    const { generarListadoCorrida } = require('./pdf');
    const pdf = await generarListadoCorrida({ corrida, items, empresa });
    attachments.push({
      filename: `Corrida_${corrida.codigo_ref}.pdf`,
      content: pdf,
      contentType: 'application/pdf',
    });
  } catch (e) {
    console.error('[email] No se pudo generar el PDF del listado:', e.message);
  }

  const info = await transporter.sendMail({
    from: remitente(),
    to: emailGerencia,
    subject: `Aprobación de pagos — Corrida ${corrida.codigo_ref} — $ ${importeNeto}`,
    attachments,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; max-width:480px; margin:0 auto; color:#1a1c22">
        <p style="font-size:15px; margin:0 0 4px">Solicitud de aprobación de pagos</p>
        <p style="font-size:13px; color:#6b7280; margin:0 0 24px">Corrida ${corrida.codigo_ref} · pago ${formatFecha(corrida.fecha_pago)} · ${corrida.medio_pago || 'Transferencia'}</p>

        <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:24px">
          <tr><td style="padding:6px 0; color:#6b7280">Total comprobantes</td><td style="padding:6px 0; text-align:right">$ ${importeBruto}</td></tr>
          <tr><td style="padding:6px 0; color:#6b7280">Retenciones</td><td style="padding:6px 0; text-align:right; color:#b23b3b">- $ ${importeRet}</td></tr>
          <tr style="border-top:1px solid #e6ebf3"><td style="padding:10px 0; font-weight:600">Total a pagar</td><td style="padding:10px 0; text-align:right; font-weight:600; font-size:16px">$ ${importeNeto}</td></tr>
        </table>

        <a href="${linkAutorizar}" style="display:inline-block; background:#1d4ed8; color:#fff; padding:11px 26px; text-decoration:none; border-radius:8px; font-weight:600; font-size:14px">Autorizar corrida</a>

        <p style="font-size:12px; color:#9aa0b0; margin:22px 0 0">
          Adjuntamos el detalle de comprobantes en PDF. El enlace vence en 72 horas.
          Si no reconocés esta solicitud, ignorá este mensaje.
        </p>
      </div>
    `,
  });

  if (nodemailer.getTestMessageUrl(info)) {
    console.log('[email] Preview aprobación:', nodemailer.getTestMessageUrl(info));
  }

  return info;
}

// ── Notificación de corrida ejecutada (copia interna) ────────

async function enviarNotificacionEjecutada({ emailInterno, corrida, cantOrdenes }) {
  if (!emailInterno) return;
  const transporter = await getTransporter();

  const importeNeto = parseFloat(corrida.importe_neto || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  await transporter.sendMail({
    from: remitente(),
    to: emailInterno,
    subject: `[Portal CP] Corrida ${corrida.codigo_ref} ejecutada — ${cantOrdenes} órdenes`,
    html: `
      <p>La corrida <strong>${corrida.codigo_ref}</strong> fue ejecutada correctamente.</p>
      <ul>
        <li>Órdenes de pago generadas: <strong>${cantOrdenes}</strong></li>
        <li>Total neto: <strong>$ ${importeNeto}</strong></li>
      </ul>
      <p style="color:#666; font-size:12px">Podés ver el detalle en el Portal de Cuentas a Pagar › Seguimiento.</p>
    `,
  });
}

// Helpers de formato
function formatFecha(d) {
  if (!d) return '—';
  const dt = new Date(typeof d === 'string' && !d.includes('T') ? d + 'T12:00:00' : d);
  return dt.toLocaleDateString('es-AR');
}

function formatFechaHora(d) {
  return d.toLocaleString('es-AR');
}

module.exports = { enviarOrdenPago, enviarAprobacionGerencia, enviarNotificacionEjecutada };
