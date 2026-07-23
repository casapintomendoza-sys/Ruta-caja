export function pad(n) {
  return String(n).padStart(2, "0");
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeNow() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function addMonthsToToday(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDateLabel(dateStr) {
  if (dateStr === todayStr()) return "Hoy";
  if (dateStr === addDays(todayStr(), -1)) return "Ayer";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dias = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${dias[dt.getDay()]} ${d} ${meses[dt.getMonth()]}`;
}

export function fmtDateShort(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${d} ${meses[m - 1]}`;
}

export function fmtMoney(n) {
  const v = Number(n) || 0;
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
