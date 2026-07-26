# Ruta/Caja v2

Versión fusionada: mantiene el cuadre de caja real y los compromisos fijos
inteligentes de la primera versión, y le suma lo mejor de EconomiHelper —
turnos con cronómetro real, billeteras con efectivo y cuenta bancaria por
separado, y sincronización en vivo entre los dos teléfonos.

## Qué cambió respecto a la v1

- **Turnos en vez de "día calendario".** Cada turno tiene hora real de inicio
  y fin (con cronómetro en vivo), no un día fijo. Se puede iniciar y terminar
  a cualquier hora, incluso cruzando la medianoche (se auto-cierra solo).
- **Cada billetera (y El Fondo) maneja efectivo y cuenta bancaria por
  separado.** El efectivo es un solo concepto que se mueve entre bolsas; cada
  cuenta bancaria es propia de una billetera (o del Fondo).
- **Los viajes distinguen el costo pagado en el negocio** (cuando paga en
  efectivo en el local y el cliente le paga el total con tarjeta/transferencia)
  del envío y la propina, que es la ganancia real.
- **Sincronización en vivo con Socket.io**: si uno anota algo, el otro lo ve
  al instante sin recargar.
- **Movimientos editables/borrables con reversión automática de saldos**, y
  un turno completo se puede borrar (revierte todo lo que generó).

## Estructura

```
server.js            Express + Socket.io
db.js                 conexión a PostgreSQL + creación de tablas
io.js                  helper para emitir el evento "sync" a todos los clientes
utils.js                fechas/hora de Cancún (America/Cancun, UTC-5 fijo) y dinero
wallet-helpers.js         slots efectivo/cuenta y vista de compromisos
routes-core.js             billeteras, cuentas bancarias, transferencias, ajustes, compromisos
routes-turnos.js            turnos, viajes, gastos de calle, cierre de caja, reparto
routes-metrics.js            métricas por periodo y tips
public/                       frontend (HTML/CSS/JS, sin build step)
  js/
    api.js                     llamadas al backend
    main.js                     navegación (Home → Panel Operativo / Panel Central)
    view-home.js                  pantalla de inicio con los 2 roles
    view-tablero.js                turno activo, viajes y gastos (Operativo)
    view-historial.js               turnos pasados, cierre de caja y reparto (Operativo)
    view-resumen.js                  balances y alertas (Central)
    view-billeteras.js                saldos, transferencias y compromisos (Central)
    view-metricas.js                   resumen por periodo, gráfico y tips (Central)
```

## Cómo funciona el dinero (resumen)

1. **Iniciar turno**: anotan con cuánto sale (fondo de trabajo + gasolina +
   jornada). Arranca el cronómetro.
2. **Viajes**: costo pagado en el negocio (si aplica) + envío + propina, y
   cómo pagó el cliente el total. Si pagó en efectivo, todo queda en
   efectivo. Si pagó digital, el costo del negocio sale de efectivo (porque
   ahí sí pagó en físico) y lo demás entra a la cuenta.
3. **Gastos de calle**: gasolina, comida de jornada, etc., cada uno con su
   método de pago.
4. **Terminar turno**: para el cronómetro.
5. **Cerrar caja** (en Historial): cuentan el efectivo físico. El sistema
   calcula lo esperado y la diferencia.
6. **Repartir**: lo que sobra en efectivo (efectivo contado − fondo inicial)
   y todo lo generado en la cuenta digital se reparte entre las billeteras,
   cada una a su propio efectivo o cuenta.
7. **Billeteras**: cada una puede recibir ingresos/gastos sueltos, moverse
   entre efectivo y cuenta, transferirse entre sí, y tener compromisos fijos
   (renta, tarjeta, préstamos) con meta diaria que se recalcula sola.

Nada se descuenta automáticamente de un compromiso fijo: solo cuando lo
marcan manualmente como pagado.

## Correrlo en su computadora (opcional)

```bash
cp .env.example .env
# editen .env con los datos de su base de datos
npm install
npm start
```

Abran http://localhost:3000

## Desplegar en Railway

1. Suban esta carpeta a un repositorio de GitHub.
2. Railway → **New Project → Deploy from GitHub repo**.
3. Agreguen **New → Database → PostgreSQL** en el mismo proyecto (Railway
   comparte `DATABASE_URL` automáticamente).
4. Railway detecta Node.js y corre `npm install` + `npm start` solo.
5. Les da una URL pública — esa la usan los dos, cada quien desde su
   teléfono. La sincronización en vivo funciona entre ambos automáticamente.

### Notas importantes

- **No pude probar esta versión en un servidor real** (este entorno no tiene
  acceso a internet ni a una base de datos Postgres), así que revisé cada
  archivo a mano con mucho cuidado, pero les recomiendo probar el flujo
  completo apenas la desplieguen: iniciar turno → anotar viajes y gastos →
  terminar turno → cerrar caja → repartir. Si algo no cuadra, avísenme y lo
  ajustamos.
- La hora se calcula siempre con la zona horaria de Cancún (UTC-5 fijo, sin
  horario de verano).
- Si la conexión a Postgres falla por SSL, agreguen `PGSSLMODE=require` en
  las variables de entorno de Railway.
