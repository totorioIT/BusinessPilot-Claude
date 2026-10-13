import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { DEMO_EMAIL, DEMO_FONIO_KEY, DEMO_PASSWORD, seed } from '../src/db/seed.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://bp@localhost:5432/businesspilot_test';

export async function setup() {
  const { db, pool } = createDb(TEST_DB);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await runMigrations(TEST_DB);
  const { tenantId } = await seed(db);
  const app = await buildApp({ db, publicUrl: 'http://localhost:3001', cookieSecure: false });
  await app.ready();

  const login = async (email = DEMO_EMAIL, password = DEMO_PASSWORD) => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
    const cookie = res.cookies.find((c) => c.name === 'bp_session');
    return { res, cookie: cookie ? `bp_session=${cookie.value}` : '' };
  };
  const { cookie } = await login();
  const api = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown, c = cookie) => {
    const res = await app.inject({ method, url: `/api${url}`, payload: payload as object, headers: { cookie: c } });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };
  const voice = async (url: string, payload: unknown, key = DEMO_FONIO_KEY) => {
    const res = await app.inject({ method: 'POST', url: `/api/voice${url}`, payload: payload as object, headers: { authorization: `Bearer ${key}` } });
    return { status: res.statusCode, body: res.json() };
  };
  const close = async () => {
    await app.close();
    await pool.end();
  };
  return { app, db, tenantId, api, voice, login, close };
}

/** Next weekday (Mon–Fri) at least `minDays` ahead, as YYYY-MM-DD in Berlin time. */
export function nextWeekday(minDays = 3) {
  const d = new Date(Date.now() + minDays * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
