import { api } from "./api.js";
import { fmtMoney, fmtDateLabel, fmtDateShort, escapeHtml } from "./utils.js";

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Cargando resumen…</div>`;
  const [wallets, commitments, turnos, movimientos] = await Promise.all([
    api.getWallets(),
    api.getAllCommitments(),
    api.getTurnos(8),
    api.getMovimientosRecientes(15),
  ]);

  const fondo = wallets.find((w) => w.is_fondo);
  const billeteras = wallets.filter((w) => !w.is_fondo);
  const totalBilleteras = billeteras.reduce((s, w) => s + w.total, 0);
  const vencidos = commitments.filter((c) => c.overdue);
  const proximos = commitments.filter((c) => !c.overdue && c.days_left <= 7);
  const pendientes = turnos.filter((t) => t.efectivo_contado == null || !t.repartido);

  root.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">En billeteras</div>
        <div class="stat-value mono">${fmtMoney(totalBilleteras)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sin repartir (Fondo)</div>
        <div class="stat-value mono">${fmtMoney(fondo?.total)}</div>
      </div>
    </div>

    ${
      vencidos.length > 0
        ? `<div class="card" style="background:var(--rose-soft); border-color:var(--rose-soft)">
             <div class="card-title" style="color:var(--rose)">⚠ Compromisos vencidos</div>
             ${vencidos
               .map(
                 (c) => `<div class="row-baseline" style="justify-content:space-between; padding:4px 0">
                   <span>${escapeHtml(c.name)} <span class="chip chip-muted">${escapeHtml(c.wallet_name)}</span></span>
                   <span class="mono strong">${fmtMoney(c.amount)}</span>
                 </div>`
               )
               .join("")}
           </div>`
        : ""
    }

    ${
      proximos.length > 0
        ? `<div class="card">
             <div class="card-title">Vencen pronto</div>
             ${proximos
               .map(
                 (c) => `<div class="row-baseline" style="justify-content:space-between; padding:4px 0">
                   <span>${escapeHtml(c.name)} <span class="chip chip-muted">${escapeHtml(c.wallet_name)}</span></span>
                   <span class="mono">${fmtDateShort(c.next_due_date)}</span>
                 </div>`
               )
               .join("")}
           </div>`
        : ""
    }

    ${
      pendientes.length > 0
        ? `<div class="card">
             <div class="card-title">Turnos por cerrar o repartir</div>
             ${pendientes
               .map(
                 (t) => `<div class="row-baseline" style="justify-content:space-between; padding:4px 0">
                   <span>${fmtDateLabel(t.fecha)}</span>
                   <span class="badge">${t.efectivo_contado == null ? "falta cerrar caja" : "falta repartir"}</span>
                 </div>`
               )
               .join("")}
             <p class="hint">Ve a Panel Operativo → Historial para resolverlos.</p>
           </div>`
        : ""
    }

    <div class="card">
      <div class="card-title">Billeteras</div>
      <div class="list">
        ${billeteras
          .map(
            (w) => `<div class="row-baseline" style="justify-content:space-between; padding:5px 0">
              <span><span class="dot" style="background:${w.color}"></span>${escapeHtml(w.name)}</span>
              <span class="mono strong">${fmtMoney(w.total)}</span>
            </div>`
          )
          .join("")}
      </div>
    </div>

    <div class="section-label">Actividad reciente</div>
    <div class="list">
      ${
        movimientos.length === 0
          ? `<div class="empty">Sin movimientos todavía.</div>`
          : movimientos.map((m) => movRow(m)).join("")
      }
    </div>
  `;
}

function movRow(m) {
  const isPositive = Number(m.monto) >= 0;
  const tipoLabel =
    {
      viaje: "Viaje",
      gasto_calle: "Gasto de calle",
      reparto: "Reparto",
      transferencia: "Transferencia",
      ajuste: "Movimiento",
    }[m.tipo] || m.tipo;
  return `<div class="list-item">
    <div class="list-item-main">
      <div>
        <div class="row-baseline"><span class="strong">${tipoLabel}</span>
          <span class="note">${escapeHtml(m.nota || "")}</span></div>
        <div class="note mono">${fmtDateShort(m.fecha)} ${m.hora || ""}</div>
      </div>
    </div>
    <span class="mono strong ${isPositive ? "diff-ok" : "diff-under"}">${fmtMoney(m.monto)}</span>
  </div>`;
}
