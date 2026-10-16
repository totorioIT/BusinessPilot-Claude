import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { bootstrapOwner, DEMO_EMAIL, DEMO_FONIO_KEY, DEMO_PASSWORD } from '../src/db/seed.js';
import { TEST_DB } from './helpers.js';

const { db, pool } = createDb(TEST_DB);
const owner = { email: 'inhaber@example.de', password: 'ein-langes-passwort', name: 'Inhaber' };

before(async () => {
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await runMigrations(TEST_DB);
});
after(() => pool.end());

test('first start creates the owner login without public demo credentials', async () => {
  assert.equal(await bootstrapOwner(db, owner), true);
  assert.equal(await bootstrapOwner(db, { ...owner, password: 'ein-anderes-passwort' }), false, 'second start leaves data alone');

  const app = await buildApp({ db, publicUrl: 'http://localhost:3001', cookieSecure: false });
  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  assert.equal((await login(owner.email, owner.password)).statusCode, 200);
  assert.equal((await login(DEMO_EMAIL, DEMO_PASSWORD)).statusCode, 401);
  const voice = await app.inject({ method: 'POST', url: '/api/voice/fonio/inbound', payload: { fromNumber: '+491701234567', toNumber: '+49891234567' }, headers: { authorization: `Bearer ${DEMO_FONIO_KEY}` } });
  assert.equal(voice.statusCode, 401);
  await app.close();
});
