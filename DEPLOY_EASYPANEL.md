# Deploy en EasyPanel — Portal de Cuentas a Pagar

Guía paso a paso para dejar el portal corriendo en tu VPS de OVH con EasyPanel,
usando tu **Postgres existente** (el mismo que usa TuFacturador) y el contenedor
de **Arcanum** que ya tenés andando.

> ⚠️ El portal guarda todas sus tablas en un schema propio llamado **`portal`**.
> No toca ni pisa las tablas de TuFacturador (que viven en `public`). Por eso es
> seguro compartir la misma base de datos.

---

## 1. Subir el código a un repo nuevo de GitHub

1. Creá un repo nuevo en GitHub, por ejemplo `portal-cuentas-pagar`.
2. Subí **el contenido de la carpeta `portal-cuentas-pagar/`** como raíz del repo
   (que el `Dockerfile`, `package.json`, `src/`, `public/` queden en la raíz, no
   dentro de otra subcarpeta).

---

## 2. Crear el servicio en EasyPanel

Para que el portal pueda hablar con Arcanum por red interna, conviene crearlo en
el **mismo proyecto de EasyPanel** donde está Arcanum.

1. Entrá al proyecto de EasyPanel donde corre Arcanum.
2. **+ Service → App**.
3. Nombre del servicio: **`portal-cuentas-pagar`**.
4. **Source**: GitHub → elegí el repo que creaste y la rama `main`.
5. **Build**: dejá el método **Dockerfile** (EasyPanel detecta el `Dockerfile` de
   la raíz automáticamente).
6. No hace falta tocar el puerto: la app escucha en el **3000** (ya viene
   configurado).

---

## 3. Variables de entorno

En la pestaña **Environment** del servicio, pegá esto y completá los valores:

```env
NODE_ENV=production
PORT=3000

# ── Base de datos (la MISMA que usás para TuFacturador) ──────────────
# Reutilizá exactamente la connection string de tu Postgres existente.
# El portal crea y usa su propio schema "portal", no pisa nada de TuFacturador.
DATABASE_URL=postgres://USUARIO:PASSWORD@HOST_INTERNO:5432/NOMBRE_BASE

# ── Arcanum (gateway ARCA) ──────────────────────────────────────────
# Si el portal está en el mismo proyecto que Arcanum, usá el nombre interno:
ARCANUM_URL=http://arcanum:8094
ARCANUM_API_KEY=la_misma_api_key_que_configuraste_en_arcanum

# ── Seguridad (login del portal) ────────────────────────────────────
SESSION_SECRET=GENERAR    # corré: openssl rand -hex 32 (firma la sesión)
PORTAL_ADMIN_PASS=elegí_una_contraseña   # con esta contraseña entrás al portal

# ── Datos de tu empresa (salen impresos en órdenes de pago y certificados) ──
EMPRESA_NOMBRE=Mi Empresa S.A.
EMPRESA_CUIT=30000000000
EMPRESA_DOMICILIO=Av. Ejemplo 1234, CABA

# ── Email (órdenes a proveedores y aprobaciones a gerencia) ─────────
# Si dejás SMTP_HOST vacío, los mails NO se envían de verdad (modo prueba).
SMTP_HOST=smtp.tuproveedor.com
SMTP_PORT=587
SMTP_SECURE=false           # true si tu proveedor usa SSL puerto 465
SMTP_USER=tucuenta@empresa.com
SMTP_PASS=tu_password_smtp
SMTP_FROM=pagos@empresa.com
EMAIL_INTERNO=contabilidad@empresa.com

# ── URL pública del portal (para el link de aprobación de gerencia) ──
# Completala DESPUÉS de saber el dominio (paso 4). Ej: https://portal-xxx.easypanel.host
BASE_URL=https://TU_DOMINIO
```

### Notas importantes

- **`DATABASE_URL`**: usá la misma que ya tenés andando con TuFacturador. El
  `HOST_INTERNO` suele ser el nombre del servicio Postgres dentro de EasyPanel.
  El usuario debe tener permiso para crear schemas (el dueño de la base lo tiene).
- **`ARCANUM_URL`**: `http://arcanum:8094` funciona solo si el portal está en el
  **mismo proyecto** que Arcanum. Si los pusieras en proyectos separados, usá la
  URL pública de Arcanum (`https://...`) en su lugar.
- **`BASE_URL`**: completala una vez que tengas el dominio del paso 4 y volvé a
  desplegar.

---

## 4. Dominio

En la pestaña **Domains** del servicio:

- **Opción simple**: tocá **Add Domain** y EasyPanel te asigna uno automático
  tipo `portal-cuentas-pagar-xxxx.easypanel.host`. Apuntalo al puerto **3000**.
- **Opción con dominio propio**: agregá tu subdominio (ej. `pagos.tuempresa.com`),
  apuntá el DNS a tu VPS y EasyPanel le saca el certificado HTTPS solo.

Después de elegir el dominio, copialo en la variable **`BASE_URL`** y volvé a
desplegar para que los links de aprobación salgan correctos.

---

## 5. Desplegar

1. Tocá **Deploy**.
2. Mirá los logs. En el primer arranque vas a ver:
   ```
   [server] ejecutando migraciones...
   [migrate] aplicada: 001_schema_inicial.sql
   [migrate] listo
   [server] Portal de Cuentas a Pagar corriendo en http://localhost:3000
   ```
   Eso significa que el schema `portal` y todas las tablas se crearon solas.
3. Abrí el dominio en el navegador. Deberías ver el panel del portal.

---

## 6. Tablas de retenciones RG 830 (se cargan solas)

El cálculo de retención de Ganancias usa las escalas y mínimos de la RG 830. Ya
vienen sembrados por la migración `003_seed_rg830_vigente.sql`, que corre sola al
desplegar (regímenes 94, 78, 30/31/32 y 119 con valores vigentes). No hay que
ejecutar ningún SQL a mano.

Importante (confirmar con el contador): el mínimo del régimen 78 quedó en $0 y los
regímenes 116/124 no se sembraron porque usan otra escala a validar. Para
actualizar valores cuando ARCA los cambie, se crea una nueva migración `004_…`.

---

## Resumen de lo que NO necesitás hacer

- ❌ No uses el `docker-compose.yml` del repo en EasyPanel: ese levanta un Postgres
  nuevo (`portal-db`), pensado solo para correr local. En EasyPanel apuntás a tu
  base existente con `DATABASE_URL`.
- ❌ No corras migraciones a mano: el server las ejecuta solo al arrancar.
- ❌ No vas a romper TuFacturador: el portal vive en su propio schema `portal`.
