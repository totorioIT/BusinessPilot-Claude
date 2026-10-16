import { buildApp } from './app.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { bootstrapOwner } from './db/seed.js';
import { env } from './env.js';
import { startJobRunner } from './services/automations.js';

await runMigrations(env.DATABASE_URL);
const { db, pool } = createDb(env.DATABASE_URL);
if (env.OWNER_EMAIL && env.OWNER_PASSWORD) {
  const created = await bootstrapOwner(db, { email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD, name: env.OWNER_NAME });
  if (created) console.log(`Erststart: Demo-Betrieb mit Login ${env.OWNER_EMAIL} angelegt.`);
}
const app = await buildApp({
  db,
  publicUrl: env.PUBLIC_URL,
  cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  dashboardDist: env.DASHBOARD_DIST,
  logger: true,
});
const stopJobs = env.RUN_JOBS === 'true' ? startJobRunner(db, (msg, err) => app.log.error({ err }, msg)) : () => {};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    stopJobs();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
