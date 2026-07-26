const express = require("express");
const { pool } = require("./db");
const { todayStr, addDaysStr, round2 } = require("./utils");

const router = express.Router();

function wrap(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message || "Error interno" });
    });
  };
}

const CATEGORY_LABELS = {
  gasolina: "Gasolina",
  comida_jornada: "Comida / jornada",
  mantenimiento: "Mantenimiento",
  imprevistos: "Imprevistos",
  otro: "Otro",
};

router.get(
  "/metrics/resumen",
  wrap(async (req, res) => {
    const from = req.query.from || todayStr();
    const to = req.query.to || todayStr();

    const { rows: dayTotals } = await pool.query(
      `SELECT fecha, COALESCE(SUM(envio),0) AS envio, COALESCE(SUM(propina),0) AS propina, COUNT(*)::int AS n
       FROM trips WHERE fecha BETWEEN $1 AND $2 GROUP BY fecha ORDER BY fecha ASC`,
      [from, to]
    );
    const totals = dayTotals.map((r) => ({
      date: r.fecha.toISOString ? r.fecha.toISOString().slice(0, 10) : r.fecha,
      total: round2(Number(r.envio) + Number(r.propina)),
      viajes: r.n,
    }));
    const totalIngresos = round2(totals.reduce((s, d) => s + d.total, 0));
    const totalViajes = totals.reduce((s, d) => s + d.viajes, 0);
    const dias = totals.length;
    const promedio = dias ? round2(totalIngresos / dias) : 0;
    const mejor = totals.reduce((best, d) => (!best || d.total > best.total ? d : best), null);
    const peor = totals.reduce((worst, d) => (!worst || d.total < worst.total ? d : worst), null);

    const { rows: methodRows } = await pool.query(
      `SELECT metodo_cobro, COALESCE(SUM(envio + propina + costo_negocio),0) AS total
       FROM trips WHERE fecha BETWEEN $1 AND $2 GROUP BY metodo_cobro`,
      [from, to]
    );

    const { rows: categoryRows } = await pool.query(
      `SELECT categoria, COALESCE(SUM(monto),0) AS total, COUNT(*)::int AS n
       FROM gastos_calle WHERE fecha BETWEEN $1 AND $2 GROUP BY categoria ORDER BY total DESC`,
      [from, to]
    );

    const { rows: walletRows } = await pool.query(
      `SELECT w.id, w.name, w.color,
              COALESCE(SUM(t.monto) FILTER (WHERE t.slot_destino = 'cash'),0) AS cash,
              COALESCE(SUM(t.monto) FILTER (WHERE t.slot_destino = 'bank'),0) AS bank
       FROM wallets w
       LEFT JOIN transferencias t ON t.wallet_destino_id = w.id AND t.tipo = 'reparto' AND t.fecha BETWEEN $1 AND $2
       WHERE w.is_fondo = false
       GROUP BY w.id, w.name, w.color ORDER BY w.id ASC`,
      [from, to]
    );

    res.json({
      from,
      to,
      dias_con_registro: dias,
      total_ingresos: totalIngresos,
      total_viajes: totalViajes,
      promedio_diario: promedio,
      mejor_dia: mejor,
      peor_dia: peor,
      por_metodo_cobro: methodRows.map((r) => ({ metodo: r.metodo_cobro, total: round2(Number(r.total)) })),
      gastos_por_categoria: categoryRows.map((r) => ({
        categoria: r.categoria,
        label: CATEGORY_LABELS[r.categoria] || r.categoria,
        total: round2(Number(r.total)),
        promedio_dia: dias ? round2(Number(r.total) / dias) : 0,
        n: r.n,
      })),
      repartido_por_billetera: walletRows.map((r) => ({
        wallet_id: r.id,
        name: r.name,
        color: r.color,
        cash: round2(Number(r.cash)),
        bank: round2(Number(r.bank)),
        total: round2(Number(r.cash) + Number(r.bank)),
      })),
      serie_diaria: totals,
    });
  })
);

router.get(
  "/metrics/tips",
  wrap(async (req, res) => {
    const to = todayStr();
    const from = addDaysStr(to, -29);
    const tips = [];

    const { rows: fondoRows } = await pool.query(
      `SELECT COALESCE(AVG(fondo_gasolina),0) AS avg_gasolina, COALESCE(AVG(fondo_jornada),0) AS avg_jornada, COUNT(*)::int AS n
       FROM turnos WHERE fecha BETWEEN $1 AND $2 AND end_at IS NOT NULL`,
      [from, to]
    );
    const { rows: gastoRows } = await pool.query(
      `SELECT categoria, COALESCE(AVG(daily_total),0) AS avg_total FROM (
         SELECT fecha, categoria, SUM(monto) AS daily_total
         FROM gastos_calle WHERE fecha BETWEEN $1 AND $2
         GROUP BY fecha, categoria
       ) t GROUP BY categoria`,
      [from, to]
    );

    const fondo = fondoRows[0];
    if (fondo.n >= 3) {
      const gGas = gastoRows.find((r) => r.categoria === "gasolina");
      if (gGas && Number(gGas.avg_total) > Number(fondo.avg_gasolina) * 1.05) {
        tips.push(
          `En los últimos ${fondo.n} turnos cerrados, el gasto promedio en gasolina (${round2(
            Number(gGas.avg_total)
          )}) superó el fondo que le dan para eso (${round2(Number(fondo.avg_gasolina))}). Podría convenir subir ese fondo.`
        );
      }
      const gJornada = gastoRows.find((r) => r.categoria === "comida_jornada");
      if (gJornada && Number(gJornada.avg_total) > Number(fondo.avg_jornada) * 1.05) {
        tips.push(
          `El gasto promedio de jornada (${round2(Number(gJornada.avg_total))}) también superó su fondo asignado (${round2(
            Number(fondo.avg_jornada)
          )}). Vale la pena revisarlo.`
        );
      }
    }

    const { rows: overdueRows } = await pool.query(
      `SELECT c.name, c.amount, c.next_due_date, w.name AS wallet_name
       FROM commitments c JOIN wallets w ON w.id = c.wallet_id
       WHERE c.active = true AND c.next_due_date < $1 ORDER BY c.next_due_date ASC`,
      [to]
    );
    if (overdueRows.length > 0) {
      const lista = overdueRows.map((r) => `${r.name} (${r.wallet_name})`).join(", ");
      tips.push(
        `Tienen ${overdueRows.length} gasto${overdueRows.length > 1 ? "s" : ""} fijo${
          overdueRows.length > 1 ? "s" : ""
        } vencido${overdueRows.length > 1 ? "s" : ""}: ${lista}.`
      );
    }

    const { rows: dueThisWeekRows } = await pool.query(
      `SELECT c.name, c.next_due_date, w.name AS wallet_name
       FROM commitments c JOIN wallets w ON w.id = c.wallet_id
       WHERE c.active = true AND c.next_due_date >= $1 AND c.next_due_date <= ($1::date + INTERVAL '7 days')
       ORDER BY c.next_due_date ASC`,
      [to]
    );
    if (dueThisWeekRows.length > 0) {
      const lista = dueThisWeekRows
        .map((r) => `${r.name} (vence ${r.next_due_date.toISOString().slice(0, 10)})`)
        .join(", ");
      tips.push(`Vencen esta semana: ${lista}.`);
    }

    if (tips.length === 0) {
      tips.push("Todo en orden por ahora. Sigan registrando cada turno para que los consejos sean más precisos.");
    }

    res.json({ tips });
  })
);

module.exports = router;
