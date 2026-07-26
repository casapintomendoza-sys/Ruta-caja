export function pad(n) {
  return String(n).padStart(2, "0");
}

export function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtDateShort(dateStr) {
  if (!dateStr) return "";
  const clean = String(dateStr).slice(0, 10);
  const [y, m, d] = clean.split("-").map(Number);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${meses[m - 1]}`;
}

export function fmtDateLabel(dateStr) {
  const clean = String(dateStr).slice(0, 10);
  const [y, m, d] = clean.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${dias[dt.getDay()]} ${d} ${meses[dt.getMonth()]}`;
}

// hora local (del navegador) a partir de un timestamp ISO — solo para mostrar,
// el server ya guarda fecha/hora de Cancún en sus propios campos.
export function fmtHoraLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDuracion(horasDecimal) {
  const totalMin = Math.round(Number(horasDecimal) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m} min`;
  return `${h}h ${pad(m)}min`;
}

export function fmtCronometro(startIso) {
  const diffMs = Date.now() - new Date(startIso).getTime();
  const totalSec = Math.max(Math.floor(diffMs / 1000), 0);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export const PAYMENT_LABELS = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

export const EXPENSE_CATEGORIES = [
  { value: "gasolina", label: "Gasolina" },
  { value: "comida_jornada", label: "Comida / jornada" },
  { value: "mantenimiento", label: "Mantenimiento del vehículo" },
  { value: "imprevistos", label: "Imprevistos" },
  { value: "otro", label: "Otro" },
];

export const WALLET_PALETTE = ["#2F6E63", "#D9A441", "#B14A42", "#5B6EA6", "#8A6D3B", "#4A5560"];

export function slotLabel(slot) {
  return slot === "cash" ? "Efectivo" : "Cuenta";
}
