import { todayStr, addDays } from "./utils.js";
import * as jornada from "./view-jornada.js";
import * as cierre from "./view-cierre.js";
import * as billeteras from "./view-billeteras.js";
import * as metricas from "./view-metricas.js";

const views = { jornada, cierre, billeteras, metricas };

const state = {
  tab: "jornada",
  date: todayStr(),
};

const content = document.getElementById("app-content");
const tabButtons = document.querySelectorAll(".tabbar button");
const toastEl = document.getElementById("toast");

function ctx() {
  return {
    date: state.date,
    _today: todayStr(),
    changeDay(delta) {
      const next = addDays(state.date, delta);
      if (next > todayStr()) return;
      state.date = next;
      rerender();
    },
    rerender,
    toast,
  };
}

let toastTimer = null;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
  }, 2600);
}

async function rerender() {
  const view = views[state.tab];
  try {
    await view.render(content, ctx());
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="error-box">No se pudo cargar esta pestaña. Revisa que el servidor y la base de datos estén activos.<br><span class="mono">${err.message}</span></div>`;
  }
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.tab = btn.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
    rerender();
  });
});

rerender();
