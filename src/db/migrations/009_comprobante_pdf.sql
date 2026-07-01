-- Portal de Cuentas a Pagar — Migración 009
-- Guarda el PDF del comprobante junto al egreso (para verlo desde Ver detalle).

BEGIN;

ALTER TABLE egresos
  ADD COLUMN IF NOT EXISTS comprobante_pdf    BYTEA,
  ADD COLUMN IF NOT EXISTS comprobante_nombre TEXT;

COMMIT;
