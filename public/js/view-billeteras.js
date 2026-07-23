import { api } from "./api.js";
import { fmtMoney, fmtDateShort, escapeHtml, WALLET_PALETTE } from "./utils.js";

let openWalletId = null;
let openCommitmentsFor = null;
let openAdjustFor = null;

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Cargando billeteras…</div>`;
  const [wallets, movements] = await Promise.all([api.getWallets(), api.getMovements(25)]);

  const commitmentsByWallet = {};
  if (openCommitmentsFor) {
    commitmentsByWallet[openCommitmentsFor] = await api.getCommitments(openCommitmentsFor);
  }

  const total = wallets.reduce((s, w) => s + Number(w.balance), 0);

  root.innerHTML = `
    <div class="ticket ticket-dark">
      <div class="ticket-eyebrow">TOTAL EN BILLETERAS</div>
      <div class="ticket-big">${fmtMoney(total)}</div>
    </div>

    <div class="list">
      ${wallets.map((w) => walletCard(w, commitmentsByWallet[w.id])).join("")}
      ${addWalletCardHtml()}
    </div>

    ${movements.length
      ? `<div class="section-label">Movimientos recientes</div>
         <div class="list">
           ${movements
             .map(
               (m) => `<div class="list-item">
                 <div class="list-item-main">
                   <div>
                     <div class="row-baseline"><span>${m.wallet_name}</span><span class="chip chip-muted">${escapeHtml(
                 m.note || ""
               )}</span></div>
                     <div class="note mono">${fmtDateShort(
                       m.date && m.date.slice ? m.date.slice(0, 10) : m.date
                     )}</div>
                   </div>
                 </div>
                 <span class="mono strong ${Number(m.amount) < 0 ? "diff-under" : "diff-ok"}">${fmtMoney(
                 m.amount
               )}</span>
               </div>`
             )
             .join("")}
         </div>`
      : ""}
  `;

  attachListeners(root, ctx, wallets, commitmentsByWallet);
}

function walletCard(w, commitments) {
  const showCommitments = openCommitmentsFor === w.id;
  const showAdjust = openAdjustFor === w.id;
  const pending = (commitments || []).filter((c) => c.active);
  const dailyGoal = pending.reduce((s, c) => s + (c.daily_target || 0), 0);
  const overdueCount = pending.filter((c) => c.overdue).length;

  return `
    <div class="card wallet-card">
      <div class="row-baseline" style="justify-content:space-between">
        <div class="row-baseline"><span class="dot" style="background:${w.color}"></span>
          <span class="wallet-name">${escapeHtml(w.name)}</span></div>
        <span class="mono strong big">${fmtMoney(w.balance)}</span>
      </div>

      ${
        overdueCount > 0
          ? `<div class="alert-badge">⚠ ${overdueCount} compromiso${overdueCount > 1 ? "s" : ""} vencido${
              overdueCount > 1 ? "s" : ""
            }</div>`
          : dailyGoal > 0
          ? `<div class="goal-badge">Meta sugerida hoy: <b class="mono">${fmtMoney(dailyGoal)}</b></div>`
          : ""
      }

      <div class="btn-row">
        <button class="btn btn-rose-soft btn-sm" data-action="toggle-adjust" data-wallet="${w.id}" data-type="gasto">− Gasto</button>
        <button class="btn btn-teal-soft btn-sm" data-action="toggle-adjust" data-wallet="${w.id}" data-type="ingreso">+ Ingreso</button>
        <button class="btn btn-outline btn-sm" data-action="toggle-commitments" data-wallet="${w.id}">Compromisos</button>
        <button class="icon-btn" data-action="delete-wallet" data-wallet="${w.id}" aria-label="Eliminar billetera">✕</button>
      </div>

      ${
        showAdjust
          ? `<div class="inline-form">
               <input type="number" inputmode="decimal" class="adjust-amount" placeholder="Monto" />
               <input type="text" class="adjust-note" placeholder="Nota (ej. supermercado, gasolina…)" />
               <button class="btn btn-ink btn-sm" data-action="save-adjust" data-wallet="${w.id}" data-type="${openAdjustType}">Registrar</button>
             </div>`
          : ""
      }

      ${showCommitments ? commitmentsSection(w, commitments || []) : ""}
    </div>
  `;
}

let openAdjustType = "gasto";

function commitmentsSection(w, commitments) {
  return `
    <div class="commitments">
      ${
        commitments.length === 0
          ? `<p class="hint">Sin compromisos programados en esta billetera.</p>`
          : commitments
              .map(
                (c) => `
        <div class="commitment-row ${c.overdue ? "commitment-overdue" : ""}">
          <div>
            <div class="row-baseline"><span class="strong">${escapeHtml(c.name)}</span>
              <span class="mono">${fmtMoney(c.amount)}</span></div>
            <div class="note">
              ${
                c.overdue
                  ? `Venció el ${fmtDateShort(c.next_due_date.slice ? c.next_due_date.slice(0, 10) : c.next_due_date)}`
                  : `Vence en ${c.days_left} día${c.days_left === 1 ? "" : "s"} · meta diaria <b class="mono">${fmtMoney(
                      c.daily_target
                    )}</b>`
              }
              ${c.recurring ? " · se repite" : " · pago único"}
              ${
                c.total_remaining_estimate != null
                  ? ` · quedan ${fmtMoney(c.total_remaining_estimate)} en total`
                  : ""
              }
            </div>
          </div>
          <div class="btn-row">
            <button class="btn btn-ink btn-sm" data-action="pay-commitment" data-id="${c.id}">Pagado</button>
            <button class="icon-btn" data-action="delete-commitment" data-id="${c.id}" aria-label="Eliminar">✕</button>
          </div>
        </div>`
              )
              .join("")
      }
      <div class="inline-form" style="margin-top:10px">
        <input type="text" class="new-c-name" placeholder="Nombre (ej. Renta, Internet…)" />
        <div class="row-2">
          <input type="number" inputmode="decimal" class="new-c-amount" placeholder="Monto" />
          <input type="date" class="new-c-due" />
        </div>
        <label class="checkbox-row"><input type="checkbox" class="new-c-recurring" checked /> Se repite cada mes</label>
        <label class="field new-c-end-wrap"><span>Fecha de finalización (opcional)</span><input type="date" class="new-c-end" /></label>
        <button class="btn btn-amber btn-sm" data-action="add-commitment" data-wallet="${w.id}">+ Agregar compromiso</button>
      </div>
    </div>
  `;
}

function addWalletCardHtml() {
  return `
    <div class="card" id="add-wallet-card">
      <div id="add-wallet-form" style="display:none">
        <input type="text" id="new-wallet-name" placeholder="Nombre (ej. Ahorros, Gasolina…)" />
        <div class="palette-row">
          ${WALLET_PALETTE.map(
            (c, i) => `<button class="palette-dot ${i === 0 ? "selected" : ""}" data-color="${c}" style="background:${c}"></button>`
          ).join("")}
        </div>
        <div class="btn-row">
          <button class="btn btn-amber btn-sm" data-action="create-wallet">Crear</button>
          <button class="btn btn-outline btn-sm" data-action="cancel-wallet">Cancelar</button>
        </div>
      </div>
      <button class="btn btn-dashed" id="show-add-wallet">+ Nueva billetera</button>
    </div>
  `;
}

function attachListeners(root, ctx, wallets, commitmentsByWallet) {
  root.querySelector('[data-action="prev-day"]')?.addEventListener("click", () => ctx.changeDay(-1));

  root.querySelectorAll('[data-action="toggle-adjust"]').forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.wallet);
      openAdjustType = btn.dataset.type;
      openAdjustFor = openAdjustFor === id && openAdjustTypeMatches(id) ? null : id;
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="save-adjust"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const card = btn.closest(".wallet-card");
      const amount = Number(card.querySelector(".adjust-amount").value);
      const note = card.querySelector(".adjust-note").value;
      if (!amount || amount <= 0) return ctx.toast("Escribe un monto válido", true);
      await api.registerWalletMovement(btn.dataset.wallet, { type: btn.dataset.type, amount, note });
      openAdjustFor = null;
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="delete-wallet"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirmInline(btn, "¿Eliminar esta billetera?")) return;
      await api.deleteWallet(btn.dataset.wallet);
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="toggle-commitments"]').forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.wallet);
      openCommitmentsFor = openCommitmentsFor === id ? null : id;
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="add-commitment"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const card = btn.closest(".commitments");
      const name = card.querySelector(".new-c-name").value.trim();
      const amount = Number(card.querySelector(".new-c-amount").value);
      const due = card.querySelector(".new-c-due").value;
      const recurring = card.querySelector(".new-c-recurring").checked;
      const end = card.querySelector(".new-c-end").value;
      if (!name || !amount || amount <= 0 || !due) return ctx.toast("Completa nombre, monto y fecha", true);
      await api.createCommitment(btn.dataset.wallet, {
        name,
        amount,
        next_due_date: due,
        recurring,
        end_date: end || null,
      });
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="pay-commitment"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.payCommitment(btn.dataset.id);
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="delete-commitment"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirmInline(btn, "¿Eliminar compromiso?")) return;
      await api.deleteCommitment(btn.dataset.id);
      ctx.rerender();
    })
  );

  const showAddBtn = root.querySelector("#show-add-wallet");
  const addForm = root.querySelector("#add-wallet-form");
  let selectedColor = WALLET_PALETTE[0];
  showAddBtn?.addEventListener("click", () => {
    addForm.style.display = "block";
    showAddBtn.style.display = "none";
  });
  root.querySelector('[data-action="cancel-wallet"]')?.addEventListener("click", () => {
    addForm.style.display = "none";
    showAddBtn.style.display = "block";
  });
  root.querySelectorAll(".palette-dot").forEach((dot) =>
    dot.addEventListener("click", () => {
      selectedColor = dot.dataset.color;
      root.querySelectorAll(".palette-dot").forEach((d) => d.classList.remove("selected"));
      dot.classList.add("selected");
    })
  );
  root.querySelector('[data-action="create-wallet"]')?.addEventListener("click", async () => {
    const name = root.querySelector("#new-wallet-name").value.trim();
    if (!name) return ctx.toast("Escribe un nombre", true);
    await api.createWallet({ name, color: selectedColor });
    ctx.rerender();
  });
}

function openAdjustTypeMatches() {
  return true;
}

function confirmInline(btn, msg) {
  // confirmación simple de dos pasos usando el propio botón
  if (btn.dataset.confirming === "1") return true;
  btn.dataset.confirming = "1";
  const original = btn.textContent;
  btn.textContent = "¿Seguro?";
  setTimeout(() => {
    btn.dataset.confirming = "0";
    btn.textContent = original;
  }, 2500);
  return false;
}
