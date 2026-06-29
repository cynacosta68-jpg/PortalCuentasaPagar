/* Estilos complementarios — pantalla de egresos */

/* ─── Tabs ───────────────────────────────────────────── */
.tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
}

.tab {
  padding: 9px 18px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  font-family: var(--sans);
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color .15s, border-color .15s;
}

.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* ─── Upload zone ────────────────────────────────────── */
.upload-zone {
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  padding: 44px 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color .2s, background .2s;
  color: var(--text-muted);
}

.upload-zone:hover,
.upload-zone.drag-over {
  border-color: var(--accent);
  background: var(--accent-light);
  color: var(--accent);
}

.upload-icon { font-size: 36px; margin-bottom: 12px; }

/* ─── Monto negativo ─────────────────────────────────── */
.importe-negativo { color: var(--danger); }
