-- Portal de Cuentas a Pagar — Migración 005
-- 1) Corrige el mínimo no sujeto del régimen 78 (Enajenación de bienes):
--    según Anexo VIII RG830 es $224.000, estaba en $0.
-- 2) Crea la tabla de acumulados mensuales por (proveedor, régimen, período)
--    para aplicar la lógica de retención acumulada de la RG830:
--    el mínimo se computa UNA vez sobre el acumulado del mes y a la
--    retención total se le resta lo ya retenido en pagos anteriores.

BEGIN;

-- 1) Mínimo correcto del régimen 78
UPDATE tablas_ret_ganancias
   SET minimo_no_imponible = 224000
 WHERE regimen_codigo = '78';

-- 2) Acumulados mensuales de retención de Ganancias
CREATE TABLE IF NOT EXISTS retenciones_acumuladas (
  id             SERIAL PRIMARY KEY,
  proveedor_id   INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  regimen_codigo TEXT NOT NULL,
  periodo        CHAR(7) NOT NULL,            -- 'YYYY-MM' (mes calendario del pago)
  orden_pago_id  INTEGER REFERENCES ordenes_pago(id) ON DELETE CASCADE,
  base           DECIMAL(14,2) NOT NULL,      -- base bruta (neto) de ESTE pago, antes del mínimo
  retencion      DECIMAL(14,2) NOT NULL,      -- retención efectivamente practicada en ESTE pago
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ret_acum_lookup
  ON retenciones_acumuladas (proveedor_id, regimen_codigo, periodo);

COMMIT;
