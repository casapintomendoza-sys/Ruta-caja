const { pool } = require("./db");
const { toDateStr, daysBetween, monthsBetweenInclusive, round2 } = require("./utils");

function slotCol(slot) {
  if (slot !== "cash" && slot !== "bank") {
    const err = new Error("Slot inválido, debe ser 'cash' o 'bank'");
    err.status = 400;
    throw err;
  }
  return slot;
}

async function applyDelta(client, walletId, slot, delta) {
  const col = slotCol(slot);
  await client.query(`UPDATE wallets SET ${col} = ${col} + $1 WHERE id = $2`, [delta, walletId]);
}

async function getWallet(walletId, client = pool) {
  const { rows } = await client.query("SELECT * FROM wallets WHERE id = $1", [walletId]);
  return rows[0];
}

async function getFondo(client = pool) {
  const { rows } = await client.query("SELECT * FROM wallets WHERE is_fondo = true LIMIT 1");
  return rows[0];
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

function walletView(w) {
  return {
    ...w,
    cash: Number(w.cash),
    bank: Number(w.bank),
    total: round2(Number(w.cash) + Number(w.bank)),
  };
}

module.exports = { slotCol, applyDelta, getWallet, getFondo, commitmentView, walletView };
