require("dotenv").config();
const path = require("path");
const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const { initSchema } = require("./db");
const { setIo } = require("./io");
const routesCore = require("./routes-core");
const { router: routesTurnos, checkAndAutoCloseActive, scheduleAutoCierre } = require("./routes-turnos");
const routesMetrics = require("./routes-metrics");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", routesCore);
app.use("/api", routesTurnos);
app.use("/api", routesMetrics);

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});
setIo(io);

io.on("connection", (socket) => {
  socket.emit("hello", { ok: true });
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => checkAndAutoCloseActive())
  .then(() => {
    scheduleAutoCierre();
    server.listen(PORT, () => {
      console.log(`Ruta/Caja escuchando en el puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("No se pudo inicializar la base de datos:", err);
    process.exit(1);
  });
