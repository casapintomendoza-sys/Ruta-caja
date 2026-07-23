require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const { initSchema } = require("./db");
const apiRouter = require("./routes");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api", apiRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// cualquier ruta que no sea /api sirve el frontend (SPA)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Ruta/Caja escuchando en el puerto ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("No se pudo inicializar la base de datos:", err);
    process.exit(1);
  });
