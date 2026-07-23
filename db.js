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
CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#2F6E63',
  balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS wallet_movements (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type TEXT NOT NULL, -- reparto | ingreso | gasto | pago_compromiso
  amount NUMERIC NOT NULL, -- positivo = entra, negativo = sale
  note TEXT,
  commitment_id INTEGER REFERENCES commitments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jornadas (
  date DATE PRIMARY KEY,
  fondo_trabajo NUMERIC NOT NULL DEFAULT 0,
  fondo_gasolina NUMERIC NOT NULL DEFAULT 0,
  fondo_jornada NUMERIC NOT NULL DEFAULT 0,
  efectivo_contado NUMERIC,
  cerrado BOOLEAN NOT NULL DEFAULT false,
  repartido BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trips (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  time TEXT NOT NULL,
  fare NUMERIC NOT NULL,
  tip NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL DEFAULT 'efectivo', -- efectivo | transferencia | tarjeta
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_expenses (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  category TEXT NOT NULL, -- gasolina | comida_jornada | mantenimiento | imprevistos | otro
  amount NUMERIC NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'efectivo',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON daily_expenses(date);
CREATE INDEX IF NOT EXISTS idx_movements_wallet ON wallet_movements(wallet_id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON wallet_movements(date);
CREATE INDEX IF NOT EXISTS idx_commitments_wallet ON commitments(wallet_id);
`;

async function seedDefaultWallets() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM wallets");
  if (rows[0].count === 0) {
    await pool.query(
      `INSERT INTO wallets (name, color) VALUES
       ('Gastos fijos', '#2F6E63'),
       ('Comida', '#D9A441'),
       ('Para ti', '#B14A42')`
    );
  }
}

async function initSchema() {
  await pool.query(SCHEMA);
  await seedDefaultWallets();
}

module.exports = { pool, initSchema };
