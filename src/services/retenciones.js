'use strict';
const pool = require('../db/pool');

// ── Ganancias (RG830) ────────────────────────────────────────
// Escala RG830: importe = fijo + (base - excedente) * alicuota/100
// donde base = pago - mínimo_no_imponible. El % fijo se modela como un
// único tramo {desde:0, hasta:null, fijo:0, excedente:0, alicuota:X}.
// Si la retención calculada es menor a `retencionMinima`, no se retiene.
// Aplica la escala progresiva sobre el monto imponible (ya neto del mínimo).
function aplicarEscala(escala, imponible) {
  if (imponible <= 0) return { importe: 0, alicuota: 0 };
  const tramo = escala.find(t => imponible >= t.desde && (t.hasta === null || imponible <= t.hasta));
  if (!tramo) throw new Error(`Imponible ${imponible} fuera de escala`);
  const fijo = tramo.fijo || 0;
  const exc = tramo.excedente || 0;
  const importe = fijo + (imponible - exc) * (tramo.alicuota / 100);
  return { importe, alicuota: tramo.alicuota };
}

// Calcula la retención de Ganancias de UN régimen aplicando la lógica acumulada
// mensual de la RG830:
//   base_acum   = base de pagos anteriores del mes + base de este pago
//   imponible   = base_acum − mínimo no sujeto (se computa UNA sola vez)
//   ret_acum    = escala/alícuota sobre el imponible
//   a retener   = ret_acum − retención ya practicada en el mes (la diferencia)
// ctx = { proveedorId, periodo } (período 'YYYY-MM'); si falta, se trata como
// primer y único pago (acumulado previo = 0).
async function calcularRetencionGanancias(regimenCodigo, baseNueva, ctx = {}, retencionMinima = 240) {
  const { rows } = await pool.query(
    `SELECT escala_json, minimo_no_imponible
       FROM tablas_ret_ganancias
      WHERE regimen_codigo = $1
        AND vigencia_desde <= CURRENT_DATE
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= CURRENT_DATE)
      ORDER BY vigencia_desde DESC
      LIMIT 1`,
    [regimenCodigo]
  );
  if (rows.length === 0) throw new Error(`No hay tabla RG830 cargada para régimen: ${regimenCodigo}`);

  const escala = rows[0].escala_json;
  const mni = parseFloat(rows[0].minimo_no_imponible) || 0;

  // Acumulado previo del mes (pagos anteriores al mismo proveedor y régimen)
  let basePrev = 0, retPrev = 0;
  if (ctx.proveedorId && ctx.periodo) {
    const { rows: [acum] } = await pool.query(
      `SELECT COALESCE(SUM(base),0) AS base_prev, COALESCE(SUM(retencion),0) AS ret_prev
         FROM retenciones_acumuladas
        WHERE proveedor_id = $1 AND regimen_codigo = $2 AND periodo = $3`,
      [ctx.proveedorId, regimenCodigo, ctx.periodo]
    );
    basePrev = parseFloat(acum.base_prev) || 0;
    retPrev = parseFloat(acum.ret_prev) || 0;
  }

  const baseAcum = basePrev + baseNueva;
  const imponible = baseAcum - mni;            // el mínimo se resta UNA vez sobre el acumulado
  const { importe: retAcum, alicuota } = aplicarEscala(escala, imponible);

  let importe = redondear(retAcum - retPrev);  // solo la diferencia sobre lo ya retenido
  if (importe < 0) importe = 0;

  // Retención mínima de ley: solo en el primer pago del mes (sin retención previa)
  let debajoMinimo = false;
  if (retPrev === 0 && importe > 0 && importe < retencionMinima) {
    importe = 0;
    debajoMinimo = true;
  }

  return {
    base: baseNueva,                    // base bruta (neto) de ESTE pago, para acumular
    base_acumulada: redondear(baseAcum),
    imponible: redondear(Math.max(0, imponible)),
    alicuota,
    importe,
    ret_acumulada: redondear(retAcum),
    mni,
    debajoMinimo,
  };
}

// ── IVA ──────────────────────────────────────────────────────
// Base = IVA facturado; alícuota configurada por proveedor (80% / 100%).
function calcularRetencionIva(importeIva, alicuota) {
  if (!alicuota || alicuota <= 0) return { base: 0, alicuota: 0, importe: 0 };
  const importe = redondear(importeIva * (alicuota / 100));
  return { base: redondear(importeIva), alicuota, importe };
}

// ── Ingresos Brutos (provincial — Chubut por defecto) ────────
// Base = importe neto (sin IVA); alícuota configurada por proveedor.
// La alícuota y el régimen dependen de la jurisdicción y la actividad:
// el contador los carga en el ABM. La app aplica lo configurado.
function calcularRetencionIibb(importeNeto, alicuota) {
  if (!alicuota || alicuota <= 0) return { base: 0, alicuota: 0, importe: 0 };
  const importe = redondear(importeNeto * (alicuota / 100));
  return { base: redondear(importeNeto), alicuota, importe };
}

// ── SUSS (Seguridad Social — RG 1784, típicamente construcción) ──
// Base = importe bruto del pago; alícuota configurada por proveedor.
function calcularRetencionSuss(importeBruto, alicuota) {
  if (!alicuota || alicuota <= 0) return { base: 0, alicuota: 0, importe: 0 };
  const importe = redondear(importeBruto * (alicuota / 100));
  return { base: redondear(importeBruto), alicuota, importe };
}

// ── Orquestador por proveedor ────────────────────────────────
// Devuelve las cuatro retenciones + totales. Compatible con la
// estructura anterior (retGanancias, retIva, totalRetenciones, importeNetoPago).
async function calcularRetencionesOrden(proveedor, egresos, opciones = {}) {
  const importeBruto = egresos.reduce((s, e) => s + parseFloat(e.importe_total), 0);
  const importeNeto  = egresos.reduce((s, e) => s + parseFloat(e.importe_neto || 0), 0);
  const importeIva   = egresos.reduce((s, e) => s + parseFloat(e.importe_iva  || 0), 0);

  const vacio = { base: 0, alicuota: 0, importe: 0 };
  let retIva = { ...vacio }, retIibb = { ...vacio }, retSuss = { ...vacio };

  // Contexto para la acumulación mensual (RG830).
  // Importante: en la ejecución de la corrida el objeto trae `id` = id del egreso,
  // por eso priorizamos proveedor_id/prov_id ANTES que id.
  const proveedorId = opciones.proveedorId
    || proveedor.proveedor_id || proveedor.prov_id || proveedor.id || null;
  const periodo = opciones.periodo || new Date().toISOString().slice(0, 7);

  // ── Ganancias: una retención POR cada régimen presente en las facturas ──
  // La base es siempre el NETO (sin IVA). Agrupamos los egresos por su régimen.
  const porRegimen = new Map();
  if (proveedor.ret_ganancias) {
    for (const e of egresos) {
      const reg = e.regimen_ganancias;
      if (!reg) continue; // factura sin régimen asignado: no retiene ganancias
      const neto = parseFloat(e.importe_neto || 0);
      porRegimen.set(reg, (porRegimen.get(reg) || 0) + neto);
    }
  }

  const retencionesGanancias = [];
  for (const [regimen, baseNeto] of porRegimen) {
    const r = await calcularRetencionGanancias(regimen, baseNeto, { proveedorId, periodo });
    retencionesGanancias.push({ regimen, ...r });
  }
  const totalGanancias = redondear(retencionesGanancias.reduce((s, r) => s + r.importe, 0));
  // Agregado para la orden de pago y el PDF (una línea "Ret. Ganancias")
  const retGanancias = {
    base: redondear(retencionesGanancias.reduce((s, r) => s + (r.base || 0), 0)),
    alicuota: retencionesGanancias.length === 1 ? retencionesGanancias[0].alicuota : null,
    importe: totalGanancias,
  };

  // ── IVA: sobre el IVA facturado · IIBB: sobre el neto · SUSS: sobre el total ──
  if (proveedor.ret_iva && proveedor.ret_iva_alicuota) {
    retIva = calcularRetencionIva(importeIva, parseFloat(proveedor.ret_iva_alicuota));
  }
  if (proveedor.ret_iibb && proveedor.ret_iibb_alicuota) {
    retIibb = calcularRetencionIibb(importeNeto, parseFloat(proveedor.ret_iibb_alicuota));
  }
  if (proveedor.ret_suss && proveedor.ret_suss_alicuota) {
    retSuss = calcularRetencionSuss(importeBruto, parseFloat(proveedor.ret_suss_alicuota));
  }

  const totalRet = redondear(
    totalGanancias + retIva.importe + retIibb.importe + retSuss.importe
  );
  const importePago = redondear(importeBruto - totalRet);

  return {
    importeBruto: redondear(importeBruto),
    importeNeto: redondear(importeNeto),
    importeIva: redondear(importeIva),
    retGanancias,                 // agregado (para OP y PDF)
    retencionesGanancias,         // detalle por régimen (para certificados)
    retIva, retIibb, retSuss,
    totalRetenciones: totalRet,
    importeNetoPago: importePago,
  };
}

function redondear(n) { return Math.round(n * 100) / 100; }

module.exports = {
  calcularRetencionGanancias,
  calcularRetencionIva,
  calcularRetencionIibb,
  calcularRetencionSuss,
  calcularRetencionesOrden,
};
