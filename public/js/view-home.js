import { api } from "./api.js";
import { fmtMoney } from "./utils.js";

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Cargando…</div>`;
  const [turnoActivo, wallets] = await Promise.all([api.getTurnoActivo(), api.getWallets()]);

  const fondo = wallets.find((w) => w.is_fondo);
  const billeteras = wallets.filter((w) => !w.is_fondo);
  const totalBilleteras = billeteras.reduce((s, w) => s + w.total, 0);

  root.innerHTML = `
    <div class="role-cards">
      <button class="role-card role-card-operativo" data-action="go-operativo">
        <div class="role-card-title">🚴 Panel Operativo</div>
        <div class="role-card-sub">Turnos, viajes y gastos de calle</div>
        <div class="role-card-stat">
          ${
            turnoActivo
              ? `Turno activo · ${fmtMoney(turnoActivo.ingreso_bruto)} generado`
              : "Sin turno activo ahora mismo"
          }
        </div>
      </button>

      <button class="role-card role-card-central" data-action="go-central">
        <div class="role-card-title">🏠 Panel Central</div>
        <div class="role-card-sub">Billeteras, compromisos y métricas</div>
        <div class="role-card-stat mono">${fmtMoney(totalBilleteras)} en billeteras${
    fondo ? ` · ${fmtMoney(fondo.total)} sin repartir` : ""
  }</div>
      </button>
    </div>
  `;

  root.querySelector('[data-action="go-operativo"]')?.addEventListener("click", () => ctx.goSection("operativo"));
  root.querySelector('[data-action="go-central"]')?.addEventListener("click", () => ctx.goSection("central"));
}
