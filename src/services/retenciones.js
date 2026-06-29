'use strict';
const pool = require('../db/pool');

// ── Ganancias (RG830) ────────────────────────────────────────
// Escala RG830: importe = fijo + (base - excedente) * alicuota/100
// donde base = pago - mínimo_no_imponible. El % fijo se modela como un
// único tramo {desde:0, hasta:null, fijo:0, excedente:0, alicuota:X}.
// Si la retención calculada es menor a `retencionMinima`, no se retiene.
async function calcularRetencionGanancias(regimenCodigo, baseCalculo, retencionMinima = 240) {
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

  if (rows.length === 0) {
    throw new Error(`No hay tabla RG830 cargada para régimen: ${regimenCodigo}`);
  }

  const { escala_json: escala, minimo_no_imponible: mni } = rows[0];
  const mniNum = parseFloat(mni) || 0;
  const base = baseCalculo - mniNum;

  if (base <= 0) return { base: 0, alicuota: 0, importe: 0, mni: mniNum };

  const tramo = escala.find(t =>
    base >= t.desde && (t.hasta === null || base <= t.hasta)
  );
  if (!tramo) throw new Error(`Base ${base} fuera de escala para régimen ${regimenCodigo}`);

  const fijo = tramo.fijo || 0;
  const exc = tramo.excedente || 0;
  const importe = redondear(fijo + (base - exc) * (tramo.alicuota / 100));

  // Retención mínima: si el calculado es menor, no se retiene.
  if (importe < retencionMinima) {
    return { base: redondear(base), alicuota: tramo.alicuota, importe: 0, mni: mniNum, debajoMinimo: true };
  }

  return { base: redondear(base), alicuota: tramo.alicuota, importe, mni: mniNum };
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
async function calcularRetencionesOrden(proveedor, egresos) {
  const importeBruto = egresos.reduce((s, e) => s + parseFloat(e.importe_total), 0);
  const importeNeto  = egresos.reduce((s, e) => s + parseFloat(e.importe_neto || 0), 0);
  const importeIva   = egresos.reduce((s, e) => s + parseFloat(e.importe_iva  || 0), 0);
  const baseGananciasOIibb = importeNeto > 0 ? importeNeto : importeBruto;

  const vacio = { base: 0, alicuota: 0, importe: 0 };
  let retGanancias = { ...vacio }, retIva = { ...vacio }, retIibb = { ...vacio }, retSuss = { ...vacio };

  if (proveedor.ret_ganancias && proveedor.ret_ganancias_regimen) {
    retGanancias = await calcularRetencionGanancias(proveedor.ret_ganancias_regimen, baseGananciasOIibb);
  }
  if (proveedor.ret_iva && proveedor.ret_iva_alicuota) {
    retIva = calcularRetencionIva(importeIva, parseFloat(proveedor.ret_iva_alicuota));
  }
  if (proveedor.ret_iibb && proveedor.ret_iibb_alicuota) {
    retIibb = calcularRetencionIibb(baseGananciasOIibb, parseFloat(proveedor.ret_iibb_alicuota));
  }
  if (proveedor.ret_suss && proveedor.ret_suss_alicuota) {
    retSuss = calcularRetencionSuss(importeBruto, parseFloat(proveedor.ret_suss_alicuota));
  }

  const totalRet = redondear(
    retGanancias.importe + retIva.importe + retIibb.importe + retSuss.importe
  );
  const importePago = redondear(importeBruto - totalRet);

  return {
    importeBruto: redondear(importeBruto),
    retGanancias, retIva, retIibb, retSuss,
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
