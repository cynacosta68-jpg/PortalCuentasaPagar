-- Portal de Cuentas a Pagar — Migración 006
-- Certificado de NO retención / exclusión del proveedor.
-- Si el proveedor posee certificado vigente, NO se le practican retenciones
-- mientras dure la vigencia (fecha de pago entre 'desde' y 'hasta').

BEGIN;

ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS cert_no_retencion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cert_no_ret_desde DATE,
  ADD COLUMN IF NOT EXISTS cert_no_ret_hasta DATE;

COMMIT;
