const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn(
    "Aviso: no se encontro la variable DATABASE_URL. Agrega un plugin de PostgreSQL en Railway o define DATABASE_URL en tu .env local."
  );
}

const wantsSSL =
  process.env.PGSSLMODE === "require" ||
  (connectionString && connectionString.includes("sslmode=require"));

const pool = new Pool({
  connectionString,
  ssl: wantsSSL ? { rejectUnauthorized: false } : false,
});

const SCHEMA = `
-- cuentas bancarias / tarjetas (el efectivo NO es una cuenta, es un slot aparte)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "bolsas": el Fondo (una sola, is_fondo=true) y las billeteras del hogar
CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2F6E63',
  is_fondo BOOLEAN NOT NULL DEFAULT false,
  bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
  cash NUMERIC NOT NULL DEFAULT 0,
  bank NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- compromisos fijos programados dentro de una billetera
CREATE TABLE IF NOT EXISTS commitments (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  recurring BOOLEAN NOT NULL DEFAULT true,
  end_date DATE,
  next_due_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- turnos de trabajo (reemplaza al "día calendario"): inicio/fin reales + fondo con el que salió
CREATE TABLE IF NOT EXISTS turnos (
  id SERIAL PRIMARY KEY,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  fecha DATE NOT NULL,
  fondo_trabajo NUMERIC NOT NULL DEFAULT 0,
  fondo_gasolina NUMERIC NOT NULL DEFAULT 0,
  fondo_jornada NUMERIC NOT NULL DEFAULT 0,
  meta_diaria NUMERIC,
  efectivo_contado NUMERIC,
  repartido BOOLEAN NOT NULL DEFAULT false,
  auto_cerrado BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- viajes: el costo_negocio es lo que paga en el local (normalmente efectivo);
-- envio+propina es la ganancia real; metodo_cobro es cómo le paga el cliente el total
CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  turno_id INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  negocio TEXT,
  costo_negocio NUMERIC NOT NULL DEFAULT 0,
  envio NUMERIC NOT NULL DEFAULT 0,
  propina NUMERIC NOT NULL DEFAULT 0,
  metodo_cobro TEXT NOT NULL DEFAULT 'efectivo',
  fecha DATE NOT NULL,
  hora TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- gastos operativos de calle durante un turno (gasolina, comida de jornada, etc.)
CREATE TABLE IF NOT EXISTS gastos_calle (
  id SERIAL PRIMARY KEY,
  turno_id INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  categoria TEXT NOT NULL,
  monto NUMERIC NOT NULL,
  metodo_pago TEXT NOT NULL DEFAULT 'efectivo',
  nota TEXT,
  fecha DATE NOT NULL,
  hora TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- transferencias genéricas entre bolsas y/o slots: reparto de un turno, asignación
-- manual, billetera→billetera, o mover efectivo↔cuenta dentro de la misma bolsa
CREATE TABLE IF NOT EXISTS transferencias (
  id SERIAL PRIMARY KEY,
  tipo TEXT NOT NULL DEFAULT 'manual', -- manual | reparto | slot
  turno_id INTEGER REFERENCES turnos(id) ON DELETE SET NULL,
  wallet_origen_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  slot_origen TEXT NOT NULL, -- cash | bank
  wallet_destino_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  slot_destino TEXT NOT NULL,
  monto NUMERIC NOT NULL,
  nota TEXT,
  fecha DATE NOT NULL,
  hora TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ingresos/gastos sueltos en una billetera, sin contraparte (ej. pagar despensa,
-- o el pago de un compromiso fijo, marcado con commitment_id)
CREATE TABLE IF NOT EXISTS ajustes (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  slot TEXT NOT NULL, -- cash | bank
  tipo TEXT NOT NULL, -- ingreso | gasto
  monto NUMERIC NOT NULL,
  nota TEXT,
  commitment_id INTEGER REFERENCES commitments(id) ON DELETE SET NULL,
  fecha DATE NOT NULL,
  hora TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_turno ON trips(turno_id);
CREATE INDEX IF NOT EXISTS idx_trips_fecha ON trips(fecha);
CREATE INDEX IF NOT EXISTS idx_gastos_turno ON gastos_calle(turno_id);
CREATE INDEX IF NOT EXISTS idx_gastos_fecha ON gastos_calle(fecha);
CREATE INDEX IF NOT EXISTS idx_transfer_wallets ON transferencias(wallet_origen_id, wallet_destino_id);
CREATE INDEX IF NOT EXISTS idx_transfer_turno ON transferencias(turno_id);
CREATE INDEX IF NOT EXISTS idx_ajustes_wallet ON ajustes(wallet_id);
CREATE INDEX IF NOT EXISTS idx_commitments_wallet ON commitments(wallet_id);
`;

async function seedDefaults() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM wallets");
  if (rows[0].count === 0) {
    await pool.query(
      `INSERT INTO wallets (name, color, is_fondo) VALUES ('El Fondo', '#141C24', true)`
    );
    await pool.query(
      `INSERT INTO wallets (name, color) VALUES
       ('Gastos fijos', '#2F6E63', false),
       ('Comida', '#D9A441', false),
       ('Para ti', '#B14A42', false)`
    );
  }
}

async function initSchema() {
  await pool.query(SCHEMA);
  await seedDefaults();
}

module.exports = { pool, initSchema };
