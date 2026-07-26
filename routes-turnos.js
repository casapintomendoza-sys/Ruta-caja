const express = require("express");
const { pool } = require("./db");
const { broadcastSync } = require("./io");
const { todayStr, nowInfo, infoFromInstant, round2 } = require("./utils");
const { applyDelta, getFondo, walletView } = require("./wallet-helpers");

const router = express.Router();

function wrap(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message || "Error interno" });
    });
  };
}

function tripEffect(trip) {
  const costo = Number(trip.costo_negocio) || 0;
  const total = costo + (Number(trip.envio) || 0) + (Number(trip.propina) || 0);
  if (trip.metodo_cobro === "efectivo") {
    return { cash: total - costo, bank: 0 };
  }
  return { cash: -costo, bank: total };
}

function gastoEffect(gasto) {
  const monto = Number(gasto.monto) || 0;
  if (gasto.metodo_pago === "efectivo") return { cash: -monto, bank: 0 };
  return { cash: 0, bank: -monto };
}

async function applyTripEffect(client, trip, sign = 1) {
  const fondo = await getFondo(client);
  const eff = tripEffect(trip);
  if (eff.cash) await applyDelta(client, fondo.id, "cash", eff.cash * sign);
  if (eff.bank) await applyDelta(client, fondo.id, "bank", eff.bank * sign);
}

async function applyGastoEffect(client, gasto, sign = 1) {
  const fondo = await getFondo(client);
  const eff = gastoEffect(gasto);
  if (eff.cash) await applyDelta(client, fondo.id, "cash", eff.cash * sign);
  if (eff.bank) await applyDelta(client, fondo.id, "bank", eff.bank * sign);
}

async function computeTurnoMetrics(turnoId, turnoRow) {
  const { rows: trips } = await pool.query("SELECT * FROM trips WHERE turno_id = $1", [turnoId]);
  const { rows: gastos } = await pool.query("SELECT * FROM gastos_calle WHERE turno_id = $1", [turnoId]);

  let ingresoBruto = 0;
  let totalCostoNegocio = 0;
  let cashTrips = 0;
  let bankTrips = 0;
  for (const t of trips) {
    ingresoBruto += Number(t.envio) + Number(t.propina);
    totalCostoNegocio += Number(t.costo_negocio);
    const eff = tripEffect(t);
    cashTrips += eff.cash;
    bankTrips += eff.bank;
  }
  let gastoTotal = 0;
  let cashGastos = 0;
  let bankGastos = 0;
  for (const g of gastos) {
    gastoTotal += Number(g.monto);
    const eff = gastoEffect(g);
    cashGastos += eff.cash;
    bankGastos += eff.bank;
  }

  const startAt = new Date(turnoRow.start_at);
  const endAt = turnoRow.end_at ? new Date(turnoRow.end_at) : new Date();
  const duracionHoras = Math.max((endAt - startAt) / 3600000, 0);
  const fondoInicial = round2(
    Number(turnoRow.fondo_trabajo) + Number(turnoRow.fondo_gasolina) + Number(turnoRow.fondo_jornada)
  );

  const efectivoEsperado = round2(fondoInicial + cashTrips + cashGastos);
  const efectivoContado = turnoRow.efectivo_contado != null ? Number(turnoRow.efectivo_contado) : null;
  const diferencia = efectivoContado != null ? round2(efectivoContado - efectivoEsperado) : null;
  const dineroARepartirCash = efectivoContado != null ? round2(efectivoContado - fondoInicial) : null;
  const dineroARepartirBank = round2(bankTrips + bankGastos);

  return {
    trips,
    gastos,
    viajes_count: trips.length,
    ingreso_bruto: round2(ingresoBruto),
    total_costo_negocio: round2(totalCostoNegocio),
    gasto_calle_total: round2(gastoTotal),
    neto: round2(ingresoBruto - gastoTotal),
    duracion_horas: round2(duracionHoras),
    promedio_viaje: trips.length ? round2(ingresoBruto / trips.length) : 0,
    promedio_hora: duracionHoras > 0 ? round2(ingresoBruto / duracionHoras) : 0,
    fondo_inicial: fondoInicial,
    efectivo_esperado: efectivoEsperado,
    efectivo_contado: efectivoContado,
    diferencia,
    dinero_a_repartir_cash: dineroARepartirCash,
    dinero_a_repartir_bank: dineroARepartirBank,
  };
}

async function turnoView(row) {
  const metrics = await computeTurnoMetrics(row.id, row);
  const { trips, gastos, ...rest } = metrics;
  return {
    ...row,
    fondo_trabajo: Number(row.fondo_trabajo),
    fondo_gasolina: Number(row.fondo_gasolina),
    fondo_jornada: Number(row.fondo_jornada),
    meta_diaria: row.meta_diaria != null ? Number(row.meta_diaria) : null,
    activo: row.end_at == null,
    ...rest,
  };
}

/* ================================= TURNOS ================================= */

router.get(
  "/turnos/activo",
  wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM turnos WHERE end_at IS NULL ORDER BY id DESC LIMIT 1");
    if (!rows[0]) return res.json(null);
    res.json(await turnoView(rows[0]));
  })
);

router.get(
  "/turnos",
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { rows } = await pool.query(
      "SELECT * FROM turnos WHERE end_at IS NOT NULL ORDER BY start_at DESC LIMIT $1",
      [limit]
    );
    res.json(await Promise.all(rows.map(turnoView)));
  })
);

router.get(
  "/turnos/:id",
  wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM turnos WHERE id = $1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Turno no encontrado" });
    const metrics = await computeTurnoMetrics(req.params.id, rows[0]);
    res.json({ ...(await turnoView(rows[0])), trips: metrics.trips, gastos: metrics.gastos });
  })
);

router.post(
  "/turnos/iniciar",
  wrap(async (req, res) => {
    const { rows: activos } = await pool.query("SELECT id FROM turnos WHERE end_at IS NULL LIMIT 1");
    if (activos[0]) return res.status(400).json({ error: "Ya hay un turno activo" });

    const { fondo_trabajo, fondo_gasolina, fondo_jornada, meta_diaria, start_at } = req.body;
    const startInstant = start_at ? new Date(start_at) : new Date();
    const { fecha } = infoFromInstant(startInstant);

    const { rows } = await pool.query(
      `INSERT INTO turnos (start_at, fecha, fondo_trabajo, fondo_gasolina, fondo_jornada, meta_diaria)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        startInstant.toISOString(),
        fecha,
        Number(fondo_trabajo) || 0,
        Number(fondo_gasolina) || 0,
        Number(fondo_jornada) || 0,
        meta_diaria ? Number(meta_diaria) : null,
      ]
    );
    broadcastSync("turnos");
    res.status(201).json(await turnoView(rows[0]));
  })
);

router.post(
  "/turnos/:id/terminar",
  wrap(async (req, res) => {
    const endInstant = req.body.end_at ? new Date(req.body.end_at) : new Date();
    const { rows } = await pool.query(
      "UPDATE turnos SET end_at = $1 WHERE id = $2 AND end_at IS NULL RETURNING *",
      [endInstant.toISOString(), req.params.id]
    );
    if (!rows[0]) return res.status(400).json({ error: "Este turno ya estaba terminado" });
    broadcastSync("turnos");
    res.json(await turnoView(rows[0]));
  })
);

router.patch(
  "/turnos/:id",
  wrap(async (req, res) => {
    const { start_at, end_at, meta_diaria, fondo_trabajo, fondo_gasolina, fondo_jornada } = req.body;
    const { rows } = await pool.query(
      `UPDATE turnos SET
         start_at = COALESCE($1, start_at),
         end_at = COALESCE($2, end_at),
         meta_diaria = COALESCE($3, meta_diaria),
         fondo_trabajo = COALESCE($4, fondo_trabajo),
         fondo_gasolina = COALESCE($5, fondo_gasolina),
         fondo_jornada = COALESCE($6, fondo_jornada)
       WHERE id = $7 RETURNING *`,
      [
        start_at ? new Date(start_at).toISOString() : null,
        end_at ? new Date(end_at).toISOString() : null,
        meta_diaria != null ? Number(meta_diaria) : null,
        fondo_trabajo != null ? Number(fondo_trabajo) : null,
        fondo_gasolina != null ? Number(fondo_gasolina) : null,
        fondo_jornada != null ? Number(fondo_jornada) : null,
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: "Turno no encontrado" });
    broadcastSync("turnos");
    res.json(await turnoView(rows[0]));
  })
);

router.post(
  "/turnos/:id/cerrar-caja",
  wrap(async (req, res) => {
    const { efectivo_contado } = req.body;
    if (efectivo_contado === undefined || efectivo_contado === "") {
      return res.status(400).json({ error: "Falta el efectivo contado" });
    }
    const { rows: trows } = await pool.query("SELECT * FROM turnos WHERE id = $1", [req.params.id]);
    if (!trows[0]) return res.status(404).json({ error: "Turno no encontrado" });
    if (trows[0].end_at == null) return res.status(400).json({ error: "Primero terminen el turno" });
    const { rows } = await pool.query(
      "UPDATE turnos SET efectivo_contado = $1 WHERE id = $2 RETURNING *",
      [Number(efectivo_contado), req.params.id]
    );
    broadcastSync("turnos");
    res.json(await turnoView(rows[0]));
  })
);

router.post(
  "/turnos/:id/reabrir-caja",
  wrap(async (req, res) => {
    const { rows: trows } = await pool.query("SELECT repartido FROM turnos WHERE id = $1", [req.params.id]);
    if (trows[0]?.repartido) return res.status(400).json({ error: "Deshagan el reparto primero" });
    const { rows } = await pool.query(
      "UPDATE turnos SET efectivo_contado = NULL WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    broadcastSync("turnos");
    res.json(await turnoView(rows[0]));
  })
);

router.post(
  "/turnos/:id/repartir",
  wrap(async (req, res) => {
    const turnoId = Number(req.params.id);
    const allocations = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    const valid = allocations.filter((a) => a.wallet_id && (Number(a.cash) > 0 || Number(a.bank) > 0));
    if (valid.length === 0) return res.status(400).json({ error: "No hay montos para repartir" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: trows } = await client.query("SELECT * FROM turnos WHERE id = $1 FOR UPDATE", [turnoId]);
      const turno = trows[0];
      if (!turno || turno.efectivo_contado == null) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Primero cierren la caja de este turno" });
      }
      if (turno.repartido) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Este turno ya fue repartido" });
      }
      const fondo = await getFondo(client);
      const { hora } = nowInfo();
      const fecha = todayStr();

      for (const a of valid) {
        const cash = round2(Number(a.cash) || 0);
        const bank = round2(Number(a.bank) || 0);
        if (cash > 0) {
          await applyDelta(client, fondo.id, "cash", -cash);
          await applyDelta(client, a.wallet_id, "cash", cash);
          await client.query(
            `INSERT INTO transferencias (tipo, turno_id, wallet_origen_id, slot_origen, wallet_destino_id, slot_destino, monto, nota, fecha, hora)
             VALUES ('reparto', $1, $2, 'cash', $3, 'cash', $4, 'Reparto del turno', $5, $6)`,
            [turnoId, fondo.id, a.wallet_id, cash, fecha, hora]
          );
        }
        if (bank > 0) {
          await applyDelta(client, fondo.id, "bank", -bank);
          await applyDelta(client, a.wallet_id, "bank", bank);
          await client.query(
            `INSERT INTO transferencias (tipo, turno_id, wallet_origen_id, slot_origen, wallet_destino_id, slot_destino, monto, nota, fecha, hora)
             VALUES ('reparto', $1, $2, 'bank', $3, 'bank', $4, 'Reparto del turno', $5, $6)`,
            [turnoId, fondo.id, a.wallet_id, bank, fecha, hora]
          );
        }
      }
      await client.query("UPDATE turnos SET repartido = true WHERE id = $1", [turnoId]);
      await client.query("COMMIT");
      broadcastSync("turnos");
      const { rows: fresh } = await pool.query("SELECT * FROM turnos WHERE id = $1", [turnoId]);
      res.json(await turnoView(fresh[0]));
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/turnos/:id/deshacer-reparto",
  wrap(async (req, res) => {
    const turnoId = Number(req.params.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: movs } = await client.query(
        "SELECT * FROM transferencias WHERE turno_id = $1 AND tipo = 'reparto'",
        [turnoId]
      );
      for (const m of movs) {
        await applyDelta(client, m.wallet_origen_id, m.slot_origen, Number(m.monto));
        await applyDelta(client, m.wallet_destino_id, m.slot_destino, -Number(m.monto));
      }
      await client.query("DELETE FROM transferencias WHERE turno_id = $1 AND tipo = 'reparto'", [turnoId]);
      await client.query("UPDATE turnos SET repartido = false WHERE id = $1", [turnoId]);
      await client.query("COMMIT");
      broadcastSync("turnos");
      const { rows: fresh } = await pool.query("SELECT * FROM turnos WHERE id = $1", [turnoId]);
      res.json(await turnoView(fresh[0]));
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/turnos/:id/allocations",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT t.*, w.name AS wallet_name, w.color AS wallet_color
       FROM transferencias t JOIN wallets w ON w.id = t.wallet_destino_id
       WHERE t.turno_id = $1 AND t.tipo = 'reparto' ORDER BY t.id ASC`,
      [req.params.id]
    );
    res.json(rows);
  })
);

router.delete(
  "/turnos/:id",
  wrap(async (req, res) => {
    const turnoId = Number(req.params.id);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: reparto } = await client.query(
        "SELECT * FROM transferencias WHERE turno_id = $1 AND tipo = 'reparto'",
        [turnoId]
      );
      for (const m of reparto) {
        await applyDelta(client, m.wallet_origen_id, m.slot_origen, Number(m.monto));
        await applyDelta(client, m.wallet_destino_id, m.slot_destino, -Number(m.monto));
      }
      await client.query("DELETE FROM transferencias WHERE turno_id = $1", [turnoId]);

      const { rows: trips } = await client.query("SELECT * FROM trips WHERE turno_id = $1", [turnoId]);
      for (const t of trips) await applyTripEffect(client, t, -1);
      await client.query("DELETE FROM trips WHERE turno_id = $1", [turnoId]);

      const { rows: gastos } = await client.query("SELECT * FROM gastos_calle WHERE turno_id = $1", [
        turnoId,
      ]);
      for (const g of gastos) await applyGastoEffect(client, g, -1);
      await client.query("DELETE FROM gastos_calle WHERE turno_id = $1", [turnoId]);

      await client.query("DELETE FROM turnos WHERE id = $1", [turnoId]);
      await client.query("COMMIT");
      broadcastSync("turnos");
      res.status(204).end();
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ================================= TRIPS ================================= */

router.get(
  "/trips",
  wrap(async (req, res) => {
    const { turno_id, fecha } = req.query;
    if (turno_id) {
      const { rows } = await pool.query("SELECT * FROM trips WHERE turno_id = $1 ORDER BY id DESC", [
        turno_id,
      ]);
      return res.json(rows);
    }
    const { rows } = await pool.query("SELECT * FROM trips WHERE fecha = $1 ORDER BY id DESC", [
      fecha || todayStr(),
    ]);
    res.json(rows);
  })
);

router.post(
  "/trips",
  wrap(async (req, res) => {
    const { turno_id, negocio, costo_negocio, envio, propina, metodo_cobro } = req.body;
    const env = Number(envio) || 0;
    const prop = Number(propina) || 0;
    if (env <= 0 && prop <= 0) return res.status(400).json({ error: "Escribe el envío o la propina" });
    const { fecha, hora } = nowInfo();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO trips (turno_id, negocio, costo_negocio, envio, propina, metodo_cobro, fecha, hora)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          turno_id || null,
          negocio || null,
          Number(costo_negocio) || 0,
          env,
          prop,
          metodo_cobro || "efectivo",
          fecha,
          hora,
        ]
      );
      await applyTripEffect(client, rows[0], 1);
      await client.query("COMMIT");
      broadcastSync("turnos");
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.patch(
  "/trips/:id",
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: old } = await client.query("SELECT * FROM trips WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      if (!old[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Viaje no encontrado" });
      }
      await applyTripEffect(client, old[0], -1);

      const { negocio, costo_negocio, envio, propina, metodo_cobro } = req.body;
      const merged = {
        negocio: negocio !== undefined ? negocio : old[0].negocio,
        costo_negocio: costo_negocio !== undefined ? Number(costo_negocio) : Number(old[0].costo_negocio),
        envio: envio !== undefined ? Number(envio) : Number(old[0].envio),
        propina: propina !== undefined ? Number(propina) : Number(old[0].propina),
        metodo_cobro: metodo_cobro || old[0].metodo_cobro,
      };
      const { rows } = await client.query(
        `UPDATE trips SET negocio=$1, costo_negocio=$2, envio=$3, propina=$4, metodo_cobro=$5 WHERE id=$6 RETURNING *`,
        [merged.negocio, merged.costo_negocio, merged.envio, merged.propina, merged.metodo_cobro, req.params.id]
      );
      await applyTripEffect(client, rows[0], 1);
      await client.query("COMMIT");
      broadcastSync("turnos");
      res.json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.delete(
  "/trips/:id",
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM trips WHERE id = $1 FOR UPDATE", [req.params.id]);
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Viaje no encontrado" });
      }
      await applyTripEffect(client, rows[0], -1);
      await client.query("DELETE FROM trips WHERE id = $1", [req.params.id]);
      await client.query("COMMIT");
      broadcastSync("turnos");
      res.status(204).end();
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ============================== GASTOS DE CALLE ============================== */

router.get(
  "/gastos-calle",
  wrap(async (req, res) => {
    const { turno_id, fecha } = req.query;
    if (turno_id) {
      const { rows } = await pool.query(
        "SELECT * FROM gastos_calle WHERE turno_id = $1 ORDER BY id DESC",
        [turno_id]
      );
      return res.json(rows);
    }
    const { rows } = await pool.query("SELECT * FROM gastos_calle WHERE fecha = $1 ORDER BY id DESC", [
      fecha || todayStr(),
    ]);
    res.json(rows);
  })
);

router.post(
  "/gastos-calle",
  wrap(async (req, res) => {
    const { turno_id, categoria, monto, metodo_pago, nota } = req.body;
    const amt = Number(monto);
    if (!categoria || !amt || amt <= 0) return res.status(400).json({ error: "Datos inválidos" });
    const { fecha, hora } = nowInfo();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO gastos_calle (turno_id, categoria, monto, metodo_pago, nota, fecha, hora)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [turno_id || null, categoria, amt, metodo_pago || "efectivo", nota || null, fecha, hora]
      );
      await applyGastoEffect(client, rows[0], 1);
      await client.query("COMMIT");
      broadcastSync("turnos");
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

router.delete(
  "/gastos-calle/:id",
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM gastos_calle WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Gasto no encontrado" });
      }
      await applyGastoEffect(client, rows[0], -1);
      await client.query("DELETE FROM gastos_calle WHERE id = $1", [req.params.id]);
      await client.query("COMMIT");
      broadcastSync("turnos");
      res.status(204).end();
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

module.exports = { router, checkAndAutoCloseActive, scheduleAutoCierre };

// Si el server se reinicia y queda un turno abierto de un día Cancún anterior,
// lo cerramos de forma retroactiva a la medianoche de ese mismo día.
async function checkAndAutoCloseActive() {
  const { rows } = await pool.query("SELECT * FROM turnos WHERE end_at IS NULL LIMIT 1");
  const turno = rows[0];
  if (!turno) return;
  const fechaTurno = turno.fecha.toISOString ? turno.fecha.toISOString().slice(0, 10) : turno.fecha;
  if (fechaTurno < todayStr()) {
    // medianoche Cancún del día en que inició = 05:00 UTC del día siguiente a esa fecha
    const [y, m, d] = fechaTurno.split("-").map(Number);
    const medianocheUTC = new Date(Date.UTC(y, m - 1, d + 1, 5, 0, 0));
    await pool.query("UPDATE turnos SET end_at = $1, auto_cerrado = true WHERE id = $2", [
      medianocheUTC.toISOString(),
      turno.id,
    ]);
    broadcastSync("turnos");
  }
}

// Programa el auto-cierre para la próxima medianoche Cancún, y se reprograma solo.
function scheduleAutoCierre() {
  const { msHastaMedianoche } = require("./utils");
  const ms = Math.max(msHastaMedianoche(), 1000);
  setTimeout(async () => {
    try {
      const { rows } = await pool.query("SELECT id FROM turnos WHERE end_at IS NULL LIMIT 1");
      if (rows[0]) {
        await pool.query(
          "UPDATE turnos SET end_at = now(), auto_cerrado = true WHERE id = $1",
          [rows[0].id]
        );
        broadcastSync("turnos");
      }
    } catch (e) {
      console.error("Error en auto-cierre de turno:", e);
    } finally {
      scheduleAutoCierre();
    }
  }, ms);
}
