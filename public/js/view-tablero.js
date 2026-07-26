import { api } from "./api.js";
import {
  fmtMoney,
  fmtCronometro,
  fmtDuracion,
  escapeHtml,
  PAYMENT_LABELS,
  EXPENSE_CATEGORIES,
} from "./utils.js";

let cronoInterval = null;
let metodoCobroSel = "efectivo";
let metodoPagoSel = "efectivo";

function paymentChips(name, selected) {
  return `<div class="chip-toggle" data-group="${name}">
    ${Object.entries(PAYMENT_LABELS)
      .map(([v, l]) => `<button type="button" data-value="${v}" class="${v === selected ? "active" : ""}">${l}</button>`)
      .join("")}
  </div>`;
}

export async function render(root, ctx) {
  clearInterval(cronoInterval);
  root.innerHTML = `<div class="loading">Cargando turno…</div>`;
  const turno = await api.getTurnoActivo();

  if (!turno) {
    root.innerHTML = `
      <div class="card">
        <div class="card-title">Iniciar turno</div>
        <p class="hint">Anota con cuánto sale hoy. Puede variar cada día.</p>
        <div class="row-3">
          <label class="field"><span>Fondo de trabajo</span><input type="number" inputmode="decimal" id="ft" value="500" /></label>
          <label class="field"><span>Gasolina</span><input type="number" inputmode="decimal" id="fg" value="100" /></label>
          <label class="field"><span>Jornada</span><input type="number" inputmode="decimal" id="fj" value="100" /></label>
        </div>
        <label class="field"><span>Meta del turno (opcional)</span><input type="number" inputmode="decimal" id="meta" placeholder="Ej. 800" /></label>
        <button class="btn btn-amber" data-action="iniciar">▶ Iniciar turno</button>
      </div>
    `;
    root.querySelector('[data-action="iniciar"]').addEventListener("click", async () => {
      const fondo_trabajo = Number(root.querySelector("#ft").value) || 0;
      const fondo_gasolina = Number(root.querySelector("#fg").value) || 0;
      const fondo_jornada = Number(root.querySelector("#fj").value) || 0;
      const meta_diaria = root.querySelector("#meta").value;
      await api.iniciarTurno({
        fondo_trabajo,
        fondo_gasolina,
        fondo_jornada,
        meta_diaria: meta_diaria || null,
      });
      ctx.toast("Turno iniciado");
      ctx.rerender();
    });
    return;
  }

  const [trips, gastos] = await Promise.all([api.getTrips(turno.id), api.getGastosCalle(turno.id)]);
  const metaPct = turno.meta_diaria ? Math.min(100, Math.round((turno.ingreso_bruto / turno.meta_diaria) * 100)) : null;

  root.innerHTML = `
    <div class="turno-activo">
      <div class="ticket-eyebrow">TURNO EN CURSO</div>
      <div class="crono-display mono" id="crono">${fmtCronometro(turno.start_at)}</div>
      <div class="turno-stats">
        <div class="turno-stat">
          <div class="turno-stat-label">GENERADO</div>
          <div class="turno-stat-value">${fmtMoney(turno.ingreso_bruto)}</div>
        </div>
        <div class="turno-stat">
          <div class="turno-stat-label">VIAJES</div>
          <div class="turno-stat-value">${turno.viajes_count}</div>
        </div>
        <div class="turno-stat">
          <div class="turno-stat-label">PROM/HORA</div>
          <div class="turno-stat-value">${fmtMoney(turno.promedio_hora)}</div>
        </div>
      </div>
      ${
        metaPct != null
          ? `<div class="meta-bar-track"><div class="meta-bar-fill" style="width:${metaPct}%"></div></div>
             <div class="meta-bar-label">${metaPct}% de la meta de ${fmtMoney(turno.meta_diaria)}</div>`
          : ""
      }
      <button class="btn btn-rose-soft" data-action="terminar" style="margin-top:12px">■ Terminar turno</button>
    </div>

    <div class="card">
      <div class="card-title">Anotar viaje</div>
      <label class="field"><span>Negocio / cliente (opcional)</span><input type="text" id="trip-negocio" placeholder="Ej. Tacos El Paisa" /></label>
      <div class="row-2">
        <label class="field"><span>Costo en el negocio (si pagó ahí)</span><input type="number" inputmode="decimal" id="trip-costo" placeholder="0.00" /></label>
        <label class="field"><span>Envío (tu ganancia)</span><input type="number" inputmode="decimal" id="trip-envio" placeholder="0.00" /></label>
      </div>
      <label class="field"><span>Propina</span><input type="number" inputmode="decimal" id="trip-propina" placeholder="0.00" /></label>
      <label class="field"><span>¿Cómo pagó el cliente el total?</span>${paymentChips("trip-metodo", metodoCobroSel)}</label>
      <button class="btn btn-amber" data-action="add-trip" style="margin-top:8px">+ Agregar viaje</button>
    </div>

    <div class="list">
      ${
        trips.length === 0
          ? `<div class="empty">Sin viajes en este turno todavía.</div>`
          : trips
              .map(
                (t) => `<div class="list-item">
          <div class="list-item-main">
            <span class="mono time">${t.hora || ""}</span>
            <div>
              <div class="row-baseline">
                <span class="mono strong">${fmtMoney(Number(t.envio) + Number(t.propina))}</span>
                <span class="chip">${PAYMENT_LABELS[t.metodo_cobro] || t.metodo_cobro}</span>
                ${Number(t.costo_negocio) > 0 ? `<span class="chip chip-muted">costo ${fmtMoney(t.costo_negocio)}</span>` : ""}
              </div>
              ${t.negocio ? `<div class="note">${escapeHtml(t.negocio)}</div>` : ""}
            </div>
          </div>
          <button class="icon-btn" data-action="delete-trip" data-id="${t.id}" aria-label="Eliminar viaje">✕</button>
        </div>`
              )
              .join("")
      }
    </div>

    <div class="card">
      <div class="card-title">Anotar gasto de calle</div>
      <div class="row-2">
        <label class="field"><span>Categoría</span><select id="gasto-cat">${EXPENSE_CATEGORIES.map(
          (c) => `<option value="${c.value}">${c.label}</option>`
        ).join("")}</select></label>
        <label class="field"><span>Monto</span><input type="number" inputmode="decimal" id="gasto-monto" placeholder="0.00" /></label>
      </div>
      <label class="field"><span>¿Cómo lo pagó?</span>${paymentChips("gasto-metodo", metodoPagoSel)}</label>
      <label class="field"><span>Nota (opcional)</span><input type="text" id="gasto-nota" placeholder="¿En qué se gastó?" /></label>
      <button class="btn btn-rose-outline" data-action="add-gasto" style="margin-top:8px">+ Agregar gasto</button>
    </div>

    <div class="list">
      ${
        gastos.length === 0
          ? `<div class="empty">Sin gastos anotados en este turno.</div>`
          : gastos
              .map(
                (g) => `<div class="list-item">
          <div class="list-item-main">
            <div>
              <div class="row-baseline">
                <span class="mono strong">${fmtMoney(g.monto)}</span>
                <span class="chip">${EXPENSE_CATEGORIES.find((c) => c.value === g.categoria)?.label || g.categoria}</span>
                <span class="chip chip-muted">${PAYMENT_LABELS[g.metodo_pago] || g.metodo_pago}</span>
              </div>
              ${g.nota ? `<div class="note">${escapeHtml(g.nota)}</div>` : ""}
            </div>
          </div>
          <button class="icon-btn" data-action="delete-gasto" data-id="${g.id}" aria-label="Eliminar gasto">✕</button>
        </div>`
              )
              .join("")
      }
    </div>
  `;

  cronoInterval = setInterval(() => {
    const el = root.querySelector("#crono");
    if (el) el.textContent = fmtCronometro(turno.start_at);
    else clearInterval(cronoInterval);
  }, 1000);

  root.querySelectorAll('[data-group] button').forEach((btn) =>
    btn.addEventListener("click", () => {
      const group = btn.closest("[data-group]");
      group.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (group.dataset.group === "trip-metodo") metodoCobroSel = btn.dataset.value;
      if (group.dataset.group === "gasto-metodo") metodoPagoSel = btn.dataset.value;
    })
  );

  root.querySelector('[data-action="terminar"]').addEventListener("click", async () => {
    await api.terminarTurno(turno.id);
    ctx.toast("Turno terminado. Ve a Historial para cerrar la caja.");
    ctx.rerender();
  });

  root.querySelector('[data-action="add-trip"]').addEventListener("click", async () => {
    const envio = Number(root.querySelector("#trip-envio").value) || 0;
    const propina = Number(root.querySelector("#trip-propina").value) || 0;
    if (envio <= 0 && propina <= 0) return ctx.toast("Escribe el envío o la propina", true);
    await api.createTrip({
      turno_id: turno.id,
      negocio: root.querySelector("#trip-negocio").value,
      costo_negocio: Number(root.querySelector("#trip-costo").value) || 0,
      envio,
      propina,
      metodo_cobro: metodoCobroSel,
    });
    metodoCobroSel = "efectivo";
    ctx.rerender();
  });

  root.querySelectorAll('[data-action="delete-trip"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.deleteTrip(btn.dataset.id);
      ctx.rerender();
    })
  );

  root.querySelector('[data-action="add-gasto"]').addEventListener("click", async () => {
    const monto = Number(root.querySelector("#gasto-monto").value);
    if (!monto || monto <= 0) return ctx.toast("Escribe el monto del gasto", true);
    await api.createGastoCalle({
      turno_id: turno.id,
      categoria: root.querySelector("#gasto-cat").value,
      monto,
      metodo_pago: metodoPagoSel,
      nota: root.querySelector("#gasto-nota").value,
    });
    metodoPagoSel = "efectivo";
    ctx.rerender();
  });

  root.querySelectorAll('[data-action="delete-gasto"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.deleteGastoCalle(btn.dataset.id);
      ctx.rerender();
    })
  );
}

export function stopCrono() {
  clearInterval(cronoInterval);
}
