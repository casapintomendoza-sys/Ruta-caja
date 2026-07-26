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
      /* ignore */
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body || {}) });
const patch = (path, body) => request(path, { method: "PATCH", body: JSON.stringify(body) });
const del = (path) => request(path, { method: "DELETE" });

export const api = {
  // bank accounts
  getBankAccounts: () => request("/bank-accounts"),
  createBankAccount: (name) => post("/bank-accounts", { name }),
  deleteBankAccount: (id) => del(`/bank-accounts/${id}`),

  // wallets
  getWallets: () => request("/wallets"),
  createWallet: (data) => post("/wallets", data),
  updateWallet: (id, data) => patch(`/wallets/${id}`, data),
  deleteWallet: (id) => del(`/wallets/${id}`),

  // transferencias
  getTransferencias: (walletId, limit = 30) =>
    request(`/transferencias?limit=${limit}${walletId ? `&wallet_id=${walletId}` : ""}`),
  createTransferencia: (data) => post("/transferencias", data),
  deleteTransferencia: (id) => del(`/transferencias/${id}`),

  // ajustes
  getAjustes: (walletId, limit = 30) =>
    request(`/ajustes?limit=${limit}${walletId ? `&wallet_id=${walletId}` : ""}`),
  createAjuste: (data) => post("/ajustes", data),
  deleteAjuste: (id) => del(`/ajustes/${id}`),

  // movimientos combinados
  getMovimientosRecientes: (limit = 25) => request(`/movimientos-recientes?limit=${limit}`),

  // commitments
  getAllCommitments: () => request("/commitments"),
  getCommitments: (walletId) => request(`/wallets/${walletId}/commitments`),
  createCommitment: (walletId, data) => post(`/wallets/${walletId}/commitments`, data),
  updateCommitment: (id, data) => patch(`/commitments/${id}`, data),
  deleteCommitment: (id) => del(`/commitments/${id}`),
  payCommitment: (id, slot, amount) => post(`/commitments/${id}/pay`, { slot, amount }),

  // turnos
  getTurnoActivo: () => request("/turnos/activo"),
  getTurnos: (limit = 20) => request(`/turnos?limit=${limit}`),
  getTurno: (id) => request(`/turnos/${id}`),
  iniciarTurno: (data) => post("/turnos/iniciar", data),
  terminarTurno: (id, end_at) => post(`/turnos/${id}/terminar`, end_at ? { end_at } : {}),
  updateTurno: (id, data) => patch(`/turnos/${id}`, data),
  cerrarCaja: (id, efectivo_contado) => post(`/turnos/${id}/cerrar-caja`, { efectivo_contado }),
  reabrirCaja: (id) => post(`/turnos/${id}/reabrir-caja`, {}),
  repartir: (id, allocations) => post(`/turnos/${id}/repartir`, { allocations }),
  deshacerReparto: (id) => post(`/turnos/${id}/deshacer-reparto`, {}),
  getTurnoAllocations: (id) => request(`/turnos/${id}/allocations`),
  deleteTurno: (id) => del(`/turnos/${id}`),

  // trips
  getTrips: (turnoId) => request(`/trips?turno_id=${turnoId}`),
  createTrip: (data) => post("/trips", data),
  updateTrip: (id, data) => patch(`/trips/${id}`, data),
  deleteTrip: (id) => del(`/trips/${id}`),

  // gastos de calle
  getGastosCalle: (turnoId) => request(`/gastos-calle?turno_id=${turnoId}`),
  createGastoCalle: (data) => post("/gastos-calle", data),
  deleteGastoCalle: (id) => del(`/gastos-calle/${id}`),

  // metrics
  getMetricsResumen: (from, to) => request(`/metrics/resumen?from=${from}&to=${to}`),
  getMetricsTips: () => request("/metrics/tips"),
};
