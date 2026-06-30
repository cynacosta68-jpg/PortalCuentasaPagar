-- Portal de Cuentas a Pagar — Migración 007
-- Datos del medio de pago a nivel corrida:
--   Transferencia: banco de salida, CBU/alias, cuenta, titular
--   Cheque: banco, número, fecha de emisión, fecha de cobro/diferido, titular

BEGIN;

ALTER TABLE corridas_pago
  ADD COLUMN IF NOT EXISTS transf_banco       TEXT,
  ADD COLUMN IF NOT EXISTS transf_cuenta      TEXT,   -- CBU / alias / nro de cuenta
  ADD COLUMN IF NOT EXISTS transf_titular     TEXT,
  ADD COLUMN IF NOT EXISTS cheque_banco       TEXT,
  ADD COLUMN IF NOT EXISTS cheque_numero      TEXT,
  ADD COLUMN IF NOT EXISTS cheque_fecha_emision DATE,
  ADD COLUMN IF NOT EXISTS cheque_fecha_cobro   DATE,
  ADD COLUMN IF NOT EXISTS cheque_titular     TEXT;

COMMIT;
