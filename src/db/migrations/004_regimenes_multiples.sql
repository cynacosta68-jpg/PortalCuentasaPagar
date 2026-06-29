-- Portal de Cuentas a Pagar — Migración 004
-- Rediseño de retenciones de Ganancias:
--   1) Un proveedor puede tener VARIOS regímenes (bienes, servicios, etc.)
--   2) Cada egreso/factura indica a qué régimen corresponde (una factura = un régimen)
--   La base de retención es siempre el importe NETO (sin IVA).

BEGIN;

-- 1) Tabla puente: regímenes de Ganancias habilitados por proveedor
CREATE TABLE IF NOT EXISTS proveedor_regimenes_ganancias (
  id             SERIAL PRIMARY KEY,
  proveedor_id   INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  regimen_codigo TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proveedor_id, regimen_codigo)
);

-- Migrar el régimen único existente (si lo había) a la nueva tabla
INSERT INTO proveedor_regimenes_ganancias (proveedor_id, regimen_codigo)
SELECT id, ret_ganancias_regimen
  FROM proveedores
 WHERE ret_ganancias_regimen IS NOT NULL AND btrim(ret_ganancias_regimen) <> ''
ON CONFLICT (proveedor_id, regimen_codigo) DO NOTHING;

-- 2) Cada egreso indica su régimen de Ganancias (NULL = sin retención de ganancias)
ALTER TABLE egresos
  ADD COLUMN IF NOT EXISTS regimen_ganancias TEXT;

COMMIT;
