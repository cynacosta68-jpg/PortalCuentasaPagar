-- Portal de Cuentas a Pagar — Migración 003
-- Siembra las tablas RG830 con valores VIGENTES (jun-2026) para los regímenes
-- que usa la empresa. Reemplaza los placeholders del seed anterior.
--
-- Modelo de escala_json (por tramo):
--   { "desde", "hasta", "fijo", "excedente", "alicuota" }
--   importe = fijo + (base - excedente) * alicuota/100   con base = pago - mni
--   Para % fijo: un solo tramo {desde:0, hasta:null, fijo:0, excedente:0, alicuota:X}
--
-- Fuentes: RG 830 Anexo VIII; RG 5423/2023 (escala profesiones liberales, cód. 119);
-- valores de mínimos confirmados a 2025/2026. CONFIRMAR con el contador antes de producción.

BEGIN;

DELETE FROM tablas_ret_ganancias WHERE regimen_codigo IN ('78','94','30','31','32','119','116','124');

-- ── 94 — Locaciones de obra y/o servicios (no en relación de dependencia) ──
-- 2% fijo · mínimo no sujeto $67.170
INSERT INTO tablas_ret_ganancias (regimen_codigo, descripcion, minimo_no_imponible, escala_json, vigencia_desde)
VALUES ('94', 'Locaciones de obra y/o servicios', 67170,
  '[{"desde":0,"hasta":null,"fijo":0,"excedente":0,"alicuota":2}]', '2025-01-01');

-- ── 78 — Enajenación de bienes muebles y bienes de cambio ──
-- 2% fijo · OJO: mínimo no sujeto A CONFIRMAR (el aplicativo trae 0)
INSERT INTO tablas_ret_ganancias (regimen_codigo, descripcion, minimo_no_imponible, escala_json, vigencia_desde)
VALUES ('78', 'Enajenación de bienes muebles y bienes de cambio', 0,
  '[{"desde":0,"hasta":null,"fijo":0,"excedente":0,"alicuota":2}]', '2025-01-01');

-- ── 30/31/32 — Alquileres (muebles / inmuebles urbanos / rurales) ──
-- 6% fijo · mínimo no sujeto $11.200
INSERT INTO tablas_ret_ganancias (regimen_codigo, descripcion, minimo_no_imponible, escala_json, vigencia_desde)
VALUES
 ('30', 'Alquileres de bienes muebles', 11200, '[{"desde":0,"hasta":null,"fijo":0,"excedente":0,"alicuota":6}]', '2025-01-01'),
 ('31', 'Alquileres de inmuebles urbanos', 11200, '[{"desde":0,"hasta":null,"fijo":0,"excedente":0,"alicuota":6}]', '2025-01-01'),
 ('32', 'Alquileres de inmuebles rurales', 11200, '[{"desde":0,"hasta":null,"fijo":0,"excedente":0,"alicuota":6}]', '2025-01-01');

-- ── 119 — Profesiones liberales y oficios (MÉDICOS) ──
-- mínimo no sujeto $160.000 · escala RG 5423/2023 (sobre el excedente de $160.000)
INSERT INTO tablas_ret_ganancias (regimen_codigo, descripcion, minimo_no_imponible, escala_json, vigencia_desde)
VALUES ('119', 'Profesiones liberales y oficios', 160000,
  '[
     {"desde":0,      "hasta":71000,  "fijo":0,      "excedente":0,      "alicuota":5},
     {"desde":71000,  "hasta":142000, "fijo":3550,   "excedente":71000,  "alicuota":9},
     {"desde":142000, "hasta":213000, "fijo":9940,   "excedente":142000, "alicuota":12},
     {"desde":213000, "hasta":284000, "fijo":18460,  "excedente":213000, "alicuota":15},
     {"desde":284000, "hasta":426000, "fijo":29110,  "excedente":284000, "alicuota":19},
     {"desde":426000, "hasta":568000, "fijo":56090,  "excedente":426000, "alicuota":23},
     {"desde":568000, "hasta":852000, "fijo":88750,  "excedente":568000, "alicuota":27},
     {"desde":852000, "hasta":null,   "fijo":165430, "excedente":852000, "alicuota":31}
   ]', '2023-10-01');

-- ── 116 / 124 — Directores, síndicos, albaceas / corredores y viajantes ──
-- Usan la escala GENERAL (no la de 119). Sus tramos vigentes deben CONFIRMARSE
-- (el aplicativo trae una escala con valores desactualizados). Sembrar cuando
-- se validen los importes con el contador. Mínimo no sujeto de referencia: $67.170 (116).

COMMIT;
