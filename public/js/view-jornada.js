import { api } from "./api.js";
import { fmtMoney, fmtDateLabel, escapeHtml, PAYMENT_LABELS, EXPENSE_CATEGORIES, timeNow } from "./utils.js";

function paymentOptions(selected) {
  return Object.entries(PAYMENT_LABELS)
    .map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`)
    .join("");
}

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Cargando jornada…</div>`;
  const [resumen, trips, expenses] = await Promise.all([
    api.getJornada(ctx.date),
    api.getTrips(ctx.date),
    api.getExpenses(ctx.date),
  ]);

  const locked = resumen.cerrado;
  const j = resumen.jornada;

  root.innerHTML = `
    <div class="datebar">
      <button class="icon-btn" data-action="prev-day" aria-label="Día anterior">&#8249;</button>
      <span class="datebar-label">${fmtDateLabel(ctx.date)}</span>
      <button class="icon-btn" data-action="next-day" aria-label="Día siguiente" ${
        ctx.date >= ctx._today ? "disabled" : ""
      }>&#8250;</button>
    </div>

    <div class="ticket ticket-dark">
      <div class="ticket-eyebrow">TOTAL DEL DÍA · ${resumen.total_viajes} ${
    resumen.total_viajes === 1 ? "viaje" : "viajes"
  }</div>
      <div class="ticket-big">${fmtMoney(resumen.total_generado)}</div>
      <div class="ticket-sub">
        <span>cobros ${fmtMoney(resumen.total_cobros)}</span>
        <span class="accent">propinas ${fmtMoney(resumen.total_propinas)}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Fondo con el que sale hoy ${locked ? '<span class="badge">día cerrado</span>' : ""}</div>
      <div class="fondo-grid">
        <label class="field">
          <span>Fondo de trabajo</span>
          <input type="number" inputmode="decimal" id="f-trabajo" value="${j.fondo_trabajo}" ${
    locked ? "disabled" : ""
  }/>
        </label>
        <label class="field">
          <span>Gasolina</span>
          <input type="number" inputmode="decimal" id="f-gasolina" value="${j.fondo_gasolina}" ${
    locked ? "disabled" : ""
  }/>
        </label>
        <label class="field">
          <span>Gastos de jornada</span>
          <input type="number" inputmode="decimal" id="f-jornada" value="${j.fondo_jornada}" ${
    locked ? "disabled" : ""
  }/>
        </label>
      </div>
      <div class="fondo-total">Total del fondo: <b>${fmtMoney(resumen.fondo_inicial)}</b></div>
      ${
        locked
          ? `<p class="hint">Para editar el fondo primero reabran el cierre en la pestaña Cierre.</p>`
          : `<button class="btn btn-ink" data-action="save-fondo">Guardar fondo</button>`
      }
    </div>

    <div class="card">
      <div class="card-title">Anotar viaje</div>
      <div class="row-2">
        <label class="field">
          <span>Cobro</span>
          <input type="number" inputmode="decimal" id="trip-fare" placeholder="0.00" />
        </label>
        <label class="field">
          <span>Propina</span>
          <input type="number" inputmode="decimal" id="trip-tip" placeholder="0.00" />
        </label>
      </div>
      <label class="field">
        <span>Método de pago</span>
        <select id="trip-method">${paymentOptions("efectivo")}</select>
      </label>
      <label class="field">
        <span>Nota (opcional)</span>
        <input type="text" id="trip-note" placeholder="Zona, cliente…" />
      </label>
      <button class="btn btn-amber" data-action="add-trip">+ Agregar viaje</button>
    </div>

    <div class="list">
      ${
        trips.length === 0
          ? `<div class="empty">Todavía no hay viajes anotados para este día.</div>`
          : trips
              .map(
                (t) => `
        <div class="list-item">
          <div class="list-item-main">
            <span class="mono time">${t.time}</span>
            <div>
              <div class="row-baseline">
                <span class="mono strong">${fmtMoney(t.fare)}</span>
                ${
                  Number(t.tip) > 0
                    ? `<span class="mono tag-amber">+${fmtMoney(t.tip)} propina</span>`
                    : ""
                }
                <span class="chip">${PAYMENT_LABELS[t.payment_method] || t.payment_method}</span>
              </div>
              ${t.note ? `<div class="note">${escapeHtml(t.note)}</div>` : ""}
            </div>
          </div>
          <button class="icon-btn" data-action="delete-trip" data-id="${t.id}" aria-label="Eliminar viaje">✕</button>
        </div>`
              )
              .join("")
      }
    </div>

    <div class="card">
      <div class="card-title">Anotar gasto</div>
      <div class="row-2">
        <label class="field">
          <span>Categoría</span>
          <select id="exp-category">${EXPENSE_CATEGORIES.map(
            (c) => `<option value="${c.value}">${c.label}</option>`
          ).join("")}</select>
        </label>
        <label class="field">
          <span>Monto</span>
          <input type="number" inputmode="decimal" id="exp-amount" placeholder="0.00" />
        </label>
      </div>
      <label class="field">
        <span>Método de pago</span>
        <select id="exp-method">${paymentOptions("efectivo")}</select>
      </label>
      <label class="field">
        <span>Nota (opcional)</span>
        <input type="text" id="exp-note" placeholder="¿En qué se gastó?" />
      </label>
      <button class="btn btn-rose-outline" data-action="add-expense">+ Agregar gasto</button>
    </div>

    <div class="list">
      ${
        expenses.length === 0
          ? `<div class="empty">Sin gastos anotados este día.</div>`
          : expenses
              .map(
                (e) => `
        <div class="list-item">
          <div class="list-item-main">
            <div>
              <div class="row-baseline">
                <span class="mono strong">${fmtMoney(e.amount)}</span>
                <span class="chip">${EXPENSE_CATEGORIES.find((c) => c.value === e.category)?.label || e.category}</span>
                <span class="chip chip-muted">${PAYMENT_LABELS[e.payment_method] || e.payment_method}</span>
              </div>
              ${e.note ? `<div class="note">${escapeHtml(e.note)}</div>` : ""}
            </div>
          </div>
          <button class="icon-btn" data-action="delete-expense" data-id="${e.id}" aria-label="Eliminar gasto">✕</button>
        </div>`
              )
              .join("")
      }
    </div>
  `;

  root.querySelector('[data-action="prev-day"]')?.addEventListener("click", () => ctx.changeDay(-1));
  root.querySelector('[data-action="next-day"]')?.addEventListener("click", () => ctx.changeDay(1));

  root.querySelector('[data-action="save-fondo"]')?.addEventListener("click", async () => {
    const fondo_trabajo = Number(root.querySelector("#f-trabajo").value) || 0;
    const fondo_gasolina = Number(root.querySelector("#f-gasolina").value) || 0;
    const fondo_jornada = Number(root.querySelector("#f-jornada").value) || 0;
    await api.setFondo(ctx.date, { fondo_trabajo, fondo_gasolina, fondo_jornada });
    ctx.toast("Fondo guardado");
    ctx.rerender();
  });

  root.querySelector('[data-action="add-trip"]')?.addEventListener("click", async () => {
    const fare = Number(root.querySelector("#trip-fare").value);
    if (!fare || fare <= 0) return ctx.toast("Escribe el cobro del viaje", true);
    const tip = Number(root.querySelector("#trip-tip").value) || 0;
    const payment_method = root.querySelector("#trip-method").value;
    const note = root.querySelector("#trip-note").value;
    await api.createTrip({ date: ctx.date, time: timeNow(), fare, tip, payment_method, note });
    ctx.rerender();
  });

  root.querySelectorAll('[data-action="delete-trip"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.deleteTrip(btn.dataset.id);
      ctx.rerender();
    })
  );

  root.querySelector('[data-action="add-expense"]')?.addEventListener("click", async () => {
    const amount = Number(root.querySelector("#exp-amount").value);
    if (!amount || amount <= 0) return ctx.toast("Escribe el monto del gasto", true);
    const category = root.querySelector("#exp-category").value;
    const payment_method = root.querySelector("#exp-method").value;
    const note = root.querySelector("#exp-note").value;
    await api.createExpense({ date: ctx.date, category, amount, payment_method, note });
    ctx.rerender();
  });

  root.querySelectorAll('[data-action="delete-expense"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.deleteExpense(btn.dataset.id);
      ctx.rerender();
    })
  );
}
