# Ruta/Caja

App para llevar el control diario de un repartidor independiente: viajes cobrados,
gastos de la jornada, cierre de caja (efectivo físico vs. lo que dice el sistema),
reparto del dinero entre billeteras del hogar, gastos fijos con fecha de vencimiento
y métricas/tips.

Es una app web normal (Node.js + PostgreSQL) pensada para desplegarse en Railway y
que la usen dos personas desde sus propios teléfonos o computadoras, cada quien
entrando a la misma URL.

## Estructura

```
server.js          punto de entrada (Express)
db.js               conexión a PostgreSQL + creación de tablas
routes.js           toda la API (/api/...)
utils.js             ayudantes de fecha y dinero
public/              frontend (HTML/CSS/JS, sin build step)
  index.html
  styles.css
  js/
    api.js           llamadas fetch al backend
    utils.js          formato de fecha/dinero para el frontend
    main.js            arma las pestañas y el estado
    view-jornada.js    pestaña Viajes (fondo del día, viajes, gastos)
    view-cierre.js      pestaña Cierre (cuadre de caja + reparto)
    view-billeteras.js   pestaña Billeteras (saldos, compromisos fijos)
    view-metricas.js      pestaña Métricas (resumen, gráfico, tips)
```

## Cómo funciona (resumen del modelo)

1. **Fondo del día**: antes de salir anotan cuánto le dan (fondo de trabajo +
   gasolina + gastos de jornada). Puede variar cada día.
2. **Viajes**: cada cobro con su propina y método de pago (efectivo, transferencia
   o tarjeta).
3. **Gastos**: gasolina, comida de jornada, mantenimiento, imprevistos u otro,
   cada uno con su método de pago.
4. **Cierre**: comparan el efectivo físico contra lo que el sistema espera
   (fondo + cobros en efectivo − gastos en efectivo). La diferencia queda a la vista.
5. **Reparto**: el dinero a repartir = (efectivo contado − fondo del día) + todo lo
   cobrado digital − gastos digitales. Ese monto se reparte entre las billeteras
   que ustedes decidan.
6. **Billeteras**: cada una tiene su saldo, movimientos manuales (ingreso/gasto) y
   puede tener **compromisos fijos** (renta, tarjeta, préstamos...) con fecha de
   vencimiento, si se repiten cada mes y una fecha de finalización opcional. La app
   calcula cuánto deberían meter hoy a esa billetera para llegar a tiempo, y se
   recalcula solo según lo que ya tengan ahorrado.
7. **Métricas**: ingresos por día, promedio, mejor/peor día, gasto por categoría
   contra lo presupuestado, reparto por billetera y tips automáticos.

Nada se descuenta de una billetera de forma automática: los compromisos fijos solo
se restan cuando marcan manualmente "Pagado".

## Correrlo en su computadora (opcional, para probar antes de subirlo)

Necesitan Node.js 18+ y un PostgreSQL (puede ser local o uno gratis en la nube).

```bash
cp .env.example .env
# editen .env con los datos de su base de datos
npm install
npm start
```

Abran http://localhost:3000

## Desplegar en Railway

1. Suban esta carpeta a un repositorio de GitHub (puede ser privado).
2. En Railway: **New Project → Deploy from GitHub repo** y seleccionen el repo.
3. En el mismo proyecto, agreguen **New → Database → PostgreSQL**. Railway crea
   automáticamente la variable `DATABASE_URL` y la comparte con su servicio si
   están en el mismo proyecto (revisen en la pestaña *Variables* del servicio web
   que `DATABASE_URL` aparezca; si no, pueden referenciarla como
   `${{Postgres.DATABASE_URL}}`).
4. Railway detecta que es un proyecto Node.js (por `package.json`) y usa
   `npm install` + `npm start` automáticamente. No hace falta configurar nada más.
5. Cuando termine el deploy, Railway les da una URL pública (algo como
   `ruta-caja-production.up.railway.app`). Esa es la que van a usar los dos, cada
   quien desde su teléfono.
6. La primera vez que arranca, la app crea sola las tablas y tres billeteras por
   default (Gastos fijos, Comida, Para ti) — pueden editarlas o borrarlas desde
   la pestaña Billeteras.

### Notas

- Los datos son compartidos entre quien sea que entre a la URL: no hay usuarios
  ni contraseñas por ahora. Si más adelante quieren protegerla, se puede agregar
  un login sencillo.
- Si en algún momento la conexión a Postgres falla por SSL, agreguen la variable
  de entorno `PGSSLMODE=require` en Railway.
- Pueden instalar la página como "app" desde el navegador del celular (Agregar a
  pantalla de inicio) para que se sienta como una app nativa.
