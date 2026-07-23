// Ayudantes de fecha y dinero. Todas las fechas se manejan como texto 'YYYY-MM-DD'
// para evitar problemas de zona horaria entre el navegador y el servidor.

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(year, month1based) {
  // día 0 del mes siguiente = último día del mes actual
  return new Date(year, month1based, 0).getDate();
}

function addOneMonthClamped(dateStr) {
  const { y, m, d } = parseDate(dateStr);
  let newYear = y;
  let newMonth = m + 1;
  if (newMonth > 12) {
    newMonth = 1;
    newYear += 1;
  }
  const maxDay = daysInMonth(newYear, newMonth);
  const newDay = Math.min(d, maxDay);
  return `${newYear}-${pad(newMonth)}-${pad(newDay)}`;
}

function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function daysRemainingInMonth(dateStr) {
  const { y, m, d } = parseDate(dateStr);
  return daysInMonth(y, m) - d + 1; // incluye hoy
}

function monthsBetweenInclusive(fromStr, toStr) {
  const { y: y1, m: m1 } = parseDate(fromStr);
  const { y: y2, m: m2 } = parseDate(toStr);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  todayStr,
  parseDate,
  daysInMonth,
  addOneMonthClamped,
  daysBetween,
  daysRemainingInMonth,
  monthsBetweenInclusive,
  round2,
};
