// Todo el negocio corre con la hora real de Cancún (America/Cancun, UTC-5 fijo,
// sin horario de verano). Las columnas TIMESTAMPTZ guardan el instante real en UTC;
// estas funciones solo se usan para mostrar/agrupar por fecha y hora locales.

const TZ = "America/Cancun";

function pad(n) {
  return String(n).padStart(2, "0");
}

// Devuelve un objeto Date cuyos getters (getHours, getDate, etc.) reflejan
// la hora local de Cancún, útil para construir cadenas 'YYYY-MM-DD' y 'HH:MM'.
function cancunNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}

function cancunPartsFromInstant(dateOrIso) {
  const instant = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  return new Date(instant.toLocaleString("en-US", { timeZone: TZ }));
}

function fechaStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function horaStr(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowInfo() {
  const d = cancunNow();
  return { fecha: fechaStr(d), hora: horaStr(d), instant: new Date() };
}

// A partir de un instante (Date/ISO) real, da la fecha/hora locales de Cancún.
function infoFromInstant(instant) {
  const d = cancunPartsFromInstant(instant);
  return { fecha: fechaStr(d), hora: horaStr(d) };
}

// Milisegundos hasta la próxima medianoche de Cancún, para el auto-cierre de turno.
function msHastaMedianoche() {
  const now = cancunNow();
  const mn = new Date(now);
  mn.setHours(24, 0, 0, 0);
  return mn - now;
}

function todayStr() {
  return fechaStr(cancunNow());
}

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}

function daysInMonth(year, month1based) {
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
  return `${newYear}-${pad(newMonth)}-${pad(Math.min(d, maxDay))}`;
}

function addDaysStr(dateStr, delta) {
  const { y, m, d } = parseDate(dateStr);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + "T00:00:00");
  const b = new Date(toStr + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function monthsBetweenInclusive(fromStr, toStr) {
  const { y: y1, m: m1 } = parseDate(fromStr);
  const { y: y2, m: m2 } = parseDate(toStr);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function toDateStr(d) {
  if (d == null) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

module.exports = {
  TZ,
  cancunNow,
  nowInfo,
  infoFromInstant,
  msHastaMedianoche,
  todayStr,
  fechaStr,
  horaStr,
  parseDate,
  daysInMonth,
  addOneMonthClamped,
  daysBetween,
  addDaysStr,
  monthsBetweenInclusive,
  round2,
  toDateStr,
};
