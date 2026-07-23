import { api } from "./api.js";
import { fmtMoney, fmtDateLabel } from "./utils.js";

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Cargando cierre…</div>`;
  const [resumen, wallets, allocations] = await Promise.all([
    api.getJornada(ctx.date),
    api.getWallets(),
    api.getAllocations(ctx.date),
  ]);

  const closed = resumen.cerrado;
  const diff = resumen.diferencia;
  const diffClass = diff == null ? "" : Math.abs(diff) < 0.01 ? "diff-ok" : diff > 0 ? "diff-over" : "diff-under";

  root.innerHTML = `
    <div class="datebar">
      <button class="icon-btn" data-action="prev-day" aria-label="Día anterior">&#8249;</button>
      <span class="datebar-label">${fmtDateLabel(ctx.date)}</span>
      <button class="icon-btn" data-action="next-day" aria-label="Día siguiente" ${
        ctx.date >= ctx._today ? "disabled" : ""
      }>&#8250;</button>
    </div>

    <div class="receipt">
      <div class="receipt-title">Cierre de ruta</div>
      <div class="receipt-date mono">${fmtDateLabel(ctx.date)}</div>

      <div class="receipt-rows mono">
        <div class="r-row"><span>Fondo inicial</span><span>${fmtMoney(resumen.fondo_inicial)}</span></div>
        <div class="r-row"><span>Cobros + propinas en efectivo</span><span>${fmtMoney(
          resumen.total_trips_efectivo
        )}</span></div>
        <div class="r-row"><span>Gastos en efectivo</span><span>-${fmtMoney(resumen.total_gastos_efectivo)}</span></div>
        <div class="r-divider"></div>
        <div class="r-row r-bold"><span>Efectivo esperado</span><span>${fmtMoney(resumen.efectivo_esperado)}</span></div>
      </div>

      <div class="receipt-rows mono" style="margin-top:10px">
        <div class="r-row"><span>Cobros digitales (transf./tarjeta)</span><span>${fmtMoney(
          resumen.total_trips_digital
        )}</span></div>
        ${
          resumen.total_gastos_digital > 0
            ? `<div class="r-row"><span>Gastos digitales</span><span>-${fmtMoney(resumen.total_gastos_digital)}</span></div>`
            : ""
        }
      </div>

      <div class="field" style="margin-top:14px">
        <span>Efectivo contado en físico</span>
        ${
          closed
            ? `<div class="row-baseline" style="justify-content:space-between">
                 <span class="mono strong big">${fmtMoney(resumen.efectivo_contado)}</span>
                 <button class="link-btn" data-action="reopen">Corregir</button>
               </div>`
            : `<div class="row-2">
                 <input type="number" inputmode="decimal" id="cash-input" placeholder="0.00" />
                 <button class="btn btn-ink" data-action="close-day">Cerrar día</button>
               </div>`
        }
      </div>

      ${
        closed
          ? `<div class="r-divider" style="margin-top:12px"></div>
             <div class="row-baseline" style="justify-content:space-between; margin-top:10px">
               <span class="diff-label">${
                 Math.abs(diff) < 0.01 ? "Cuadra exacto" : diff > 0 ? "Sobra efectivo" : "Falta efectivo"
               }</span>
               <span class="mono strong big ${diffClass}">${fmtMoney(diff)}</span>
             </div>`
          : ""
      }
    </div>

    ${closed ? renderRepartoSection(resumen, wallets, allocations) : ""}
  `;

  root.querySelector('[data-action="prev-day"]')?.addEventListener("click", () => ctx.changeDay(-1));
  root.querySelector('[data-action="next-day"]')?.addEventListener("click", () => ctx.changeDay(1));

  root.querySelector('[data-action="close-day"]')?.addEventListener("click", async () => {
    const val = root.querySelector("#cash-input").value;
    if (val === "") return ctx.toast("Escribe cuánto efectivo contaron", true);
    await api.cerrarJornada(ctx.date, Number(val));
    ctx.rerender();
  });

  root.querySelector('[data-action="reopen"]')?.addEventListener("click", async () => {
    await api.reabrirJornada(ctx.date);
    ctx.rerender();
  });

  root.querySelector('[data-action="apply-distribution"]')?.addEventListener("click", async () => {
    const inputs = root.querySelectorAll(".alloc-input");
    const allocations = Array.from(inputs)
      .map((inp) => ({ wallet_id: Number(inp.dataset.walletId), amount: Number(inp.value) }))
      .filter((a) => a.amount > 0);
    if (allocations.length === 0) return ctx.toast("Escribe al menos un monto para repartir", true);
    try {
      await api.repartir(ctx.date, allocations);
      ctx.toast("Reparto aplicado");
      ctx.rerender();
    } catch (e) {
      ctx.toast(e.message, true);
    }
  });

  root.querySelector('[data-action="undo-distribution"]')?.addEventListener("click", async () => {
    await api.deshacerReparto(ctx.date);
    ctx.rerender();
  });

  const allocInputs = root.querySelectorAll(".alloc-input");
  const remainingEl = root.querySelector("#alloc-remaining");
  if (allocInputs.length && remainingEl) {
    const update = () => {
      const sum = Array.from(allocInputs).reduce((s, i) => s + (Number(i.value) || 0), 0);
      const rest = resumen.dinero_a_repartir - sum;
      remainingEl.textContent = fmtMoney(rest);
      remainingEl.className = rest < -0.004 ? "mono strong diff-under" : "mono strong";
    };
    allocInputs.forEach((i) => i.addEventListener("input", update));
  }
}

function renderRepartoSection(resumen, wallets, allocations) {
  if (wallets.length === 0) {
    return `<div class="card">
      <div class="card-title">Repartir a billeteras</div>
      <p class="hint">Todavía no tienen billeteras creadas. Vayan a la pestaña Billeteras para crear una.</p>
    </div>`;
  }

  if (resumen.repartido) {
    return `<div class="card">
      <div class="card-title">Repartido a billeteras</div>
      <div class="list" style="margin-top:8px">
        ${allocations
          .map(
            (a) => `<div class="row-baseline" style="justify-content:space-between; padding:6px 0">
              <span><span class="dot" style="background:${a.wallet_color}"></span>${a.wallet_name}</span>
              <span class="mono strong">${fmtMoney(a.amount)}</span>
            </div>`
          )
          .join("")}
      </div>
      <button class="btn btn-outline" data-action="undo-distribution" style="margin-top:10px">&#8634; Deshacer reparto</button>
    </div>`;
  }

  return `<div class="card">
    <div class="card-title">Repartir a billeteras</div>
    <div class="hint" style="margin-bottom:10px">Dinero a repartir hoy: <b class="mono">${fmtMoney(
      resumen.dinero_a_repartir
    )}</b></div>
    <div class="list">
      ${wallets
        .map(
          (w) => `<div class="row-baseline" style="justify-content:space-between; gap:10px; padding:6px 0">
            <span><span class="dot" style="background:${w.color}"></span>${w.name}</span>
            <input type="number" inputmode="decimal" class="alloc-input" data-wallet-id="${w.id}" placeholder="0.00" style="width:110px; text-align:right" />
          </div>`
        )
        .join("")}
    </div>
    <div class="row-baseline" style="justify-content:space-between; margin-top:8px">
      <span class="hint">Sin repartir</span>
      <span id="alloc-remaining" class="mono strong">${fmtMoney(resumen.dinero_a_repartir)}</span>
    </div>
    <button class="btn btn-teal" data-action="apply-distribution" style="margin-top:10px">Aplicar reparto</button>
  </div>`;
}
