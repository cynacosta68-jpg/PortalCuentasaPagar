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
async function enviarAprobacionGerencia({ emailGerencia, corrida, token, baseUrl }) {
  const transporter = await getTransporter();

  const linkAutorizar = `${baseUrl}/api/corridas/${corrida.id}/autorizar?token=${token}`;
  const importeNeto = parseFloat(corrida.importe_neto || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const importeBruto = parseFloat(corrida.importe_bruto || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const importeRet = parseFloat(corrida.importe_retenciones || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  const info = await transporter.sendMail({
    from: remitente(),
    to: emailGerencia,
    subject: `[APROBACIÓN REQUERIDA] Corrida de pagos ${corrida.codigo_ref} — $ ${importeNeto} neto`,
    html: `
      <h2 style="color:#1a1a2e">Propuesta de corrida de pagos</h2>
      <p>
        El área de Cuentas a Pagar solicita su aprobación para la siguiente corrida:
      </p>
      <table style="border-collapse:collapse; width:100%; max-width:480px; font-family:sans-serif; font-size:14px">
        <tr>
          <td style="padding:8px 12px; background:#f5f5f5; font-weight:bold">Código:</td>
          <td style="padding:8px 12px">${corrida.codigo_ref}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px; background:#f5f5f5; font-weight:bold">Fecha de pago:</td>
          <td style="padding:8px 12px">${formatFecha(corrida.fecha_pago)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px; background:#f5f5f5; font-weight:bold">Medio:</td>
          <td style="padding:8px 12px">${corrida.medio_pago || 'Transferencia'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px; background:#f5f5f5; font-weight:bold">Total bruto:</td>
          <td style="padding:8px 12px">$ ${importeBruto}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px; background:#f5f5f5; font-weight:bold; color:#c0392b">Retenciones:</td>
          <td style="padding:8px 12px; color:#c0392b">- $ ${importeRet}</td>
        </tr>
        <tr style="border-top:2px solid #1a1a2e">
          <td style="padding:10px 12px; background:#1a1a2e; color:#fff; font-weight:bold">Total a pagar:</td>
          <td style="padding:10px 12px; background:#1a1a2e; color:#fff; font-weight:bold; font-size:16px">$ ${importeNeto}</td>
        </tr>
      </table>

      <p style="margin-top:24px">
        Para <strong>autorizar</strong> esta corrida de pagos, haga clic en el siguiente botón:
      </p>
      <p>
        <a href="${linkAutorizar}"
           style="display:inline-block; background:#1a1a2e; color:#fff; padding:12px 28px;
                  text-decoration:none; border-radius:6px; font-weight:bold; font-size:15px">
          ✓ Autorizar corrida de pagos
        </a>
      </p>

      <p style="color:#e74c3c; font-weight:bold">
        Este link expira en 72 horas (${formatFechaHora(new Date(Date.now() + 72 * 3600 * 1000))}).
      </p>

      <p style="color:#666; font-size:12px; margin-top:24px">
        Si no solicitó esta autorización o tiene dudas, no haga clic en el link y comuníquese con el área contable.
      </p>
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
