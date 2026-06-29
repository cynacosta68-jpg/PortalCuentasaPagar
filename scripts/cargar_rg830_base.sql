-- Carga inicial de tabla de retenciones ganancias RG830
-- Régimen general (actividades no contempladas en forma específica)
-- Vigencia: actualizar según las tablas que publica ARCA periódicamente.
-- IMPORTANTE: Estos valores son de referencia — confirmar con la norma vigente.

-- Apunta al schema del portal (no al public de otras apps en la misma base).
SET search_path TO portal, public;

INSERT INTO tablas_ret_ganancias (regimen_codigo, descripcion, minimo_no_imponible, escala_json, vigencia_desde)
VALUES (
  '306',
  'Locaciones y prestaciones de servicios (general)',
  400000,
  '[
    {"desde": 0,       "hasta": 200000,  "alicuota": 2.00,  "minimo": 0},
    {"desde": 200000,  "hasta": 400000,  "alicuota": 4.00,  "minimo": 4000},
    {"desde": 400000,  "hasta": 800000,  "alicuota": 6.00,  "minimo": 12000},
    {"desde": 800000,  "hasta": 1600000, "alicuota": 8.00,  "minimo": 36000},
    {"desde": 1600000, "hasta": null,    "alicuota": 10.00, "minimo": 100000}
  ]'::jsonb,
  '2024-01-01'
),
(
  '105',
  'Compras de bienes muebles (general)',
  400000,
  '[
    {"desde": 0,       "hasta": 200000,  "alicuota": 0.50, "minimo": 0},
    {"desde": 200000,  "hasta": 400000,  "alicuota": 1.00, "minimo": 1000},
    {"desde": 400000,  "hasta": 800000,  "alicuota": 1.50, "minimo": 3000},
    {"desde": 800000,  "hasta": 1600000, "alicuota": 2.00, "minimo": 9000},
    {"desde": 1600000, "hasta": null,    "alicuota": 3.00, "minimo": 25000}
  ]'::jsonb,
  '2024-01-01'
),
(
  '217',
  'Alquileres de bienes inmuebles urbanos',
  400000,
  '[
    {"desde": 0,       "hasta": 200000,  "alicuota": 3.00,  "minimo": 0},
    {"desde": 200000,  "hasta": 400000,  "alicuota": 5.00,  "minimo": 6000},
    {"desde": 400000,  "hasta": 800000,  "alicuota": 7.00,  "minimo": 16000},
    {"desde": 800000,  "hasta": 1600000, "alicuota": 9.00,  "minimo": 44000},
    {"desde": 1600000, "hasta": null,    "alicuota": 11.00, "minimo": 116000}
  ]'::jsonb,
  '2024-01-01'
)
ON CONFLICT (regimen_codigo, vigencia_desde) DO NOTHING;

-- Nota para la CP:
-- Los valores de MNI y escala se actualizan periódicamente por ARCA.
-- Agregar más regímenes (transporte, honorarios profesionales, etc.) según los
-- proveedores que tenga la empresa. La tabla se puede editar desde el admin del portal.
