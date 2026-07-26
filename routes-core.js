const express = require("express");
const { pool } = require("./db");
const { broadcastSync } = require("./io");
const { todayStr, nowInfo, addOneMonthClamped, round2 } = require("./utils");
const { slotCol, applyDelta, walletView, commitmentView } = require("./wallet-helpers");

const router = express.Router();

function wrap(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(err.status || 500).json({ error: err.message || "Error interno" });
    });
  };
}

/* ============================ BANK ACCOUNTS ============================ */

router.get(
  "/bank-accounts",
  wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM bank_accounts ORDER BY id ASC");
    res.json(rows);
  })
);

router.post(
  "/bank-accounts",
  wrap(async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Falta el nombre" });
    const { rows } = await pool.query("INSERT INTO bank_accounts (name) VALUES ($1) RETURNING *", [
      name.trim(),
    ]);
    broadcastSync("bank-accounts");
    res.status(201).json(rows[0]);
  })
);

router.delete(
  "/bank-accounts/:id",
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE wallets SET bank_account_id = NULL WHERE bank_account_id = $1", [
        req.params.id,
      ]);
      await client.query("DELETE FROM bank_accounts WHERE id = $1", [req.params.id]);
      await client.query("COMMIT");
      broadcastSync("bank-accounts");
      res.status(204).end();
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ================================ WALLETS ================================ */

router.get(
  "/wallets",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT w.*, b.name AS bank_account_name
       FROM wallets w LEFT JOIN bank_accounts b ON b.id = w.bank_account_id
       ORDER BY w.is_fondo DESC, w.id ASC`
    );
    res.json(rows.map(walletView));
  })
);

router.post(
  "/wallets",
  wrap(async (req, res) => {
    const { name, color, bank_account_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: "Falta el nombre" });
    const { rows } = await pool.query(
      "INSERT INTO wallets (name, color, bank_account_id) VALUES ($1, $2, $3) RETURNING *",
      [name.trim(), color || "#2F6E63", bank_account_id || null]
    );
    broadcastSync("wallets");
    res.status(201).json(walletView(rows[0]));
  })
);

router.patch(
  "/wallets/:id",
  wrap(async (req, res) => {
    const { name, color, bank_account_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE wallets SET
         name = COALESCE($1, name),
         color = COALESCE($2, color),
         bank_account_id = CASE WHEN $3::text = '__clear__' THEN NULL ELSE COALESCE($4, bank_account_id) END
       WHERE id = $5 RETURNING *`,
      [name, color, bank_account_id === null ? "__clear__" : null, bank_account_id, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Billetera no encontrada" });
    broadcastSync("wallets");
    res.json(walletView(rows[0]));
  })
);

router.delete(
  "/wallets/:id",
  wrap(async (req, res) => {
    const { rows } = await pool.query("SELECT is_fondo FROM wallets WHERE id = $1", [req.params.id]);
    if (rows[0]?.is_fondo) return res.status(400).json({ error: "No se puede eliminar El Fondo" });
    await pool.query("DELETE FROM wallets WHERE id = $1", [req.params.id]);
    broadcastSync("wallets");
    res.status(204).end();
  })
);

/* ============================ TRANSFERENCIAS ============================ */
// Cubre: asignar del Fondo a una billetera, billetera→billetera, y mover
// efectivo↔cuenta dentro de la misma bolsa (wallet_origen_id === wallet_destino_id).

router.get(
  "/transferencias",
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const walletId = req.query.wallet_id;
    const params = [];
    let where = "";
    if (walletId) {
      params.push(walletId);
      where = `WHERE t.wallet_origen_id = $1 OR t.wallet_destino_id = $1`;
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT t.*, wo.name AS wallet_origen_name, wo.color AS wallet_origen_color,
              wd.name AS wallet_destino_name, wd.color AS wallet_destino_color
       FROM transferencias t
       JOIN wallets wo ON wo.id = t.wallet_origen_id
       JOIN wallets wd ON wd.id = t.wallet_destino_id
       ${where}
       ORDER BY t.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  })
);

router.post(
  "/transferencias",
  wrap(async (req, res) => {
    const { wallet_origen_id, slot_origen, wallet_destino_id, slot_destino, monto, nota, fecha } =
      req.body;
    const amt = Number(monto);
    if (!amt || amt <= 0) return res.status(400).json({ error: "Monto inválido" });
    if (!wallet_origen_id || !wallet_destino_id) return res.status(400).json({ error: "Faltan bolsas" });
    if (wallet_origen_id === wallet_destino_id && slot_origen === slot_destino) {
      return res.status(400).json({ error: "Origen y destino no pueden ser el mismo slot" });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyDelta(client, wallet_origen_id, slot_origen, -amt);
      await applyDelta(client, wallet_destino_id, slot_destino, amt);
      const { rows } = await client.query(
        `INSERT INTO transferencias (tipo, wallet_origen_id, slot_origen, wallet_destino_id, slot_destino, monto, nota, fecha, hora)
         VALUES ('manual', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          wallet_origen_id,
          slotCol(slot_origen),
          wallet_destino_id,
          slotCol(slot_destino),
          amt,
          nota || null,
          fecha || todayStr(),
          nowInfo().hora,
        ]
      );
      await client.query("COMMIT");
      broadcastSync("wallets");
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
  "/transferencias/:id",
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM transferencias WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      const t = rows[0];
      if (!t) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "No encontrada" });
      }
      await applyDelta(client, t.wallet_origen_id, t.slot_origen, Number(t.monto));
      await applyDelta(client, t.wallet_destino_id, t.slot_destino, -Number(t.monto));
      await client.query("DELETE FROM transferencias WHERE id = $1", [req.params.id]);
      await client.query("COMMIT");
      broadcastSync("wallets");
      res.status(204).end();
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ================================ AJUSTES ================================ */
// Ingreso o gasto suelto en una billetera (sin contraparte): despensa, propina
// extra, o el pago de un compromiso fijo (commitment_id).

router.get(
  "/ajustes",
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 200);
    const walletId = req.query.wallet_id;
    const params = [];
    let where = "";
    if (walletId) {
      params.push(walletId);
      where = "WHERE a.wallet_id = $1";
    }
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT a.*, w.name AS wallet_name, w.color AS wallet_color
       FROM ajustes a JOIN wallets w ON w.id = a.wallet_id
       ${where} ORDER BY a.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  })
);

router.post(
  "/ajustes",
  wrap(async (req, res) => {
    const { wallet_id, slot, tipo, monto, nota, fecha } = req.body;
    if (!["ingreso", "gasto"].includes(tipo)) return res.status(400).json({ error: "Tipo inválido" });
    const amt = Number(monto);
    if (!amt || amt <= 0) return res.status(400).json({ error: "Monto inválido" });
    const signed = tipo === "gasto" ? -amt : amt;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await applyDelta(client, wallet_id, slot, signed);
      const { rows } = await client.query(
        `INSERT INTO ajustes (wallet_id, slot, tipo, monto, nota, fecha, hora)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          wallet_id,
          slotCol(slot),
          tipo,
          amt,
          nota || (tipo === "gasto" ? "Gasto" : "Ingreso manual"),
          fecha || todayStr(),
          nowInfo().hora,
        ]
      );
      await client.query("COMMIT");
      broadcastSync("wallets");
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
  "/ajustes/:id",
  wrap(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT * FROM ajustes WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      const a = rows[0];
      if (!a) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "No encontrado" });
      }
      const signed = a.tipo === "gasto" ? Number(a.monto) : -Number(a.monto);
      await applyDelta(client, a.wallet_id, a.slot, signed);
      await client.query("DELETE FROM ajustes WHERE id = $1", [req.params.id]);
      await client.query("COMMIT");
      broadcastSync("wallets");
      res.status(204).end();
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ============================== COMMITMENTS ============================== */

router.get(
  "/commitments",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT c.*, w.name AS wallet_name, w.color AS wallet_color
       FROM commitments c JOIN wallets w ON w.id = c.wallet_id
       WHERE c.active = true ORDER BY c.next_due_date ASC`
    );
    const today = todayStr();
    res.json(rows.map((c) => commitmentView(c, today)));
  })
);

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
    broadcastSync("commitments");
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
    broadcastSync("commitments");
    res.json(commitmentView(rows[0], todayStr()));
  })
);

router.delete(
  "/commitments/:id",
  wrap(async (req, res) => {
    await pool.query("DELETE FROM commitments WHERE id = $1", [req.params.id]);
    broadcastSync("commitments");
    res.status(204).end();
  })
);

router.post(
  "/commitments/:id/pay",
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const slot = req.body.slot || "cash";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: crows } = await client.query("SELECT * FROM commitments WHERE id = $1 FOR UPDATE", [
        id,
      ]);
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

      await applyDelta(client, commitment.wallet_id, slot, -payAmount);
      await client.query(
        `INSERT INTO ajustes (wallet_id, slot, tipo, monto, nota, commitment_id, fecha, hora)
         VALUES ($1, $2, 'gasto', $3, $4, $5, $6, $7)`,
        [
          commitment.wallet_id,
          slotCol(slot),
          payAmount,
          `Pago: ${commitment.name}`,
          id,
          todayStr(),
          nowInfo().hora,
        ]
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

      const { rows: wrows } = await client.query("SELECT * FROM wallets WHERE id = $1", [
        commitment.wallet_id,
      ]);
      await client.query("COMMIT");
      broadcastSync("commitments");
      res.json({ commitment: commitmentView(updated, todayStr()), wallet: walletView(wrows[0]) });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ========================= MOVIMIENTOS RECIENTES (feed) ========================= */

router.get(
  "/movimientos-recientes",
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 25, 100);

    const [trips, gastos, transfer, ajustes] = await Promise.all([
      pool.query(
        `SELECT id, 'viaje' AS tipo, (envio+propina) AS monto, negocio AS nota, created_at, fecha, hora
         FROM trips ORDER BY created_at DESC LIMIT $1`,
        [limit]
      ),
      pool.query(
        `SELECT id, 'gasto_calle' AS tipo, -monto AS monto, categoria AS nota, created_at, fecha, hora
         FROM gastos_calle ORDER BY created_at DESC LIMIT $1`,
        [limit]
      ),
      pool.query(
        `SELECT t.id, CASE WHEN t.tipo='reparto' THEN 'reparto' ELSE 'transferencia' END AS tipo,
                t.monto, COALESCE(t.nota, wd.name) AS nota, t.created_at, t.fecha, t.hora,
                wo.name AS wallet_origen_name, wd.name AS wallet_destino_name
         FROM transferencias t
         JOIN wallets wo ON wo.id = t.wallet_origen_id
         JOIN wallets wd ON wd.id = t.wallet_destino_id
         ORDER BY t.created_at DESC LIMIT $1`,
        [limit]
      ),
      pool.query(
        `SELECT a.id, 'ajuste' AS tipo, CASE WHEN a.tipo='gasto' THEN -a.monto ELSE a.monto END AS monto,
                COALESCE(a.nota, w.name) AS nota, a.created_at, a.fecha, a.hora, w.name AS wallet_name
         FROM ajustes a JOIN wallets w ON w.id = a.wallet_id
         ORDER BY a.created_at DESC LIMIT $1`,
        [limit]
      ),
    ]);

    const all = [
      ...trips.rows,
      ...gastos.rows,
      ...transfer.rows,
      ...ajustes.rows,
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(all.slice(0, limit).map((r) => ({ ...r, monto: round2(Number(r.monto)) })));
  })
);

module.exports = router;
