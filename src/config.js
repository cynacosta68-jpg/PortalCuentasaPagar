'use strict';

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Variable de entorno requerida: ${name}`);
  return v;
};

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: process.env.SESSION_SECRET || 'cambiar-en-produccion-' + Math.random(),
  adminPass: process.env.PORTAL_ADMIN_PASS || 'admin',
  // Arcanum (gateway ARCA)
  arcanumUrl: process.env.ARCANUM_URL || 'http://localhost:8094',
  arcanumApiKey: process.env.ARCANUM_API_KEY || '',
  // CUIT representante (el del certificado cargado en Arcanum). Requerido por el padrón a5.
  arcanumCuit: (process.env.ARCANUM_CUIT || process.env.EMPRESA_CUIT || '').replace(/\D/g, ''),
  // Email
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailRemitente: process.env.EMAIL_REMITENTE || '',
};
