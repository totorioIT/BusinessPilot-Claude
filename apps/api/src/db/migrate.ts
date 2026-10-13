import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { createDb } from './client.js';

export async function runMigrations(databaseUrl: string) {
  const { db, pool } = createDb(databaseUrl);
  const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
  await migrate(db, { migrationsFolder: folder });
  await pool.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations(env.DATABASE_URL);
  console.log('Migrationen ausgeführt.');
}
