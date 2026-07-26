import * as viewHome from "./view-home.js";
import * as viewTablero from "./view-tablero.js";
import * as viewHistorial from "./view-historial.js";
import * as viewResumen from "./view-resumen.js";
import * as viewBilleteras from "./view-billeteras.js";
import * as viewMetricas from "./view-metricas.js";

const SECTIONS = {
  operativo: {
    label: "Panel Operativo",
    tabs: [
      { key: "tablero", label: "Tablero", icon: "🚴", view: viewTablero },
      { key: "historial", label: "Historial", icon: "🕒", view: viewHistorial },
    ],
  },
  central: {
    label: "Panel Central",
    tabs: [
      { key: "resumen", label: "Resumen", icon: "🏠", view: viewResumen },
      { key: "billeteras", label: "Billeteras", icon: "👛", view: viewBilleteras },
      { key: "metricas", label: "Métricas", icon: "📊", view: viewMetricas },
    ],
  },
};

const state = { section: "home", tab: null };

const content = document.getElementById("app-content");
const headerLeft = document.getElementById("header-left");
const tabbarEl = document.getElementById("tabbar");
const liveDot = document.getElementById("live-dot");
const toastEl = document.getElementById("toast");

function ctx() {
  return { rerender, toast, goSection, goTab };
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

function currentView() {
  if (state.section === "home") return viewHome;
  return SECTIONS[state.section].tabs.find((t) => t.key === state.tab).view;
}

async function rerender() {
  renderChrome();
  try {
    await currentView().render(content, ctx());
  } catch (err) {
    console.error(err);
    content.innerHTML = `<div class="error-box">No se pudo cargar esta pantalla. Revisa que el servidor y la base de datos estén activos.<br><span class="mono">${err.message}</span></div>`;
  }
}

function renderChrome() {
  if (state.section === "home") {
    headerLeft.innerHTML = `<h1>Ruta<span class="slash">/</span>Caja</h1>`;
    tabbarEl.style.display = "none";
    return;
  }
  const section = SECTIONS[state.section];
  headerLeft.innerHTML = `
    <button class="back-btn" id="back-home" aria-label="Volver">&#8249;</button>
    <h1 style="font-size:16px">${section.label}</h1>
  `;
  document.getElementById("back-home").addEventListener("click", () => goSection("home"));

  tabbarEl.style.display = "flex";
  tabbarEl.innerHTML = section.tabs
    .map(
      (t) => `<button data-tab="${t.key}" class="${t.key === state.tab ? "active" : ""}">
        <span style="font-size:16px">${t.icon}</span><span>${t.label}</span>
      </button>`
    )
    .join("");
  tabbarEl.querySelectorAll("button").forEach((btn) =>
    btn.addEventListener("click", () => goTab(btn.dataset.tab))
  );
}

function goSection(section) {
  state.section = section;
  state.tab = section === "home" ? null : SECTIONS[section].tabs[0].key;
  rerender();
}

function goTab(tab) {
  state.tab = tab;
  rerender();
}

rerender();

/* --------------------------- sincronización en vivo --------------------------- */
if (window.io) {
  const socket = window.io();
  socket.on("connect", () => liveDot?.classList.remove("off"));
  socket.on("disconnect", () => liveDot?.classList.add("off"));
  socket.on("sync", () => {
    // alguien más hizo un cambio: refrescamos la pantalla activa
    rerender();
  });
}
