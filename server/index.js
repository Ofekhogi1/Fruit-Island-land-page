'use strict';

const config = require('./config');
const users = require('./lib/users');
const { createApp } = require('./app');

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  const base = `http://localhost:${config.port}`;
  console.log(`Fruit Island — האתר רץ על ${base}`);
  if (!users.hasUsers()) {
    console.log(`אין עדיין משתמש ניהול. פתחו ${base}/admin/setup או הריצו: npm run admin:create`);
  } else {
    console.log(`פאנל הניהול: ${base}/admin`);
  }
  if (!config.isProduction) console.log('מצב פיתוח — עוגיות אינן מסומנות Secure');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
