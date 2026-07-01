# Portal de Cuentas a Pagar

Sistema de gestión de egresos y pagos a proveedores para organizaciones argentinas
(pensado inicialmente para el ámbito de asociaciones y colegios médicos, pero
aplicable a cualquier PyME que opere con retenciones).

Integra con **Arcanum** (gateway ARCA/AFIP) para consultar el padrón de proveedores
y leer comprobantes electrónicos. Calcula retenciones de Ganancias según la RG 830
(con acumulación mensual), arma corridas de pago con circuito de aprobación por mail,
genera órdenes de pago y certificados de retención en PDF, y exporta el TXT para SICORE.

Arquitectura deliberadamente liviana: **Node.js sobre el módulo HTTP nativo**
(sin framework web) y **PostgreSQL**. Corre en un contenedor y está pensado para
desplegarse en **EasyPanel sobre VPS propio**, manteniendo los datos bajo control
del titular (Ley 25.326).

---

## Características

- **Multiusuario con roles y auditoría.** Login por usuario y contraseña, cuatro
  roles con permisos diferenciados, y un registro de auditoría de quién hizo qué.
- **ABM de Proveedores** con autocompletado desde ARCA (razón social, actividad,
  condición fiscal, domicilio) a partir del CUIT.
- **Carga de egresos** por tres vías: lectura del **QR** del comprobante,
  **extracción de datos desde el PDF**, o **carga manual**. En los tres casos se
  puede **guardar el PDF del comprobante** para consultarlo después.
- **Motor de retenciones RG 830 (Ganancias)** con acumulación mensual por proveedor,
  mínimos no sujetos a retención, escalas por régimen y emisión de certificados.
- **Corridas de pago** (inmediatas o planificadas) que agrupan egresos por proveedor,
  calculan las retenciones y generan las órdenes de pago.
- **Circuito de aprobación gerencial por mail**: se envía a Gerencia un correo
  minimalista con el total a pagar y un **PDF adjunto** con el detalle de comprobantes;
  un botón en el mail autoriza la corrida y cambia su estado en el sistema.
- **Datos del medio de pago** por corrida (transferencia: banco/CBU/titular;
  cheque: banco/número/fechas/titular).
- **Órdenes de pago y certificados de retención en PDF.**
- **Exportación TXT para SICORE** (formato de ancho fijo de 145 caracteres).
- **Descargas en Excel limpio** (.xlsx sin líneas divisorias) de corridas y egresos.
- **Dashboard gerencial** con egresos devengados, salida de fondos, egresos por
  proveedor, estado de pagos, próximos vencimientos y últimas consultas.
- **Consultas y reclamos**, con opción de **cargarlos desde un mail** recibido
  (matchea el proveedor por su dirección de correo).

---

## Arquitectura y stack

| Capa | Tecnología |
|---|---|
| Backend | Node.js (módulo `http` nativo, sin framework) |
| Base de datos | PostgreSQL (schema aislado `portal`, no toca `public`) |
| Frontend | HTML + CSS + JavaScript vanilla (sin build) |
| PDF | `pdfkit` (generación), `pdf-parse` + `pdfjs-dist` (lectura) |
| Excel | `exceljs` |
| Mail | `nodemailer` (SMTP) |
| QR | `jsqr` + `@napi-rs/canvas` (opcionales) |
| Integración fiscal | Arcanum (gateway ARCA/AFIP) vía HTTP |

Dependencias mínimas y ninguna nativa obligatoria: el hashing de contraseñas y la
firma de sesión usan el módulo `crypto` que ya trae Node.

### Estructura del proyecto

```
src/
  server.js              Servidor HTTP: ruteo, gate de sesión, control por rol, auditoría
  auth.js                Hashing (scrypt), tokens de sesión firmados, permisos por rol
  config.js              Lectura de variables de entorno
  db/
    pool.js              Pool de conexiones PostgreSQL
    migrate.js           Corre las migraciones pendientes al arrancar
    migrations/          Migraciones SQL versionadas (001..009)
  routes/
    auth.js              Login, logout, /me, cambio de contraseña
    usuarios.js          ABM de usuarios (solo Gerencia)
    auditoria.js         Consulta del registro de auditoría
    proveedores.js       ABM de proveedores + consulta a ARCA
    egresos.js           CRUD de egresos + guardado/visualización del comprobante PDF
    comprobantes.js      Parseo de QR y PDF de comprobantes
    pagos.js             Corridas, órdenes, certificados, aprobación gerencial
    dashboard.js         Métricas del panel
    descargas.js         Exportaciones (Excel y TXT SICORE)
    consultas.js         Consultas y reclamos
  services/
    retenciones.js       Cálculo RG830, acumulación mensual, vigencia de certificados
    siap.js              Generación del TXT SICORE (ancho fijo 145)
    pdf.js               Órdenes de pago, certificados y listado de corrida en PDF
    email.js             Envío de mails (aprobación, notificaciones)
    comprobante.js       Normalización de datos de comprobantes
    arca.js              Cliente del gateway Arcanum
    multipart.js         Parseo de multipart/form-data sin dependencias
    qrpdf.js             Lectura de QR embebido en PDF
public/
  *.html                 Pantallas (login, panel, proveedores, egresos, pagos,
                         seguimiento, consultas, descargas, usuarios, auditoría,
                         cambiar-password)
  js/                    Lógica de cada pantalla + app.js (utilidades globales)
  css/app.css            Estilos (paleta azul)
```

---

## Requisitos

- Node.js 20 o superior.
- PostgreSQL accesible.
- Arcanum corriendo y accesible (para la integración con ARCA).

---

## Instalación y despliegue

El despliegue habitual es en **EasyPanel** sobre VPS. El build usa `npm ci`, por lo
que `package.json` y `package-lock.json` deben estar siempre sincronizados.

1. Configurá las **variables de entorno** (ver tabla más abajo) en la sección
   *Environment* del servicio.
2. Implementá. Al arrancar, la app **corre automáticamente las migraciones
   pendientes** (crea el schema `portal`, las tablas y siembra los datos iniciales:
   escalas RG830 y los usuarios). No hay que correr nada a mano.

Para desarrollo local:

```bash
npm install
# exportar las variables de entorno (al menos DATABASE_URL)
npm start          # arranca el servidor (corre migraciones primero)
npm run migrate    # correr migraciones manualmente si se necesita
```

La app queda en el puerto `3000` (o el que indique `PORT`).

---

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `DATABASE_URL` | **Sí** | Cadena de conexión a PostgreSQL. Es la única que, si falta, impide arrancar. |
| `SESSION_SECRET` | Muy recomendada | Secreto para firmar las cookies de sesión. Si no se define, se genera uno aleatorio en cada arranque (las sesiones se invalidan al reiniciar). Usar 32 bytes en hex. |
| `DB_SCHEMA` | No | Schema de la base (por defecto `portal`). |
| `PORT` | No | Puerto (por defecto `3000`). |
| `NODE_ENV` | No | `production` activa la cookie `Secure`. |
| `BASE_URL` | Sí (para mails) | URL pública del portal. **Clave**: sin ella, el botón del mail de aprobación apunta a `localhost`. Sin barra final. |
| `ARCANUM_URL` | Sí (para ARCA) | URL del gateway Arcanum. |
| `ARCANUM_API_KEY` | Sí (para ARCA) | API key de Arcanum. |
| `ARCANUM_CUIT` | Sí (para padrón) | CUIT del certificado cargado en Arcanum (si no está, usa `EMPRESA_CUIT`). |
| `EMPRESA_NOMBRE` | Sí | Razón social (aparece en PDFs y como remitente de los mails). |
| `EMPRESA_CUIT` | Sí | CUIT de la organización. |
| `EMPRESA_DOMICILIO` | No | Domicilio (aparece en los PDFs). |
| `SMTP_HOST` | Sí (para mails) | Servidor SMTP saliente. |
| `SMTP_PORT` | No | Puerto SMTP (por defecto `587`). |
| `SMTP_SECURE` | No | `true` para SSL (465); `false` para STARTTLS (587). |
| `SMTP_USER` | Sí (para mails) | Usuario/casilla del SMTP. |
| `SMTP_PASS` | Sí (para mails) | Contraseña. En Gmail, **contraseña de aplicación** (no la normal). |
| `SMTP_FROM` | Sí (para mails) | Dirección remitente (en Gmail, igual a `SMTP_USER`). |
| `EMAIL_REMITENTE` / `EMAIL_INTERNO` | No | Direcciones auxiliares para notificaciones internas. |
| `PORTAL_ADMIN_PASS` | **Obsoleta** | Ya no se usa para el login (el acceso es por usuario contra la base). Se mantiene solo por compatibilidad. |

> **Nota SMTP:** conviene usar **Gmail** con contraseña de aplicación. Microsoft está
> retirando la autenticación básica de SMTP en cuentas personales de Hotmail/Outlook,
> por lo que esas casillas no sirven de forma confiable para **enviar** (sí para recibir).

---

## Usuarios, roles y permisos

El acceso es por **usuario y contraseña**. Las contraseñas se guardan **hasheadas con
scrypt** (no se almacenan en texto plano). En el **primer ingreso**, cada usuario debe
**cambiar su contraseña** obligatoriamente.

### Roles

| Capacidad | Gerencia | Coordinación | Analista Contable | Auditor |
|---|:---:|:---:|:---:|:---:|
| Ver todo | ✓ | ✓ | ✓ | ✓ |
| Cargar egresos / proveedores | ✓ | ✓ | ✓ | — |
| Armar / planificar corridas | ✓ | ✓ | ✓ | — |
| Autorizar corridas | ✓ | — | — | — |
| Ejecutar pagos | ✓ | ✓ | — | — |
| Gestionar usuarios | ✓ | — | — | — |
| Ver auditoría | ✓ | — | — | ✓ |

El control de permisos se aplica **en el servidor** (los endpoints devuelven 403 si el
rol no corresponde); el frontend además oculta los botones que el rol no puede usar.

### Gestión de usuarios

La pantalla **Usuarios** (solo Gerencia) permite dar de alta nuevos usuarios, cambiar
roles, activar/desactivar y resetear contraseñas. Al resetear o crear, el usuario
queda obligado a cambiar la contraseña en su próximo ingreso.

### Auditoría

La pantalla **Auditoría** (Gerencia y Auditor) muestra el registro de acciones:
usuario, rol, acción (crear/editar/eliminar/planificar/ejecutar/autorizar…), entidad
afectada, fecha y hora, con filtros por usuario, acción y rango de fechas. Las
contraseñas nunca se registran en el detalle.

---

## Migraciones

Se aplican en orden y quedan registradas en la tabla `_migraciones`. Se corren solas
al arrancar.

| Migración | Contenido |
|---|---|
| `001_schema_inicial` | Schema base: proveedores, egresos, corridas, órdenes, certificados, etc. |
| `002_retenciones_iibb_suss` | Estructuras para retenciones de IIBB y SUSS. |
| `003_seed_rg830_vigente` | Siembra de escalas y mínimos RG830 vigentes (regímenes 94, 78, 30/31/32, 119). |
| `004_regimenes_multiples` | Soporte de múltiples regímenes por proveedor. |
| `005_retencion_acumulada` | Acumulación mensual de retenciones por proveedor. |
| `006_cert_no_retencion` | Certificados de "no retención" cuando no se alcanza el mínimo. |
| `007_medio_pago_datos` | Datos de transferencia y cheque a nivel corrida. |
| `008_usuarios_auditoria` | Tablas `usuarios` y `auditoria`; siembra los usuarios iniciales. |
| `009_comprobante_pdf` | Columnas para guardar el PDF del comprobante junto al egreso. |

---

## Flujo de trabajo

1. **Proveedores:** se cargan (con autocompletado desde ARCA por CUIT).
2. **Egresos:** se cargan por QR, PDF o manual. Opcionalmente se guarda el PDF del
   comprobante, que luego se ve desde *Ver detalle*.
3. **Corrida de pago:** se seleccionan egresos pendientes; el sistema los agrupa por
   proveedor, calcula las retenciones RG830 (considerando la acumulación del mes) y
   arma la corrida con su medio de pago.
4. **Aprobación:** se envía a Gerencia un mail con el total y el PDF de detalle. El
   botón del mail autoriza la corrida (queda en estado *aprobada*).
5. **Ejecución:** se ejecuta la corrida; se generan las órdenes de pago y los
   certificados de retención en PDF, y los egresos pasan a *pagado*.
6. **SICORE:** se exporta el TXT de retenciones de Ganancias para importar en el
   aplicativo.

---

## Retenciones RG 830

- El cálculo considera la **acumulación mensual por proveedor**: suma lo pagado en el
  mes para determinar si se supera el **mínimo no sujeto a retención** de cada régimen.
- Cuando corresponde, emite el **certificado de retención**; si no se alcanza el
  mínimo, emite un **certificado de no retención**.
- Las **escalas y mínimos** vigentes se siembran con la migración `003`. Cuando ARCA
  publique nuevas tablas, se actualizan agregando una **nueva migración** (no se editan
  las ya aplicadas). Los regímenes 116 y 124 usan otra escala que debe confirmarse
  antes de sembrarlos.

> El sistema es una herramienta de apoyo. La responsabilidad fiscal de las
> liquidaciones es del usuario; conviene validar los cálculos con un contador,
> especialmente ante cambios normativos.

---

## Almacenamiento de comprobantes PDF

Los PDF de los comprobantes se guardan **dentro de PostgreSQL** (columna `BYTEA`),
no en disco ni en servicios externos. Esto:

- Sobrevive a los redeploys (el disco del contenedor es efímero; la base no).
- No requiere configurar volúmenes.
- Mantiene los datos en el servidor propio (soberanía de datos).

Límite de 10 MB por archivo. El botón *Ver comprobante* (en *Ver detalle* del egreso)
abre el PDF en el navegador.

---

## API (resumen de endpoints)

**Autenticación**
```
POST /api/auth/login            Ingreso (usuario + contraseña)
POST /api/auth/logout           Cierre de sesión
GET  /api/auth/me               Datos del usuario y permisos actuales
POST /api/auth/cambiar-password Cambio de contraseña
```

**Usuarios y auditoría** (según rol)
```
GET  /api/usuarios              Listado
POST /api/usuarios              Alta
PUT  /api/usuarios/:id          Edición (rol, datos, activo)
POST /api/usuarios/:id/reset-password
GET  /api/auditoria             Registro de auditoría (con filtros)
```

**Proveedores**
```
GET  /api/proveedores           Listado
GET  /api/proveedores/:id
POST /api/proveedores
PUT  /api/proveedores/:id
DELETE /api/proveedores/:id
GET  /api/proveedores/arca/:cuit   Consulta al padrón ARCA
```

**Egresos y comprobantes**
```
GET  /api/egresos                       Listado (con filtros)
GET  /api/egresos/:id
POST /api/egresos
PUT  /api/egresos/:id
DELETE /api/egresos/:id
POST /api/egresos/:id/comprobante       Subir el PDF del comprobante
GET  /api/egresos/:id/comprobante       Ver el PDF (inline)
POST /api/comprobantes/parse-qr         Leer datos desde el QR
POST /api/comprobantes/parse-pdf        Leer datos desde el PDF
GET  /api/comprobantes/qr-status        Estado de las librerías de lectura de QR
```

**Corridas de pago**
```
POST /api/corridas/preview              Previsualizar retenciones
POST /api/corridas                      Crear corrida
POST /api/corridas/:id/planificar       Enviar a aprobación (mail a gerencia)
GET  /api/corridas/:id/autorizar        Autorizar (link del mail, por token)
POST /api/corridas/:id/rechazar
POST /api/corridas/:id/reenviar-aprobacion
POST /api/corridas/:id/ejecutar         Ejecutar el pago (genera OP y certificados)
GET  /api/corridas  /  GET /api/corridas/:id
GET  /api/ordenes/:id/pdf               PDF de la orden de pago
GET  /api/certificados/:id/pdf          PDF del certificado de retención
POST /api/ordenes/:id/certificados/regenerar
```

**Descargas y panel**
```
GET  /api/descargas/egresos-csv         Excel de egresos
GET  /api/descargas/corridas-csv        Excel de corridas
GET  /api/descargas/siap-ganancias      TXT SICORE (Ganancias)
GET  /api/dashboard/*                   Métricas del panel
```

**Consultas y reclamos**
```
GET  /api/consultas  /  GET /api/consultas/:id
POST /api/consultas                     Alta manual
POST /api/consultas/desde-email         Alta desde un mail recibido
POST /api/consultas/:id/responder
POST /api/consultas/:id/cerrar
```

---

## Seguridad

- Contraseñas hasheadas con **scrypt** (sin dependencias externas).
- Sesión sin estado en **cookie firmada con HMAC-SHA256**, que lleva usuario y rol.
- **Control de acceso por rol en el servidor** (no solo en la interfaz).
- **Registro de auditoría** de todas las operaciones que modifican datos.
- Schema de base **aislado** (`portal`), sin tocar `public`.
- El link de aprobación del mail está protegido por su **propio token firmado**, con
  vencimiento a 72 horas.

---

## Dependencias

```
exceljs      Generación de planillas .xlsx
nodemailer   Envío de mails por SMTP
pdf-parse    Lectura de texto de PDFs
pdfkit       Generación de PDFs (órdenes, certificados, listados)
pg           Cliente PostgreSQL
qrcode       Generación de códigos QR
```

Opcionales (lectura de QR embebido en PDF): `@napi-rs/canvas`, `jsqr`, `pdfjs-dist`.

---

## Mantenimiento

- **Escalas RG830:** actualizar mediante una nueva migración cuando ARCA publique
  nuevas tablas. No editar migraciones ya aplicadas.
- **Sincronía de dependencias:** al agregar o cambiar una dependencia, actualizar
  `package.json` y `package-lock.json` juntos (el build usa `npm ci`).
- **Backups:** al guardarse todo (incluidos los PDF) en PostgreSQL, el backup de la
  base cubre la totalidad de la información.

---

## Créditos

La integración con ARCA/AFIP se apoya en **Arcanum**, cuyo autor original es
**Diego Alejandro Parras**. El resto del sistema (portal de cuentas a pagar, motor de
retenciones, corridas, multiusuario y auditoría) es desarrollo propio.
