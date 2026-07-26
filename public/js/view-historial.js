import { api } from "./api.js";
import { fmtMoney, fmtDateLabel, fmtDuracion, escapeHtml, PAYMENT_LABELS } from "./utils.js";

let expandedId = null;
let confirmDeleteId = null;

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Cargando historial…</div>`;
  const turnos = await api.getTurnos(30);

  if (expandedId === null && turnos.length && turnos[0].efectivo_contado == null) {
    expandedId = turnos[0].id;
  }

  if (turnos.length === 0) {
    root.innerHTML = `<div class="empty">Todavía no hay turnos terminados.</div>`;
    return;
  }

  root.innerHTML = `<div class="list">${turnos.map((t) => cardHtml(t)).join("")}</div>`;

  for (const t of turnos) {
    const head = root.querySelector(`[data-head="${t.id}"]`);
    head?.addEventListener("click", () => {
      expandedId = expandedId === t.id ? null : t.id;
      ctx.rerender();
    });
  }

  if (expandedId) await attachDetail(root, ctx, expandedId);
}

function cardHtml(t) {
  const expanded = expandedId === t.id;
  const estado = !t.efectivo_contado && t.efectivo_contado !== 0
    ? `<span class="badge" style="background:var(--rose-soft); color:var(--rose)">sin cerrar</span>`
    : t.repartido
    ? `<span class="badge" style="background:var(--teal-soft); color:var(--teal)">repartido</span>`
    : `<span class="badge">falta repartir</span>`;

  return `
    <div class="turno-card">
      <div class="turno-card-head" data-head="${t.id}">
        <div>
          <div class="row-baseline"><span class="strong">${fmtDateLabel(t.fecha)}</span> ${estado}</div>
          <div class="turno-card-meta">${fmtDuracion(t.duracion_horas)} · ${t.viajes_count} viajes ${
    t.auto_cerrado ? "· cerrado automático a medianoche" : ""
  }</div>
        </div>
        <span class="mono strong big">${fmtMoney(t.ingreso_bruto)}</span>
      </div>
      <div id="detail-${t.id}">${expanded ? `<div class="loading">Cargando…</div>` : ""}</div>
    </div>
  `;
}

async function attachDetail(root, ctx, turnoId) {
  const container = root.querySelector(`#detail-${turnoId}`);
  if (!container) return;
  const [detail, wallets, allocations] = await Promise.all([
    api.getTurno(turnoId),
    api.getWallets(),
    api.getTurnoAllocations(turnoId),
  ]);
  const billeteras = wallets.filter((w) => !w.is_fondo);
  const diffClass =
    detail.diferencia == null ? "" : Math.abs(detail.diferencia) < 0.01 ? "diff-ok" : detail.diferencia > 0 ? "diff-over" : "diff-under";

  container.innerHTML = `
    <div class="turno-detail">
      <div class="receipt-rows mono">
        <div class="r-row"><span>Fondo inicial</span><span>${fmtMoney(detail.fondo_inicial)}</span></div>
        <div class="r-row"><span>Ingreso bruto (envío+propina)</span><span>${fmtMoney(detail.ingreso_bruto)}</span></div>
        <div class="r-row"><span>Gastos de calle</span><span>-${fmtMoney(detail.gasto_calle_total)}</span></div>
        <div class="r-divider"></div>
        <div class="r-row r-bold"><span>Efectivo esperado</span><span>${fmtMoney(detail.efectivo_esperado)}</span></div>
      </div>

      <div class="field" style="margin-top:10px">
        <span>Efectivo contado en físico</span>
        ${
          detail.efectivo_contado != null
            ? `<div class="row-baseline" style="justify-content:space-between">
                 <span class="mono strong big">${fmtMoney(detail.efectivo_contado)}</span>
                 ${!detail.repartido ? `<button class="link-btn" data-action="reabrir">Corregir</button>` : ""}
               </div>`
            : `<div class="row-2">
                 <input type="number" inputmode="decimal" id="cash-${turnoId}" placeholder="0.00" />
                 <button class="btn btn-ink" data-action="cerrar">Cerrar caja</button>
               </div>`
        }
      </div>

      ${
        detail.efectivo_contado != null
          ? `<div class="row-baseline" style="justify-content:space-between; margin-top:8px">
               <span class="hint" style="padding:0">${
                 Math.abs(detail.diferencia) < 0.01 ? "Cuadra exacto" : detail.diferencia > 0 ? "Sobra efectivo" : "Falta efectivo"
               }</span>
               <span class="mono strong ${diffClass}">${fmtMoney(detail.diferencia)}</span>
             </div>`
          : ""
      }

      ${detail.efectivo_contado != null ? repartoHtml(detail, billeteras, allocations) : ""}

      <div class="section-label" style="margin-top:14px">Viajes (${detail.trips.length})</div>
      <div class="list">
        ${detail.trips
          .map(
            (t) => `<div class="list-item">
              <div class="list-item-main">
                <span class="mono time">${t.hora || ""}</span>
                <div>
                  <span class="mono strong">${fmtMoney(Number(t.envio) + Number(t.propina))}</span>
                  <span class="chip">${PAYMENT_LABELS[t.metodo_cobro] || t.metodo_cobro}</span>
                </div>
              </div>
            </div>`
          )
          .join("")}
      </div>

      <div class="section-label" style="margin-top:10px">Gastos de calle (${detail.gastos.length})</div>
      <div class="list">
        ${
          detail.gastos.length === 0
            ? `<div class="empty">Sin gastos.</div>`
            : detail.gastos
                .map(
                  (g) => `<div class="list-item">
                <div class="list-item-main"><span class="mono strong">${fmtMoney(g.monto)}</span>
                  <span class="note">${escapeHtml(g.nota || g.categoria)}</span></div>
              </div>`
                )
                .join("")
        }
      </div>

      <button class="btn btn-outline btn-sm" data-action="delete-turno" style="margin-top:14px">
        ${confirmDeleteId === turnoId ? "¿Seguro? Toca de nuevo para borrar todo" : "🗑 Borrar este turno"}
      </button>
    </div>
  `;

  container.querySelector('[data-action="cerrar"]')?.addEventListener("click", async () => {
    const val = root.querySelector(`#cash-${turnoId}`).value;
    if (val === "") return ctx.toast("Escribe cuánto efectivo contaron", true);
    await api.cerrarCaja(turnoId, Number(val));
    ctx.rerender();
  });

  container.querySelector('[data-action="reabrir"]')?.addEventListener("click", async () => {
    await api.reabrirCaja(turnoId);
    ctx.rerender();
  });

  container.querySelector('[data-action="apply-repartir"]')?.addEventListener("click", async () => {
    const cashInputs = container.querySelectorAll(".alloc-cash");
    const bankInputs = container.querySelectorAll(".alloc-bank");
    const map = {};
    cashInputs.forEach((i) => {
      map[i.dataset.walletId] = map[i.dataset.walletId] || {};
      map[i.dataset.walletId].wallet_id = Number(i.dataset.walletId);
      map[i.dataset.walletId].cash = Number(i.value) || 0;
    });
    bankInputs.forEach((i) => {
      map[i.dataset.walletId] = map[i.dataset.walletId] || {};
      map[i.dataset.walletId].wallet_id = Number(i.dataset.walletId);
      map[i.dataset.walletId].bank = Number(i.value) || 0;
    });
    const allocations = Object.values(map).filter((a) => a.cash > 0 || a.bank > 0);
    if (allocations.length === 0) return ctx.toast("Escribe al menos un monto", true);
    try {
      await api.repartir(turnoId, allocations);
      ctx.toast("Reparto aplicado");
      ctx.rerender();
    } catch (e) {
      ctx.toast(e.message, true);
    }
  });

  container.querySelector('[data-action="undo-repartir"]')?.addEventListener("click", async () => {
    await api.deshacerReparto(turnoId);
    ctx.rerender();
  });

  container.querySelector('[data-action="delete-turno"]')?.addEventListener("click", async () => {
    if (confirmDeleteId !== turnoId) {
      confirmDeleteId = turnoId;
      ctx.rerender();
      return;
    }
    await api.deleteTurno(turnoId);
    confirmDeleteId = null;
    expandedId = null;
    ctx.toast("Turno borrado");
    ctx.rerender();
  });

  const allocInputs = container.querySelectorAll(".alloc-cash, .alloc-bank");
  const cashRemainEl = container.querySelector("#remain-cash");
  const bankRemainEl = container.querySelector("#remain-bank");
  if (allocInputs.length) {
    const update = () => {
      const sumCash = Array.from(container.querySelectorAll(".alloc-cash")).reduce(
        (s, i) => s + (Number(i.value) || 0),
        0
      );
      const sumBank = Array.from(container.querySelectorAll(".alloc-bank")).reduce(
        (s, i) => s + (Number(i.value) || 0),
        0
      );
      if (cashRemainEl) cashRemainEl.textContent = fmtMoney(detail.dinero_a_repartir_cash - sumCash);
      if (bankRemainEl) bankRemainEl.textContent = fmtMoney(detail.dinero_a_repartir_bank - sumBank);
    };
    allocInputs.forEach((i) => i.addEventListener("input", update));
  }
}

function repartoHtml(detail, billeteras, allocations) {
  if (billeteras.length === 0) {
    return `<p class="hint">Creen una billetera en Panel Central para poder repartir.</p>`;
  }
  if (detail.repartido) {
    return `<div class="inline-form">
      <div class="section-label">Repartido</div>
      ${allocations
        .map(
          (a) => `<div class="row-baseline" style="justify-content:space-between">
            <span><span class="dot" style="background:${a.wallet_color}"></span>${a.wallet_name} (${
            a.slot_destino === "cash" ? "efectivo" : "cuenta"
          })</span>
            <span class="mono strong">${fmtMoney(a.monto)}</span>
          </div>`
        )
        .join("")}
      <button class="btn btn-outline btn-sm" data-action="undo-repartir">&#8634; Deshacer reparto</button>
    </div>`;
  }
  return `<div class="inline-form">
    <div class="section-label">Repartir: efectivo ${fmtMoney(detail.dinero_a_repartir_cash)} · cuenta ${fmtMoney(
    detail.dinero_a_repartir_bank
  )}</div>
    ${billeteras
      .map(
        (w) => `<div style="padding:6px 0; border-bottom:1px solid var(--paper-dark)">
          <div class="row-baseline"><span class="dot" style="background:${w.color}"></span><span class="strong">${escapeHtml(
          w.name
        )}</span></div>
          <div class="row-2" style="margin-top:4px">
            <input type="number" inputmode="decimal" class="alloc-cash" data-wallet-id="${w.id}" placeholder="efectivo" />
            <input type="number" inputmode="decimal" class="alloc-bank" data-wallet-id="${w.id}" placeholder="cuenta" />
          </div>
        </div>`
      )
      .join("")}
    <div class="row-baseline" style="justify-content:space-between; margin-top:6px">
      <span class="hint" style="padding:0">Sin repartir: efectivo <span id="remain-cash" class="mono strong">${fmtMoney(
        detail.dinero_a_repartir_cash
      )}</span> · cuenta <span id="remain-bank" class="mono strong">${fmtMoney(detail.dinero_a_repartir_bank)}</span></span>
    </div>
    <button class="btn btn-teal" data-action="apply-repartir">Aplicar reparto</button>
  </div>`;
}
