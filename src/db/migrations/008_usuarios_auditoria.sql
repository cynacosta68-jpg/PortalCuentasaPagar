-- Portal de Cuentas a Pagar — Migración 008
-- Multiusuario con roles + registro de auditoría.

BEGIN;

CREATE TABLE IF NOT EXISTS usuarios (
  id              SERIAL PRIMARY KEY,
  usuario         VARCHAR(50) UNIQUE NOT NULL,
  nombre          TEXT NOT NULL,
  email           TEXT,
  rol             VARCHAR(20) NOT NULL DEFAULT 'auditor',  -- gerencia, coordinacion, analista, auditor
  password_hash   TEXT NOT NULL,
  debe_cambiar    BOOLEAN NOT NULL DEFAULT true,
  activo          BOOLEAN NOT NULL DEFAULT true,
  ultimo_acceso   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auditoria (
  id          SERIAL PRIMARY KEY,
  usuario     VARCHAR(50),
  nombre      TEXT,
  rol         VARCHAR(20),
  accion      VARCHAR(30) NOT NULL,
  entidad     VARCHAR(40),
  entidad_id  TEXT,
  detalle     TEXT,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_auditoria_created ON auditoria(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario ON auditoria(usuario);

-- Usuarios iniciales (contraseñas hasheadas con scrypt; piden cambio en el 1er ingreso)
INSERT INTO usuarios (usuario, nombre, email, rol, password_hash, debe_cambiar, activo) VALUES
  ('admin', 'Cynthia Acosta', 'cynthia_acosta@hotmail.com', 'gerencia', 'scrypt$ed69af64b053501ac056eb2e0a0eac99$9d6ed22eb670447fa066d6191deb608eecbbaa6af446d680aca05a4be3ad970b672a121c34fd506b5b440ff6c0840839841dc027463ff0a8c4a605f6e77ae8a9', true, true),
  ('invitado', 'Diego Parras', NULL, 'auditor', 'scrypt$e698d389e8b9a9f75a66eb53ab6588e7$ab513af48d20b07f65ed87818a2e940b8d0e7ea9bdd839c87f8af26fdc456e5ade7d9684e9f6e8b2d6dad589bdae79f2ce80a2cdeadcd1389669101ab3e392a2', true, true),
  ('lcandia', 'Laura Candia', 'lcandia@colegiomedicocr.com.ar', 'analista', 'scrypt$117b9613172a998e8f1d5ddf0dff4789$979f8822227eb731f4e50a3700ab6866a4465e0e7a76dc53a876ce2ff94585055c335aff3936afbf44fef5b7f149f67ab6f01193797e361916636892f0b0bbca', true, true),
  ('skruger', 'Silvina Kruger', 'doriskruger465@gmail.com', 'coordinacion', 'scrypt$8b6ee37358010de1fddd0d416b1a3c83$a130402c83c06abeb8dca5b91fe81441f7c222ff2f109cb320ec1228371c35130a9288b12f42d40abcde19828c2ea2f5630f1385c915a9fcebfa3e453de95ef6', true, true)
ON CONFLICT (usuario) DO NOTHING;

COMMIT;
