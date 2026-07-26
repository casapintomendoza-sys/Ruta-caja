let ioInstance = null;

function setIo(io) {
  ioInstance = io;
}

// Avisa a todos los que tengan la app abierta que algo cambió, para que
// refresquen la pantalla activa. No manda el estado completo: cada cliente
// vuelve a pedir lo que necesita, así siempre es la verdad de la base de datos.
function broadcastSync(scope) {
  if (ioInstance) ioInstance.emit("sync", { scope, at: Date.now() });
}

module.exports = { setIo, broadcastSync };
