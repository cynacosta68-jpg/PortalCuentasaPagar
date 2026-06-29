-- Portal de Cuentas a Pagar — Migración 002
-- Amplía el modelo de retenciones a cuatro tipos: Ganancias, IVA, IIBB y SUSS.
-- Aditiva e idempotente: no pisa datos ni columnas existentes.

BEGIN;

-- ─────────────────────────────────────────────
-- PROVEEDORES — nuevas retenciones configurables desde el ABM
-- IIBB y SUSS se manejan con alícuota configurable por proveedor
-- (la norma exacta depende de jurisdicción y actividad; el contador la setea).
-- ─────────────────────────────────────────────
ALTER TABLE proveedores
  ADD COLUMN IF NOT EXISTS ret_iibb              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ret_iibb_alicuota     DECIMAL(5,2),       -- p. ej. 2.00, 3.00
  ADD COLUMN IF NOT EXISTS ret_iibb_jurisdiccion TEXT DEFAULT 'Chubut',
  ADD COLUMN IF NOT EXISTS ret_iibb_regimen      TEXT,               -- código/descripcion del régimen provincial
  ADD COLUMN IF NOT EXISTS ret_suss              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ret_suss_alicuota     DECIMAL(5,2);       -- p. ej. 1.00 (RG 1784 construcción)

-- ─────────────────────────────────────────────
-- ORDENES DE PAGO — columnas propias para IIBB y SUSS
-- (antes caían en ret_otros; ahora quedan discriminadas para el reporte)
-- ─────────────────────────────────────────────
ALTER TABLE ordenes_pago
  ADD COLUMN IF NOT EXISTS ret_iibb DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ret_suss DECIMAL(14,2) NOT NULL DEFAULT 0;

-- certificados_retencion.tipo_retencion es TEXT libre: admite 'iibb' y 'suss'
-- sin cambios de esquema. Documentamos los valores válidos.
COMMENT ON COLUMN certificados_retencion.tipo_retencion IS 'ganancias | iva | iibb | suss';

COMMIT;
