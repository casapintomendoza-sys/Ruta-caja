import { api } from "./api.js";
import { fmtMoney, fmtDateShort, escapeHtml, WALLET_PALETTE } from "./utils.js";

let openTransferFor = null;
let openAdjustFor = null;
let adjustType = "gasto";
let adjustSlot = "cash";
let transferSlotOrigen = "cash";
let transferSlotDestino = "cash";
let openCommitmentsFor = null;
let confirmDeleteWallet = null;
let showAddWallet = false;
let showAddBank = false;

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Cargando billeteras…</div>`;
  const [wallets, bankAccounts] = await Promise.all([api.getWallets(), api.getBankAccounts()]);
  const fondo = wallets.find((w) => w.is_fondo);
  const billeteras = wallets.filter((w) => !w.is_fondo);

  const commitmentsByWallet = {};
  if (openCommitmentsFor) commitmentsByWallet[openCommitmentsFor] = await api.getCommitments(openCommitmentsFor);

  root.innerHTML = `
    <div class="card" style="background:var(--ink); color:var(--paper); border:none">
      <div class="card-title" style="color:var(--paper)">El Fondo <span class="badge" style="background:rgba(247,242,231,0.12); color:var(--paper)">sin repartir</span></div>
      <div class="slot-row" style="color:rgba(247,242,231,0.65)"><span>Efectivo</span><b style="color:var(--paper)">${fmtMoney(fondo?.cash)}</b></div>
      <div class="slot-row" style="color:rgba(247,242,231,0.65)"><span>Cuenta${fondo?.bank_account_name ? ` (${escapeHtml(fondo.bank_account_name)})` : ""}</span><b style="color:var(--paper)">${fmtMoney(fondo?.bank)}</b></div>
      <button class="btn btn-outline btn-sm" style="margin-top:10px; border-color:rgba(247,242,231,0.3); color:var(--paper)" data-action="toggle-transfer" data-wallet="${fondo?.id}">Transferir desde el Fondo</button>
      ${openTransferFor === fondo?.id ? transferFormHtml(fondo, wallets) : ""}
    </div>

    <div class="list">
      ${billeteras.map((w) => walletCard(w, wallets, commitmentsByWallet[w.id])).join("")}
      ${addWalletCardHtml(bankAccounts)}
    </div>

    <div class="card">
      <div class="card-title">Cuentas bancarias</div>
      <div class="list">
        ${
          bankAccounts.length === 0
            ? `<p class="hint">Sin cuentas registradas.</p>`
            : bankAccounts
                .map(
                  (b) => `<div class="list-item">
                <span>${escapeHtml(b.name)}</span>
                <button class="icon-btn" data-action="delete-bank" data-id="${b.id}">✕</button>
              </div>`
                )
                .join("")
        }
      </div>
      ${
        showAddBank
          ? `<div class="inline-form">
               <input type="text" id="new-bank-name" placeholder="Nombre del banco/cuenta" />
               <div class="btn-row">
                 <button class="btn btn-amber btn-sm" data-action="create-bank">Agregar</button>
                 <button class="btn btn-outline btn-sm" data-action="cancel-bank">Cancelar</button>
               </div>
             </div>`
          : `<button class="btn btn-dashed btn-sm" style="margin-top:10px" data-action="show-add-bank">+ Cuenta bancaria</button>`
      }
    </div>
  `;

  attachListeners(root, ctx, wallets);
}

function walletCard(w, allWallets, commitments) {
  const showTransfer = openTransferFor === w.id;
  const showAdjust = openAdjustFor === w.id;
  const showCommitments = openCommitmentsFor === w.id;
  const pending = (commitments || []).filter((c) => c.active);
  const dailyGoal = pending.reduce((s, c) => s + (c.daily_target || 0), 0);
  const overdueCount = pending.filter((c) => c.overdue).length;

  return `
    <div class="card wallet-card">
      <div class="row-baseline" style="justify-content:space-between">
        <div class="row-baseline"><span class="dot" style="background:${w.color}"></span>
          <span class="wallet-name">${escapeHtml(w.name)}</span></div>
        <span class="mono strong big">${fmtMoney(w.total)}</span>
      </div>
      <div class="slot-row"><span>Efectivo</span><b>${fmtMoney(w.cash)}</b></div>
      <div class="slot-row"><span>Cuenta${w.bank_account_name ? ` (${escapeHtml(w.bank_account_name)})` : ""}</span><b>${fmtMoney(
    w.bank
  )}</b></div>

      ${
        overdueCount > 0
          ? `<div class="alert-badge">⚠ ${overdueCount} compromiso${overdueCount > 1 ? "s" : ""} vencido${overdueCount > 1 ? "s" : ""}</div>`
          : dailyGoal > 0
          ? `<div class="goal-badge">Meta sugerida hoy: <b class="mono">${fmtMoney(dailyGoal)}</b></div>`
          : ""
      }

      <div class="btn-row">
        <button class="btn btn-rose-soft btn-sm" data-action="toggle-adjust" data-wallet="${w.id}" data-type="gasto">− Gasto</button>
        <button class="btn btn-teal-soft btn-sm" data-action="toggle-adjust" data-wallet="${w.id}" data-type="ingreso">+ Ingreso</button>
        <button class="btn btn-outline btn-sm" data-action="toggle-transfer" data-wallet="${w.id}">Transferir</button>
        <button class="btn btn-outline btn-sm" data-action="toggle-commitments" data-wallet="${w.id}">Compromisos</button>
        <button class="icon-btn" data-action="delete-wallet" data-wallet="${w.id}">✕</button>
      </div>

      ${showAdjust ? adjustFormHtml(w) : ""}
      ${showTransfer ? transferFormHtml(w, allWallets) : ""}
      ${showCommitments ? commitmentsSection(w, commitments || []) : ""}
    </div>
  `;
}

function adjustFormHtml(w) {
  return `<div class="inline-form">
    <div class="chip-toggle" data-adjust-slot>
      <button type="button" data-value="cash" class="${adjustSlot === "cash" ? "active" : ""}">Efectivo</button>
      <button type="button" data-value="bank" class="${adjustSlot === "bank" ? "active" : ""}">Cuenta</button>
    </div>
    <input type="number" inputmode="decimal" class="adjust-amount" placeholder="Monto" />
    <input type="text" class="adjust-note" placeholder="Nota" />
    <button class="btn btn-ink btn-sm" data-action="save-adjust" data-wallet="${w.id}">Registrar</button>
  </div>`;
}

function transferFormHtml(originWallet, allWallets) {
  const options = allWallets
    .filter((w) => w.id !== originWallet.id)
    .map((w) => `<option value="${w.id}">${escapeHtml(w.name)}</option>`)
    .join("");
  return `<div class="inline-form">
    <label class="field"><span>Slot de origen (${escapeHtml(originWallet.name)})</span>
      <div class="chip-toggle" data-transfer-slot-origen>
        <button type="button" data-value="cash" class="${transferSlotOrigen === "cash" ? "active" : ""}">Efectivo</button>
        <button type="button" data-value="bank" class="${transferSlotOrigen === "bank" ? "active" : ""}">Cuenta</button>
      </div>
    </label>
    <label class="field"><span>Billetera destino</span>
      <select class="transfer-destino">
        <option value="${originWallet.id}">${escapeHtml(originWallet.name)} (mover entre sus propios slots)</option>
        ${options}
      </select>
    </label>
    <label class="field"><span>Slot de destino</span>
      <div class="chip-toggle" data-transfer-slot-destino>
        <button type="button" data-value="cash" class="${transferSlotDestino === "cash" ? "active" : ""}">Efectivo</button>
        <button type="button" data-value="bank" class="${transferSlotDestino === "bank" ? "active" : ""}">Cuenta</button>
      </div>
    </label>
    <input type="number" inputmode="decimal" class="transfer-amount" placeholder="Monto" />
    <input type="text" class="transfer-note" placeholder="Nota (opcional)" />
    <button class="btn btn-ink btn-sm" data-action="save-transfer" data-wallet="${originWallet.id}">Transferir</button>
  </div>`;
}

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
                  ? `Venció el ${fmtDateShort(c.next_due_date)}`
                  : `Vence en ${c.days_left} día${c.days_left === 1 ? "" : "s"} · meta diaria <b class="mono">${fmtMoney(
                      c.daily_target
                    )}</b>`
              }
              ${c.recurring ? " · se repite" : " · pago único"}
              ${c.total_remaining_estimate != null ? ` · quedan ${fmtMoney(c.total_remaining_estimate)} en total` : ""}
            </div>
          </div>
          <div class="btn-row" style="margin-top:0">
            <select class="pay-slot" data-commitment="${c.id}" style="width:auto; padding:6px 8px; font-size:12px">
              <option value="cash">Efectivo</option>
              <option value="bank">Cuenta</option>
            </select>
            <button class="btn btn-ink btn-sm" data-action="pay-commitment" data-id="${c.id}">Pagado</button>
            <button class="icon-btn" data-action="delete-commitment" data-id="${c.id}">✕</button>
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
        <label class="field"><span>Fecha de finalización (opcional)</span><input type="date" class="new-c-end" /></label>
        <button class="btn btn-amber btn-sm" data-action="add-commitment" data-wallet="${w.id}">+ Agregar compromiso</button>
      </div>
    </div>
  `;
}

function addWalletCardHtml(bankAccounts) {
  return `
    <div class="card">
      ${
        showAddWallet
          ? `<div id="add-wallet-form">
               <input type="text" id="new-wallet-name" placeholder="Nombre (ej. Ahorros, Gasolina…)" style="margin-bottom:8px" />
               <select id="new-wallet-bank" style="margin-bottom:8px">
                 <option value="">Sin cuenta bancaria vinculada</option>
                 ${bankAccounts.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join("")}
               </select>
               <div class="palette-row">
                 ${WALLET_PALETTE.map(
                   (c, i) => `<button class="palette-dot ${i === 0 ? "selected" : ""}" data-color="${c}" style="background:${c}"></button>`
                 ).join("")}
               </div>
               <div class="btn-row">
                 <button class="btn btn-amber btn-sm" data-action="create-wallet">Crear</button>
                 <button class="btn btn-outline btn-sm" data-action="cancel-wallet">Cancelar</button>
               </div>
             </div>`
          : `<button class="btn btn-dashed" id="show-add-wallet">+ Nueva billetera</button>`
      }
    </div>
  `;
}

function attachListeners(root, ctx, wallets) {
  root.querySelectorAll('[data-action="toggle-transfer"]').forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.wallet);
      openTransferFor = openTransferFor === id ? null : id;
      openAdjustFor = null;
      transferSlotOrigen = "cash";
      transferSlotDestino = "cash";
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="toggle-adjust"]').forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.wallet);
      adjustType = btn.dataset.type;
      openAdjustFor = openAdjustFor === id ? null : id;
      openTransferFor = null;
      ctx.rerender();
    })
  );

  root.querySelectorAll("[data-adjust-slot] button").forEach((btn) =>
    btn.addEventListener("click", () => {
      adjustSlot = btn.dataset.value;
      btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    })
  );
  root.querySelectorAll("[data-transfer-slot-origen] button").forEach((btn) =>
    btn.addEventListener("click", () => {
      transferSlotOrigen = btn.dataset.value;
      btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    })
  );
  root.querySelectorAll("[data-transfer-slot-destino] button").forEach((btn) =>
    btn.addEventListener("click", () => {
      transferSlotDestino = btn.dataset.value;
      btn.parentElement.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    })
  );

  root.querySelectorAll('[data-action="save-adjust"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const card = btn.closest(".inline-form");
      const amount = Number(card.querySelector(".adjust-amount").value);
      const nota = card.querySelector(".adjust-note").value;
      if (!amount || amount <= 0) return ctx.toast("Escribe un monto válido", true);
      await api.createAjuste({ wallet_id: btn.dataset.wallet, slot: adjustSlot, tipo: adjustType, monto: amount, nota });
      openAdjustFor = null;
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="save-transfer"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const card = btn.closest(".inline-form");
      const amount = Number(card.querySelector(".transfer-amount").value);
      const destino = Number(card.querySelector(".transfer-destino").value);
      const nota = card.querySelector(".transfer-note").value;
      if (!amount || amount <= 0) return ctx.toast("Escribe un monto válido", true);
      try {
        await api.createTransferencia({
          wallet_origen_id: Number(btn.dataset.wallet),
          slot_origen: transferSlotOrigen,
          wallet_destino_id: destino,
          slot_destino: transferSlotDestino,
          monto: amount,
          nota,
        });
        openTransferFor = null;
        ctx.rerender();
      } catch (e) {
        ctx.toast(e.message, true);
      }
    })
  );

  root.querySelectorAll('[data-action="delete-wallet"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.wallet);
      if (confirmDeleteWallet !== id) {
        confirmDeleteWallet = id;
        ctx.rerender();
        return;
      }
      await api.deleteWallet(id);
      confirmDeleteWallet = null;
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
      await api.createCommitment(btn.dataset.wallet, { name, amount, next_due_date: due, recurring, end_date: end || null });
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="pay-commitment"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      const select = root.querySelector(`.pay-slot[data-commitment="${btn.dataset.id}"]`);
      await api.payCommitment(btn.dataset.id, select ? select.value : "cash");
      ctx.rerender();
    })
  );

  root.querySelectorAll('[data-action="delete-commitment"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.deleteCommitment(btn.dataset.id);
      ctx.rerender();
    })
  );

  const showAddBtn = root.querySelector("#show-add-wallet");
  showAddBtn?.addEventListener("click", () => {
    showAddWallet = true;
    ctx.rerender();
  });
  root.querySelector('[data-action="cancel-wallet"]')?.addEventListener("click", () => {
    showAddWallet = false;
    ctx.rerender();
  });
  let selectedColor = WALLET_PALETTE[0];
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
    const bankAccountId = root.querySelector("#new-wallet-bank").value;
    await api.createWallet({ name, color: selectedColor, bank_account_id: bankAccountId || null });
    showAddWallet = false;
    ctx.rerender();
  });

  const showAddBankBtn = root.querySelector("#show-add-bank");
  showAddBankBtn?.addEventListener("click", () => {
    showAddBank = true;
    ctx.rerender();
  });
  root.querySelector('[data-action="cancel-bank"]')?.addEventListener("click", () => {
    showAddBank = false;
    ctx.rerender();
  });
  root.querySelector('[data-action="create-bank"]')?.addEventListener("click", async () => {
    const name = root.querySelector("#new-bank-name").value.trim();
    if (!name) return ctx.toast("Escribe un nombre", true);
    await api.createBankAccount(name);
    showAddBank = false;
    ctx.rerender();
  });
  root.querySelectorAll('[data-action="delete-bank"]').forEach((btn) =>
    btn.addEventListener("click", async () => {
      await api.deleteBankAccount(btn.dataset.id);
      ctx.rerender();
    })
  );
}
