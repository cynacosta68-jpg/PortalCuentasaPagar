'use strict';
const pool = require('../db/pool');

// Calcula retención de ganancias según RG830 para un proveedor dado un monto base
async function calcularRetencionGanancias(regimenCodigo, baseCalculo) {
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
  const mniNum = parseFloat(mni);
  const base = baseCalculo - mniNum;

  if (base <= 0) return { base: 0, alicuota: 0, importe: 0, mni: mniNum };

  // Buscar el tramo de la escala
  const tramo = escala.find(t =>
    base >= t.desde && (t.hasta === null || base <= t.hasta)
  );

  if (!tramo) throw new Error(`Base ${base} fuera de escala para régimen ${regimenCodigo}`);

  const importe = Math.max(tramo.minimo || 0, base * (tramo.alicuota / 100));

  return {
    base: redondear(base),
    alicuota: tramo.alicuota,
    importe: redondear(importe),
    mni: mniNum,
  };
}

// Calcula retención de IVA según condición fiscal del proveedor
// RI retiene 21% × alicuota (80% o 100% según corresponda)
function calcularRetencionIva(importeNeto, importeIva, alicuota) {
  if (!alicuota || alicuota <= 0) return { base: 0, alicuota: 0, importe: 0 };
  // La base de IVA retención es el IVA facturado
  const importe = redondear(importeIva * (alicuota / 100));
  return { base: redondear(importeIva), alicuota, importe };
}

// Agrupa egresos por proveedor y calcula retenciones totales de la corrida
async function calcularRetencionesOrden(proveedor, egresos) {
  const importeBruto = egresos.reduce((s, e) => s + parseFloat(e.importe_total), 0);
  const importeNeto = egresos.reduce((s, e) => s + parseFloat(e.importe_neto || 0), 0);
  const importeIva = egresos.reduce((s, e) => s + parseFloat(e.importe_iva || 0), 0);

  let retGanancias = { base: 0, alicuota: 0, importe: 0 };
  let retIva = { base: 0, alicuota: 0, importe: 0 };

  if (proveedor.ret_ganancias && proveedor.ret_ganancias_regimen) {
    retGanancias = await calcularRetencionGanancias(
      proveedor.ret_ganancias_regimen,
      importeNeto > 0 ? importeNeto : importeBruto
    );
  }

  if (proveedor.ret_iva && proveedor.ret_iva_alicuota) {
    retIva = calcularRetencionIva(importeNeto, importeIva, parseFloat(proveedor.ret_iva_alicuota));
  }

  const totalRet = redondear(retGanancias.importe + retIva.importe);
  const importePago = redondear(importeBruto - totalRet);

  return {
    importeBruto: redondear(importeBruto),
    retGanancias,
    retIva,
    totalRetenciones: totalRet,
    importeNetoPago: importePago,
  };
}

function redondear(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calcularRetencionGanancias, calcularRetencionIva, calcularRetencionesOrden };
