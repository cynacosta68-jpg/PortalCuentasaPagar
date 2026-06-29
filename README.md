# Portal de Cuentas a Pagar

Sistema de gestión de egresos y pagos a proveedores para PyMEs argentinas.  
Integra con **Arcanum** (gateway ARCA/AFIP) para datos de proveedores, retenciones y lectura de comprobantes.

## Características

- **ABM de Proveedores** con autocompletado desde ARCA (razón social, actividad, condición fiscal, domicilio)
- **Carga de egresos** por lectura de QR ARCA, extracción de PDF o carga manual
- **Motor de retenciones** según RG830 (ganancias) y RG2854 (IVA)
- **Corridas de pagos** con generación de órdenes de pago y certificados de retención
- **Flujo de aprobación gerencial** con link por mail
- **Notificación automática** a proveedores por mail (orden de pago + cert. retención)
- **Dashboard** con tendencia de egresos, top proveedores y estado de pagos
- **Exportaciones** CSV, TXT SIAP y reportes por período

## Prerequisitos

- Arcanum corriendo y accesible (ver [repositorio Arcanum](../))
- Docker y Docker Compose

## Instalación rápida

```bash
cp .env.example .env
# Completar .env con las variables requeridas
docker compose up -d
```

La app queda en el puerto `3000`. En EasyPanel, configurá los servicios por separado (igual que Arcanum).

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL |
| `ARCANUM_URL` | URL interna de Arcanum (ej: `http://arcanum:8094`) |
| `ARCANUM_API_KEY` | API key de Arcanum |
| `SESSION_SECRET` | Secreto para sesiones (32 bytes hex) |
| `PORTAL_ADMIN_PASS` | Contraseña del admin |
| `SMTP_*` | Configuración SMTP para envío de mails |

## Tablas RG830

Las escalas y mínimos vigentes (regímenes 94, 78, 30/31/32 y 119) se siembran
automáticamente con la migración `003_seed_rg830_vigente.sql` al desplegar.
No hace falta correr nada a mano.

Los valores de mínimos no sujetos y escalas se deben actualizar (editando una
nueva migración `004_…`) cuando ARCA publique nuevas tablas. Los regímenes 116 y
124 usan otra escala que debe confirmarse antes de sembrarlos.

## Roadmap

- [x] Schema DB completo
- [x] ABM Proveedores + integración ARCA
- [x] CRUD Egresos con exportación CSV
- [x] Motor de retenciones RG830/RG2854
- [x] Corridas de pago (inmediatas y planificadas)
- [x] Flujo de aprobación gerencial
- [ ] Lectura de QR ARCA en egresos
- [ ] Extracción de datos de PDF (comprobantes)
- [ ] Generación de PDF órdenes de pago
- [ ] Generación de TXT SIAP para retenciones
- [ ] Pantalla de Seguimiento
- [ ] Pantalla de Consultas y Reclamos
- [ ] Pantalla de Descargas/Reportes
- [ ] FAQ interactivo
