<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pagos — Portal de Cuentas a Pagar</title>
  <link rel="stylesheet" href="/css/app.css">
</head>
<body>
  <nav class="sidebar">
    <div class="brand">
      <div class="brand-icon">CP</div>
      <span class="brand-name">Cuentas<br>a Pagar</span>
    </div>
    <ul class="nav-list">
      <li><a href="/" class="nav-link">⬛ Panel</a></li>
      <li><a href="/proveedores.html" class="nav-link">👥 Proveedores</a></li>
      <li><a href="/egresos.html" class="nav-link">📄 Egresos</a></li>
      <li><a href="/pagos.html" class="nav-link active">💸 Pagos</a></li>
      <li><a href="/seguimiento.html" class="nav-link">📊 Seguimiento</a></li>
      <li><a href="/consultas.html" class="nav-link">💬 Consultas</a></li>
      <li><a href="/descargas.html" class="nav-link">⬇ Descargas</a></li>
    </ul>
  </nav>

  <main class="content">
    <header class="topbar">
      <h1 class="page-title">Cargar pago</h1>
    </header>

    <!-- Panel de selección -->
    <div style="padding:20px 28px 0">
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px">
          <h3 class="card-title" style="margin:0">Partidas pendientes de pago</h3>
          <span class="text-muted" style="font-size:13px">Ordenadas de más antigua a más nueva por vto. de pago</span>
        </div>

        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th style="width:36px">
                  <input type="checkbox" id="chk-all" title="Seleccionar todas">
                </th>
                <th>Proveedor</th>
                <th>Comprobante</th>
                <th>Fecha comp.</th>
                <th>Vto. pago</th>
                <th>Concepto</th>
                <th class="text-right">Importe</th>
              </tr>
            </thead>
            <tbody id="partidas-body">
              <tr><td colspan="7" class="text-center text-muted">Cargando partidas...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- Barra de totales seleccionados -->
        <div id="barra-seleccion" style="display:none; margin-top:16px; padding:14px 16px; background:var(--bg); border-radius:var(--radius); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px">
          <div>
            <span class="text-muted" style="font-size:13px">Seleccionadas:</span>
            <strong id="sel-cantidad">0</strong> partidas —
            Total bruto: <strong id="sel-total" class="importe-grande">$ 0,00</strong>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-secondary" id="btn-planificar" disabled>
              📋 Planificar corrida
            </button>
            <button class="btn btn-primary" id="btn-generar" disabled>
              ⚡ Generar pago
            </button>
          </div>
        </div>
      </div>
    </div>
  </main>

  <!-- ══════════════════════════════════════════════════════
       MODAL PREVIEW DE CORRIDA
  ══════════════════════════════════════════════════════ -->
  <div class="modal-overlay hidden" id="modal-preview">
    <div class="modal" style="width:min(760px,96vw)">
      <div class="modal-header">
        <h2 class="modal-title" id="preview-titulo">Resumen de pago</h2>
        <button class="modal-close" id="preview-close">✕</button>
      </div>
      <div id="preview-alert"></div>

      <!-- Datos de la corrida -->
      <div class="form-grid" style="margin-bottom:16px">
        <div class="form-group">
          <label>Fecha de pago</label>
          <input type="date" id="p-fecha_pago" class="form-control">
        </div>
        <div class="form-group">
          <label>Medio de pago</label>
          <select id="p-medio_pago" class="form-control">
            <option value="Transferencia">Transferencia bancaria</option>
            <option value="Cheque">Cheque</option>
            <option value="Efectivo">Efectivo</option>
            <option value="Débito">Débito automático</option>
          </select>
        </div>
      </div>

      <div class="separator"></div>

      <!-- Tabla por proveedor con retenciones -->
      <h4 style="margin-bottom:12px; font-size:13px; color:var(--text-muted); text-transform:uppercase">
        Detalle por proveedor
      </h4>
      <div id="preview-ordenes"></div>

      <!-- Totales generales -->
      <div class="separator"></div>
      <div id="preview-totales" style="text-align:right"></div>

      <div class="modal-footer" id="preview-footer">
        <button class="btn btn-secondary" id="preview-cancel">Cancelar</button>
        <button class="btn btn-secondary" id="btn-confirmar-planificar" style="display:none">
          📋 Enviar a gerencia para aprobación
        </button>
        <button class="btn btn-primary" id="btn-confirmar-generar" style="display:none">
          ⚡ Confirmar y generar órdenes de pago
        </button>
      </div>
    </div>
  </div>

  <!-- Modal de email para planificación -->
  <div class="modal-overlay hidden" id="modal-planificar">
    <div class="modal" style="width:min(480px,96vw)">
      <div class="modal-header">
        <h2 class="modal-title">Enviar propuesta a gerencia</h2>
        <button class="modal-close" onclick="document.getElementById('modal-planificar').classList.add('hidden')">✕</button>
      </div>
      <p style="margin-bottom:16px; color:var(--text-muted); font-size:13px">
        Se enviará un mail a gerencia con el resumen de la corrida de pagos propuesta.
        Gerencia tendrá 72 hs para aprobar o rechazar desde el link que recibirá.
      </p>
      <div class="form-group">
        <label>Email de gerencia *</label>
        <input type="email" id="p-email-gerencia" class="form-control" placeholder="gerencia@empresa.com">
      </div>
      <div id="plan-alert"></div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('modal-planificar').classList.add('hidden')">Cancelar</button>
        <button class="btn btn-primary" id="btn-enviar-planificacion">Enviar a gerencia</button>
      </div>
    </div>
  </div>

  <!-- Modal éxito -->
  <div class="modal-overlay hidden" id="modal-exito">
    <div class="modal" style="width:min(480px,96vw); text-align:center">
      <div style="font-size:48px; margin-bottom:12px">✅</div>
      <h2 id="exito-titulo" style="margin-bottom:8px">¡Pago generado!</h2>
      <p id="exito-msg" class="text-muted" style="margin-bottom:20px"></p>
      <button class="btn btn-primary" onclick="location.href='/seguimiento.html'">Ver en Seguimiento</button>
      <button class="btn btn-secondary" style="margin-left:8px" onclick="document.getElementById('modal-exito').classList.add('hidden')">Cerrar</button>
    </div>
  </div>

  <script src="/js/app.js"></script>
  <script src="/js/pagos.js"></script>
</body>
</html>
