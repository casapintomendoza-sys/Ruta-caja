const express = require("express");
const { pool } = require("./db");
const {
  todayStr,
  addOneMonthClamped,
  daysBetween,
  monthsBetweenInclusive,
  round2,
} = require("./utils");

const router = express.Router();

function wrap(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: err.message || "Error interno" });
    });
  };
}

/* ============================= WALLETS ============================= */

router.get(
  "/wallets",
  wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM wallets ORDER BY id ASC");
    res.json(rows);
  })
);

router.post(
  "/wallets",
  wrap(async (req, res) => {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Falta el nombre" });
    const { rows } = await pool.query(
      "INSERT INTO wallets (name, color) VALUES ($1, $2) RETURNING *",
      [name.trim(), color || "#2F6E63"]
    );
    res.status(201).json(rows[0]);
  })
);

router.patch(
  "/wallets/:id",
  wrap(async (req, res) => {
    const { name, color } = req.body;
    const { rows } = await pool.query(
      "UPDATE wallets SET name = COALESCE($1, name), color = COALESCE($2, color) WHERE id = $3 RETURNING *",
      [name, color, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Billetera no encontrada" });
    res.json(rows[0]);
  })
);

router.delete(
  "/wallets/:id",
  wrap(async (req, res) => {
    await pool.query("DELETE FROM wallets WHERE id = $1", [req.params.id]);
    res.status(204).end();
  })
);

router.get(
  "/wallets/:id/movements",
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const { rows } = await pool.query(
      "SELECT * FROM wallet_movements WHERE wallet_id = $1 ORDER BY date DESC, id DESC LIMIT $2",
      [req.params.id, limit]
    );
    res.json(rows);
  })
);

// movimiento manual: ingreso o gasto suelto (no ligado a reparto ni a un compromiso)
router.post(
  "/wallets/:id/movement",
  wrap(async (req, res) => {
    const walletId = Number(req.params.id);
    const { type, amount, note } = req.body;
    if (!["ingreso", "gasto"].includes(type)) return res.status(400).json({ error: "Tipo inválido" });
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: "Monto inválido" });
    const signed = type === "gasto" ? -amt : amt;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE wallets SET balance = balance + $1 WHERE id = $2", [signed, walletId]);
      const { rows } = await client.query(
        `INSERT INTO wallet_movements (wallet_id, date, type, amount, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [walletId, todayStr(), type, signed, note || (type === "gasto" ? "Gasto" : "Ingreso manual")]
      );
      await client.query("COMMIT");
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ============================ COMMITMENTS ============================ */
// Gastos fijos programados dentro de una billetera (renta, tarjeta, préstamos...)

function toDateStr(d) {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

function commitmentView(c, today) {
  const nextDue = toDateStr(c.next_due_date);
  const endDate = toDateStr(c.end_date);
  const overdue = nextDue < today;
  const daysLeft = overdue ? 0 : daysBetween(today, nextDue);
  const dailyTarget = overdue ? null : round2(Number(c.amount) / Math.max(daysLeft, 1));
  let totalRemaining = null;
  if (c.recurring && endDate) {
    const months = Math.max(monthsBetweenInclusive(nextDue, endDate), 0);
    totalRemaining = round2(Number(c.amount) * months);
  }
  return {
    ...c,
    next_due_date: nextDue,
    end_date: endDate,
    amount: Number(c.amount),
    overdue,
    days_left: daysLeft,
    daily_target: dailyTarget,
    total_remaining_estimate: totalRemaining,
  };
}

router.get(
  "/wallets/:id/commitments",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      "SELECT * FROM commitments WHERE wallet_id = $1 AND active = true ORDER BY next_due_date ASC",
      [req.params.id]
    );
    const today = todayStr();
    res.json(rows.map((c) => commitmentView(c, today)));
  })
);

router.post(
  "/wallets/:id/commitments",
  wrap(async (req, res) => {
    const walletId = Number(req.params.id);
    const { name, amount, next_due_date, recurring, end_date } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Falta el nombre" });
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: "Monto inválido" });
    if (!next_due_date) return res.status(400).json({ error: "Falta la fecha de vencimiento" });
    const { rows } = await pool.query(
      `INSERT INTO commitments (wallet_id, name, amount, recurring, end_date, next_due_date)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [walletId, name.trim(), amt, recurring !== false, end_date || null, next_due_date]
    );
    res.status(201).json(commitmentView(rows[0], todayStr()));
  })
);

router.patch(
  "/commitments/:id",
  wrap(async (req, res) => {
    const { name, amount, next_due_date, recurring, end_date, active } = req.body;
    const { rows } = await pool.query(
      `UPDATE commitments SET
         name = COALESCE($1, name),
         amount = COALESCE($2, amount),
         next_due_date = COALESCE($3, next_due_date),
         recurring = COALESCE($4, recurring),
         end_date = COALESCE($5, end_date),
         active = COALESCE($6, active)
       WHERE id = $7 RETURNING *`,
      [name, amount, next_due_date, recurring, end_date, active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Compromiso no encontrado" });
    res.json(commitmentView(rows[0], todayStr()));
  })
);

router.delete(
  "/commitments/:id",
  wrap(async (req, res) => {
    await pool.query("DELETE FROM commitments WHERE id = $1", [req.params.id]);
    res.status(204).end();
  })
);

// marcar como pagado: resta de la billetera, registra el movimiento y reprograma si es recurrente
router.post(
  "/commitments/:id/pay",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: crows } = await client.query("SELECT * FROM commitments WHERE id = $1 FOR UPDATE", [id]);
      const commitment = crows[0];
      if (!commitment) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Compromiso no encontrado" });
      }
      const payAmount = req.body.amount != null ? Number(req.body.amount) : Number(commitment.amount);
      if (!payAmount || payAmount <= 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Monto inválido" });
      }

      await client.query("UPDATE wallets SET balance = balance - $1 WHERE id = $2", [
        payAmount,
        commitment.wallet_id,
      ]);
      await client.query(
        `INSERT INTO wallet_movements (wallet_id, date, type, amount, note, commitment_id)
         VALUES ($1, $2, 'pago_compromiso', $3, $4, $5)`,
        [commitment.wallet_id, todayStr(), -payAmount, `Pago: ${commitment.name}`, id]
      );

      let updated;
      if (commitment.recurring) {
        const newDue = addOneMonthClamped(commitment.next_due_date.toISOString().slice(0, 10));
        const stillActive = !commitment.end_date || newDue <= commitment.end_date.toISOString().slice(0, 10);
        const { rows } = await client.query(
          "UPDATE commitments SET next_due_date = $1, active = $2 WHERE id = $3 RETURNING *",
          [newDue, stillActive, id]
        );
        updated = rows[0];
      } else {
        const { rows } = await client.query(
          "UPDATE commitments SET active = false WHERE id = $1 RETURNING *",
          [id]
        );
        updated = rows[0];
      }

      const { rows: wrows } = await client.query("SELECT * FROM wallets WHERE id = $1", [commitment.wallet_id]);
      await client.query("COMMIT");
      res.json({ commitment: commitmentView(updated, todayStr()), wallet: wrows[0] });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ============================== MOVEMENTS ============================== */

router.get(
  "/movements",
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const { rows } = await pool.query(
      `SELECT m.*, w.name AS wallet_name, w.color AS wallet_color
       FROM wallet_movements m JOIN wallets w ON w.id = m.wallet_id
       ORDER BY m.date DESC, m.id DESC LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

/* ================================ TRIPS ================================ */

router.get(
  "/trips",
  wrap(async (req, res) => {
    const date = req.query.date || todayStr();
    const { rows } = await pool.query(
      "SELECT * FROM trips WHERE date = $1 ORDER BY id DESC",
      [date]
    );
    res.json(rows);
  })
);

router.post(
  "/trips",
  wrap(async (req, res) => {
    const { date, time, fare, tip, payment_method, note } = req.body;
    const fareNum = Number(fare);
    if (!date || !fareNum || fareNum <= 0) return res.status(400).json({ error: "Datos inválidos" });
    const { rows } = await pool.query(
      `INSERT INTO trips (date, time, fare, tip, payment_method, note)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [date, time || new Date().toTimeString().slice(0, 5), fareNum, Number(tip) || 0, payment_method || "efectivo", note || null]
    );
    res.status(201).json(rows[0]);
  })
);

router.delete(
  "/trips/:id",
  wrap(async (req, res) => {
    await pool.query("DELETE FROM trips WHERE id = $1", [req.params.id]);
    res.status(204).end();
  })
);

/* ============================== EXPENSES ============================== */

router.get(
  "/expenses",
  wrap(async (req, res) => {
    const date = req.query.date || todayStr();
    const { rows } = await pool.query(
      "SELECT * FROM daily_expenses WHERE date = $1 ORDER BY id DESC",
      [date]
    );
    res.json(rows);
  })
);

router.post(
  "/expenses",
  wrap(async (req, res) => {
    const { date, category, amount, payment_method, note } = req.body;
    const amt = Number(amount);
    if (!date || !category || !amt || amt <= 0) return res.status(400).json({ error: "Datos inválidos" });
    const { rows } = await pool.query(
      `INSERT INTO daily_expenses (date, category, amount, payment_method, note)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [date, category, amt, payment_method || "efectivo", note || null]
    );
    res.status(201).json(rows[0]);
  })
);

router.delete(
  "/expenses/:id",
  wrap(async (req, res) => {
    await pool.query("DELETE FROM daily_expenses WHERE id = $1", [req.params.id]);
    res.status(204).end();
  })
);

/* ================================ JORNADA ================================ */
// fondo del día + cierre de caja + reparto a billeteras

async function getOrCreateJornada(date) {
  const { rows } = await pool.query("SELECT * FROM jornadas WHERE date = $1", [date]);
  if (rows[0]) return rows[0];
  const { rows: inserted } = await pool.query(
    "INSERT INTO jornadas (date) VALUES ($1) RETURNING *",
    [date]
  );
  return inserted[0];
}

async function computeResumen(date) {
  const jornada = await getOrCreateJornada(date);
  const { rows: tripRows } = await pool.query(
    `SELECT payment_method, COALESCE(SUM(fare),0) AS fare, COALESCE(SUM(tip),0) AS tip, COUNT(*)::int AS n
     FROM trips WHERE date = $1 GROUP BY payment_method`,
    [date]
  );
  const { rows: expenseRows } = await pool.query(
    `SELECT payment_method, COALESCE(SUM(amount),0) AS total
     FROM daily_expenses WHERE date = $1 GROUP BY payment_method`,
    [date]
  );

  let tripsEfectivo = 0;
  let tripsDigital = 0;
  let tripCount = 0;
  let tips = 0;
  let fares = 0;
  for (const r of tripRows) {
    const subtotal = Number(r.fare) + Number(r.tip);
    tripCount += r.n;
    fares += Number(r.fare);
    tips += Number(r.tip);
    if (r.payment_method === "efectivo") tripsEfectivo += subtotal;
    else tripsDigital += subtotal;
  }
  let gastosEfectivo = 0;
  let gastosDigital = 0;
  for (const r of expenseRows) {
    if (r.payment_method === "efectivo") gastosEfectivo += Number(r.total);
    else gastosDigital += Number(r.total);
  }

  const fondoInicial =
    Number(jornada.fondo_trabajo) + Number(jornada.fondo_gasolina) + Number(jornada.fondo_jornada);
  const efectivoEsperado = round2(fondoInicial + tripsEfectivo - gastosEfectivo);
  const efectivoContado = jornada.efectivo_contado != null ? Number(jornada.efectivo_contado) : null;
  const diferencia = efectivoContado != null ? round2(efectivoContado - efectivoEsperado) : null;
  const dineroARepartir =
    efectivoContado != null ? round2(efectivoContado - fondoInicial + tripsDigital - gastosDigital) : null;

  return {
    date,
    jornada,
    fondo_inicial: round2(fondoInicial),
    total_viajes: tripCount,
    total_cobros: round2(fares),
    total_propinas: round2(tips),
    total_trips_efectivo: round2(tripsEfectivo),
    total_trips_digital: round2(tripsDigital),
    total_gastos_efectivo: round2(gastosEfectivo),
    total_gastos_digital: round2(gastosDigital),
    total_generado: round2(tripsEfectivo + tripsDigital),
    efectivo_esperado: efectivoEsperado,
    efectivo_contado: efectivoContado,
    diferencia,
    dinero_a_repartir: dineroARepartir,
    cerrado: jornada.cerrado,
    repartido: jornada.repartido,
  };
}

router.get(
  "/jornada/:date",
  wrap(async (req, res) => {
    res.json(await computeResumen(req.params.date));
  })
);

router.post(
  "/jornada/:date/fondo",
  wrap(async (req, res) => {
    const { date } = req.params;
    const { fondo_trabajo, fondo_gasolina, fondo_jornada } = req.body;
    await getOrCreateJornada(date);
    await pool.query(
      `UPDATE jornadas SET fondo_trabajo = $1, fondo_gasolina = $2, fondo_jornada = $3
       WHERE date = $4`,
      [Number(fondo_trabajo) || 0, Number(fondo_gasolina) || 0, Number(fondo_jornada) || 0, date]
    );
    res.json(await computeResumen(date));
  })
);

router.post(
  "/jornada/:date/cerrar",
  wrap(async (req, res) => {
    const { date } = req.params;
    const { efectivo_contado } = req.body;
    if (efectivo_contado === undefined || efectivo_contado === "") {
      return res.status(400).json({ error: "Falta el efectivo contado" });
    }
    await getOrCreateJornada(date);
    await pool.query(
      "UPDATE jornadas SET efectivo_contado = $1, cerrado = true WHERE date = $2",
      [Number(efectivo_contado), date]
    );
    res.json(await computeResumen(date));
  })
);

router.post(
  "/jornada/:date/reabrir",
  wrap(async (req, res) => {
    const { date } = req.params;
    await pool.query("UPDATE jornadas SET cerrado = false WHERE date = $1", [date]);
    res.json(await computeResumen(date));
  })
);

router.post(
  "/jornada/:date/repartir",
  wrap(async (req, res) => {
    const { date } = req.params;
    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    const valid = allocations.filter((a) => a.wallet_id && Number(a.amount) > 0);
    if (valid.length === 0) return res.status(400).json({ error: "No hay montos para repartir" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: jrows } = await client.query("SELECT * FROM jornadas WHERE date = $1 FOR UPDATE", [date]);
      const jornada = jrows[0];
      if (!jornada || !jornada.cerrado) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Primero deben cerrar la caja del día" });
      }
      if (jornada.repartido) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Este día ya fue repartido" });
      }
      for (const a of valid) {
        const amt = round2(Number(a.amount));
        await client.query("UPDATE wallets SET balance = balance + $1 WHERE id = $2", [amt, a.wallet_id]);
        await client.query(
          `INSERT INTO wallet_movements (wallet_id, date, type, amount, note)
           VALUES ($1, $2, 'reparto', $3, 'Reparto de la ruta del día')`,
          [a.wallet_id, date, amt]
        );
      }
      await client.query("UPDATE jornadas SET repartido = true WHERE date = $1", [date]);
      await client.query("COMMIT");
      res.json(await computeResumen(date));
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/jornada/:date/deshacer-reparto",
  wrap(async (req, res) => {
    const { date } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: movs } = await client.query(
        "SELECT * FROM wallet_movements WHERE date = $1 AND type = 'reparto'",
        [date]
      );
      for (const m of movs) {
        await client.query("UPDATE wallets SET balance = balance - $1 WHERE id = $2", [m.amount, m.wallet_id]);
      }
      await client.query("DELETE FROM wallet_movements WHERE date = $1 AND type = 'reparto'", [date]);
      await client.query("UPDATE jornadas SET repartido = false WHERE date = $1", [date]);
      await client.query("COMMIT");
      res.json(await computeResumen(date));
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/jornada/:date/allocations",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT m.wallet_id, w.name AS wallet_name, w.color AS wallet_color, m.amount
       FROM wallet_movements m JOIN wallets w ON w.id = m.wallet_id
       WHERE m.date = $1 AND m.type = 'reparto' ORDER BY m.id ASC`,
      [req.params.date]
    );
    res.json(rows);
  })
);

/* =============================== METRICS =============================== */

router.get(
  "/metrics/resumen",
  wrap(async (req, res) => {
    const from = req.query.from || todayStr();
    const to = req.query.to || todayStr();

    const { rows: dayTotals } = await pool.query(
      `SELECT date, COALESCE(SUM(fare),0) AS fare, COALESCE(SUM(tip),0) AS tip
       FROM trips WHERE date BETWEEN $1 AND $2 GROUP BY date ORDER BY date ASC`,
      [from, to]
    );
    const totals = dayTotals.map((r) => ({
      date: r.date.toISOString ? r.date.toISOString().slice(0, 10) : r.date,
      total: round2(Number(r.fare) + Number(r.tip)),
    }));
    const totalIngresos = round2(totals.reduce((s, d) => s + d.total, 0));
    const dias = totals.length;
    const promedio = dias ? round2(totalIngresos / dias) : 0;
    const mejor = totals.reduce((best, d) => (!best || d.total > best.total ? d : best), null);
    const peor = totals.reduce((worst, d) => (!worst || d.total < worst.total ? d : worst), null);

    const { rows: methodRows } = await pool.query(
      `SELECT payment_method, COALESCE(SUM(fare + tip),0) AS total
       FROM trips WHERE date BETWEEN $1 AND $2 GROUP BY payment_method`,
      [from, to]
    );

    const { rows: categoryRows } = await pool.query(
      `SELECT category, COALESCE(SUM(amount),0) AS total, COUNT(*)::int AS n
       FROM daily_expenses WHERE date BETWEEN $1 AND $2 GROUP BY category ORDER BY total DESC`,
      [from, to]
    );

    const { rows: walletRows } = await pool.query(
      `SELECT w.id, w.name, w.color, COALESCE(SUM(m.amount) FILTER (WHERE m.type = 'reparto'),0) AS total_repartido
       FROM wallets w LEFT JOIN wallet_movements m ON m.wallet_id = w.id AND m.date BETWEEN $1 AND $2
       GROUP BY w.id, w.name, w.color ORDER BY w.id ASC`,
      [from, to]
    );

    res.json({
      from,
      to,
      dias_con_registro: dias,
      total_ingresos: totalIngresos,
      promedio_diario: promedio,
      mejor_dia: mejor,
      peor_dia: peor,
      por_metodo_pago: methodRows.map((r) => ({ metodo: r.payment_method, total: round2(Number(r.total)) })),
      gastos_por_categoria: categoryRows.map((r) => ({
        categoria: r.category,
        total: round2(Number(r.total)),
        promedio_dia: dias ? round2(Number(r.total) / dias) : 0,
        n: r.n,
      })),
      repartido_por_billetera: walletRows.map((r) => ({
        wallet_id: r.id,
        name: r.name,
        color: r.color,
        total: round2(Number(r.total_repartido)),
      })),
      serie_diaria: totals,
    });
  })
);

router.get(
  "/metrics/tips",
  wrap(async (req, res) => {
    const to = todayStr();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 29);
    const from = fromDate.toISOString().slice(0, 10);

    const tips = [];

    const { rows: fondoRows } = await pool.query(
      `SELECT COALESCE(AVG(fondo_gasolina),0) AS avg_gasolina, COALESCE(AVG(fondo_jornada),0) AS avg_jornada, COUNT(*)::int AS n
       FROM jornadas WHERE date BETWEEN $1 AND $2 AND cerrado = true`,
      [from, to]
    );
    const { rows: gastoRows } = await pool.query(
      `SELECT category, COALESCE(AVG(daily_total),0) AS avg_total FROM (
         SELECT date, category, SUM(amount) AS daily_total
         FROM daily_expenses WHERE date BETWEEN $1 AND $2
         GROUP BY date, category
       ) t GROUP BY category`,
      [from, to]
    );

    const fondo = fondoRows[0];
    if (fondo.n >= 3) {
      const avgGasGasolina = gastoRows.find((r) => r.category === "gasolina");
      if (avgGasGasolina && Number(avgGasGasolina.avg_total) > Number(fondo.avg_gasolina) * 1.05) {
        tips.push(
          `En los últimos ${fondo.n} días cerrados, el gasto promedio en gasolina (${round2(
            Number(avgGasGasolina.avg_total)
          )}) superó el fondo que le dan para eso (${round2(Number(fondo.avg_gasolina))}). Podría convenir subir ese fondo.`
        );
      }
      const avgGasJornada = gastoRows.find((r) => r.category === "comida_jornada");
      if (avgGasJornada && Number(avgGasJornada.avg_total) > Number(fondo.avg_jornada) * 1.05) {
        tips.push(
          `El gasto promedio de jornada (${round2(Number(avgGasJornada.avg_total))}) también superó su fondo asignado (${round2(
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
      tips.push(`Tienen ${overdueRows.length} gasto${overdueRows.length > 1 ? "s" : ""} fijo${overdueRows.length > 1 ? "s" : ""} vencido${overdueRows.length > 1 ? "s" : ""}: ${lista}.`);
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
      tips.push("Todo en orden por ahora. Sigan registrando cada día para que los consejos sean más precisos.");
    }

    res.json({ tips });
  })
);

module.exports = router;
