import { api } from "./api.js";
import { fmtMoney, fmtDateShort, todayStr, addDays } from "./utils.js";

let range = "30"; // '7' | '30' | 'month' | 'all'
let chart = null;

function rangeToDates() {
  const to = todayStr();
  if (range === "7") return { from: addDays(to, -6), to };
  if (range === "30") return { from: addDays(to, -29), to };
  if (range === "month") {
    const [y, m] = to.split("-");
    return { from: `${y}-${m}-01`, to };
  }
  return { from: "2020-01-01", to };
}

const CATEGORY_LABELS = {
  gasolina: "Gasolina",
  comida_jornada: "Comida / jornada",
  mantenimiento: "Mantenimiento",
  imprevistos: "Imprevistos",
  otro: "Otro",
};

export async function render(root, ctx) {
  root.innerHTML = `<div class="loading">Calculando métricas…</div>`;
  const { from, to } = rangeToDates();
  const [resumen, tipsRes] = await Promise.all([api.getMetricsResumen(from, to), api.getMetricsTips()]);

  root.innerHTML = `
    <div class="range-tabs">
      ${rangeBtn("7", "7 días")}
      ${rangeBtn("30", "30 días")}
      ${rangeBtn("month", "Este mes")}
      ${rangeBtn("all", "Todo")}
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Total generado</div>
        <div class="stat-value mono">${fmtMoney(resumen.total_ingresos)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Promedio diario</div>
        <div class="stat-value mono">${fmtMoney(resumen.promedio_diario)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Mejor día</div>
        <div class="stat-value mono">${resumen.mejor_dia ? fmtMoney(resumen.mejor_dia.total) : "—"}</div>
        <div class="stat-sub">${resumen.mejor_dia ? fmtDateShort(resumen.mejor_dia.date) : ""}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Día más flojo</div>
        <div class="stat-value mono">${resumen.peor_dia ? fmtMoney(resumen.peor_dia.total) : "—"}</div>
        <div class="stat-sub">${resumen.peor_dia ? fmtDateShort(resumen.peor_dia.date) : ""}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Ingresos por día</div>
      <canvas id="income-chart" height="160"></canvas>
    </div>

    <div class="card">
      <div class="card-title">Gastos por categoría</div>
      ${
        resumen.gastos_por_categoria.length === 0
          ? `<p class="hint">Sin gastos registrados en este periodo.</p>`
          : `<div class="bar-list">
              ${resumen.gastos_por_categoria
                .map((g) => {
                  const max = Math.max(...resumen.gastos_por_categoria.map((x) => x.total), 1);
                  const pct = Math.max(4, Math.round((g.total / max) * 100));
                  return `<div class="bar-row">
                    <div class="bar-row-label"><span>${CATEGORY_LABELS[g.categoria] || g.categoria}</span><span class="mono">${fmtMoney(
                    g.total
                  )}</span></div>
                    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                    <div class="bar-sub">promedio/día ${fmtMoney(g.promedio_dia)}</div>
                  </div>`;
                })
                .join("")}
            </div>`
      }
    </div>

    <div class="card">
      <div class="card-title">Repartido por billetera</div>
      ${
        resumen.repartido_por_billetera.every((w) => w.total === 0)
          ? `<p class="hint">Todavía no hay reparto en este periodo.</p>`
          : `<div class="list">
              ${resumen.repartido_por_billetera
                .map(
                  (w) => `<div class="row-baseline" style="justify-content:space-between; padding:6px 0">
                    <span><span class="dot" style="background:${w.color}"></span>${w.name}</span>
                    <span class="mono strong">${fmtMoney(w.total)}</span>
                  </div>`
                )
                .join("")}
            </div>`
      }
    </div>

    <div class="card tips-card">
      <div class="card-title">Tips</div>
      <ul class="tips-list">
        ${tipsRes.tips.map((t) => `<li>${t}</li>`).join("")}
      </ul>
    </div>
  `;

  root.querySelectorAll("[data-range]").forEach((btn) =>
    btn.addEventListener("click", () => {
      range = btn.dataset.range;
      render(root, ctx);
    })
  );

  drawChart(root, resumen.serie_diaria);
}

function rangeBtn(value, label) {
  return `<button class="range-btn ${range === value ? "active" : ""}" data-range="${value}">${label}</button>`;
}

function drawChart(root, serie) {
  const canvas = root.querySelector("#income-chart");
  if (!canvas || typeof window.Chart === "undefined") return;
  if (chart) {
    chart.destroy();
    chart = null;
  }
  chart = new window.Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: serie.map((d) => fmtDateShort(d.date)),
      datasets: [
        {
          data: serie.map((d) => d.total),
          borderColor: "#D9A441",
          backgroundColor: "rgba(217,164,65,0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color: "#4A5560" }, grid: { color: "#EDE6D6" } },
        x: { ticks: { color: "#4A5560" }, grid: { display: false } },
      },
    },
  });
}
