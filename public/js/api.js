const BASE = "/api";

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const data = await res.json();
      if (data.error) msg = data.error;
    } catch (e) {
      /* ignore parse errors */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body) });
const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) });
const del = (path) => request(path, { method: "DELETE" });

export const api = {
  // wallets
  getWallets: () => request("/wallets"),
  createWallet: (data) => post("/wallets", data),
  updateWallet: (id, data) => patch(`/wallets/${id}`, data),
  deleteWallet: (id) => del(`/wallets/${id}`),
  registerWalletMovement: (id, data) => post(`/wallets/${id}/movement`, data),
  getWalletMovements: (id, limit = 30) => request(`/wallets/${id}/movements?limit=${limit}`),

  // commitments
  getCommitments: (walletId) => request(`/wallets/${walletId}/commitments`),
  createCommitment: (walletId, data) => post(`/wallets/${walletId}/commitments`, data),
  updateCommitment: (id, data) => patch(`/commitments/${id}`, data),
  deleteCommitment: (id) => del(`/commitments/${id}`),
  payCommitment: (id, amount) => post(`/commitments/${id}/pay`, amount != null ? { amount } : {}),

  // global movements
  getMovements: (limit = 30) => request(`/movements?limit=${limit}`),

  // trips
  getTrips: (date) => request(`/trips?date=${date}`),
  createTrip: (data) => post("/trips", data),
  deleteTrip: (id) => del(`/trips/${id}`),

  // expenses
  getExpenses: (date) => request(`/expenses?date=${date}`),
  createExpense: (data) => post("/expenses", data),
  deleteExpense: (id) => del(`/expenses/${id}`),

  // jornada / cierre
  getJornada: (date) => request(`/jornada/${date}`),
  setFondo: (date, data) => post(`/jornada/${date}/fondo`, data),
  cerrarJornada: (date, efectivo_contado) => post(`/jornada/${date}/cerrar`, { efectivo_contado }),
  reabrirJornada: (date) => post(`/jornada/${date}/reabrir`, {}),
  repartir: (date, allocations) => post(`/jornada/${date}/repartir`, { allocations }),
  deshacerReparto: (date) => post(`/jornada/${date}/deshacer-reparto`, {}),
  getAllocations: (date) => request(`/jornada/${date}/allocations`),

  // metrics
  getMetricsResumen: (from, to) => request(`/metrics/resumen?from=${from}&to=${to}`),
  getMetricsTips: () => request("/metrics/tips"),
};
