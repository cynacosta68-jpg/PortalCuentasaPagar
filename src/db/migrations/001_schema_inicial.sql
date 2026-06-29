-- Portal de Cuentas a Pagar — Schema inicial
-- Ejecutar en orden; idempotente gracias a IF NOT EXISTS

BEGIN;

-- ─────────────────────────────────────────────
-- PROVEEDORES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proveedores (
  id              SERIAL PRIMARY KEY,
  cuit            VARCHAR(13) UNIQUE NOT NULL,
  razon_social    TEXT NOT NULL,
  actividad       TEXT,
  condicion_fiscal TEXT,            -- Responsable Inscripto, Monotributista, Exento, etc.
  categoria_monotributo VARCHAR(10), -- A, B, C... solo si condicion_fiscal = Monotributista
  domicilio_fiscal TEXT,
  mail            TEXT NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT true,
  -- Retenciones que aplican a este proveedor (según ABM del contador)
  ret_ganancias   BOOLEAN NOT NULL DEFAULT false,
  ret_ganancias_regimen TEXT,       -- código de régimen RG830
  ret_iva         BOOLEAN NOT NULL DEFAULT false,
  ret_iva_alicuota DECIMAL(5,2),    -- 80%, 100% etc. según condición fiscal
  -- Trazabilidad
  datos_arca_json JSONB,            -- respuesta cruda de Arcanum para auditoría
  datos_arca_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- TABLAS RG830 — RETENCIONES GANANCIAS
-- Se cargan por script; el contador las puede actualizar desde admin
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tablas_ret_ganancias (
  id              SERIAL PRIMARY KEY,
  regimen_codigo  TEXT NOT NULL,
  descripcion     TEXT NOT NULL,
  -- Escala de cálculo
  escala_json     JSONB NOT NULL,
  /*
    Formato escala_json:
    [
      { "desde": 0, "hasta": 50000, "alicuota": 0.50, "minimo": 0 },
      { "desde": 50000, "hasta": 100000, "alicuota": 1.00, "minimo": 250 },
      ...
      { "desde": 500000, "hasta": null, "alicuota": 3.00, "minimo": 5000 }
    ]
  */
  minimo_no_imponible DECIMAL(14,2) NOT NULL DEFAULT 0,
  vigencia_desde  DATE NOT NULL,
  vigencia_hasta  DATE,             -- NULL = vigente
  fuente          TEXT DEFAULT 'RG830',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tablas_ret_ganancias_regimen_vigencia
  ON tablas_ret_ganancias (regimen_codigo, vigencia_desde);

-- ─────────────────────────────────────────────
-- EGRESOS (comprobantes de proveedores)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS egresos (
  id                  SERIAL PRIMARY KEY,
  proveedor_id        INTEGER NOT NULL REFERENCES proveedores(id),
  -- Datos del comprobante ARCA
  tipo_comprobante    VARCHAR(5) NOT NULL,   -- FA, FB, FC, FM, NCA, etc.
  punto_venta         INTEGER NOT NULL,
  numero              BIGINT NOT NULL,
  fecha_comprobante   DATE NOT NULL,
  cuit_emisor         VARCHAR(13) NOT NULL,
  importe_neto        DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_iva         DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_otros       DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_total       DECIMAL(14,2) NOT NULL,
  moneda              CHAR(3) NOT NULL DEFAULT 'PES',
  cotizacion          DECIMAL(10,4) NOT NULL DEFAULT 1,
  -- Datos que completa el usuario
  concepto            TEXT,                   -- descripción libre del gasto
  categoria_egreso    TEXT,                   -- Materia Prima, Servicios, Logística, etc.
  fecha_vto_pago      DATE,
  -- Origen de carga
  origen              TEXT NOT NULL DEFAULT 'manual', -- manual | qr | pdf | lote
  raw_qr_data         TEXT,
  raw_pdf_text        TEXT,
  -- Estado
  estado              TEXT NOT NULL DEFAULT 'pendiente',
  -- pendiente | en_corrida | pagado | anulado
  corrida_pago_id     INTEGER,               -- FK se agrega luego
  -- Trazabilidad
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cuit_emisor, tipo_comprobante, punto_venta, numero)
);

-- ─────────────────────────────────────────────
-- CORRIDAS DE PAGO
-- Una corrida = conjunto de egresos que se pagan juntos en una fecha
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corridas_pago (
  id              SERIAL PRIMARY KEY,
  codigo_ref      TEXT UNIQUE NOT NULL,       -- CORR-YYYYMMDD-NNNN
  tipo            TEXT NOT NULL,              -- inmediata | planificada
  estado          TEXT NOT NULL DEFAULT 'borrador',
  /*
    Estados:
      borrador          → se está armando
      pendiente_aprob   → enviada a gerencia para autorización
      aprobada          → gerencia autorizó, lista para ejecutar
      rechazada         → gerencia rechazó; egresos vuelven a pendiente
      ejecutada         → se generaron órdenes de pago y se notificó
      cerrada           → mails enviados, todo confirmado
  */
  fecha_pago      DATE,
  medio_pago      TEXT,                       -- Transferencia, Cheque, etc.
  importe_bruto   DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_retenciones DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_neto    DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- Aprobación
  token_aprobacion TEXT UNIQUE,               -- UUID para link de gerencia
  token_expira_at TIMESTAMPTZ,
  aprobado_por    TEXT,
  aprobado_at     TIMESTAMPTZ,
  -- Trazabilidad
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FK diferida (egresos referencia corridas)
ALTER TABLE egresos
  ADD CONSTRAINT fk_egreso_corrida
  FOREIGN KEY (corrida_pago_id)
  REFERENCES corridas_pago(id)
  ON DELETE SET NULL
  NOT VALID;

-- ─────────────────────────────────────────────
-- ITEMS DE CORRIDA (egresos dentro de una corrida)
-- Tabla intermedia para preservar histórico aunque la corrida cambie
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corrida_items (
  id              SERIAL PRIMARY KEY,
  corrida_id      INTEGER NOT NULL REFERENCES corridas_pago(id),
  egreso_id       INTEGER NOT NULL REFERENCES egresos(id),
  proveedor_id    INTEGER NOT NULL REFERENCES proveedores(id),
  importe_egreso  DECIMAL(14,2) NOT NULL,
  UNIQUE (corrida_id, egreso_id)
);

-- ─────────────────────────────────────────────
-- ÓRDENES DE PAGO
-- Una orden por proveedor dentro de una corrida
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_pago (
  id              SERIAL PRIMARY KEY,
  corrida_id      INTEGER NOT NULL REFERENCES corridas_pago(id),
  proveedor_id    INTEGER NOT NULL REFERENCES proveedores(id),
  numero_orden    TEXT UNIQUE NOT NULL,       -- OP-YYYYMMDD-NNNN
  fecha_pago      DATE NOT NULL,
  importe_bruto   DECIMAL(14,2) NOT NULL,
  -- Detalle de retenciones
  ret_ganancias   DECIMAL(14,2) NOT NULL DEFAULT 0,
  ret_iva         DECIMAL(14,2) NOT NULL DEFAULT 0,
  ret_otros       DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_total_ret DECIMAL(14,2) NOT NULL DEFAULT 0,
  importe_neto    DECIMAL(14,2) NOT NULL,     -- bruto - retenciones
  medio_pago      TEXT NOT NULL,
  -- Archivos generados
  pdf_orden       BYTEA,
  pdf_cert_ret    BYTEA,
  -- Notificación
  mail_enviado_at TIMESTAMPTZ,
  mail_destinatario TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- CERTIFICADOS DE RETENCIÓN
-- Un cert por retención dentro de una orden de pago
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS certificados_retencion (
  id              SERIAL PRIMARY KEY,
  orden_pago_id   INTEGER NOT NULL REFERENCES ordenes_pago(id),
  tipo_retencion  TEXT NOT NULL,              -- ganancias | iva
  regimen_codigo  TEXT,
  base_calculo    DECIMAL(14,2) NOT NULL,
  alicuota        DECIMAL(5,2) NOT NULL,
  importe         DECIMAL(14,2) NOT NULL,
  periodo_fiscal  CHAR(6) NOT NULL,           -- YYYYMM
  numero_cert     TEXT UNIQUE NOT NULL,       -- CERT-YYYYMMDD-NNNN
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- CONSULTAS Y RECLAMOS DE PROVEEDORES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultas_reclamos (
  id              SERIAL PRIMARY KEY,
  proveedor_id    INTEGER REFERENCES proveedores(id),
  tipo            TEXT NOT NULL DEFAULT 'consulta', -- consulta | reclamo
  asunto          TEXT NOT NULL,
  mensaje         TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | respondido | cerrado
  respuesta       TEXT,
  respondido_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- CONFIGURACIÓN DEL PORTAL
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS configuracion (
  clave   TEXT PRIMARY KEY,
  valor   TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO configuracion (clave, valor) VALUES
  ('empresa_razon_social', ''),
  ('empresa_cuit', ''),
  ('email_gerencia', ''),
  ('email_remitente', ''),
  ('arcanum_url', 'http://localhost:8094'),
  ('nro_siguiente_corrida', '1'),
  ('nro_siguiente_orden', '1'),
  ('nro_siguiente_cert', '1')
ON CONFLICT (clave) DO NOTHING;

-- ─────────────────────────────────────────────
-- ÍNDICES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_egresos_proveedor   ON egresos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_egresos_estado       ON egresos(estado);
CREATE INDEX IF NOT EXISTS idx_egresos_vto          ON egresos(fecha_vto_pago);
CREATE INDEX IF NOT EXISTS idx_corrida_items_corrida ON corrida_items(corrida_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_corrida      ON ordenes_pago(corrida_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_proveedor    ON ordenes_pago(proveedor_id);

COMMIT;
