import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/db/schema.js';
import { providersFor } from '../src/providers/registry.js';
import { setup } from './helpers.js';

// A stand-in for Google: OAuth token endpoint, calendar list, free/busy and events.
const CLIENT_ID = '1234-test.apps.googleusercontent.com';
const calls: { url: string; method: string; body: string }[] = [];
let eventsFail = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (!/^https:\/\/(oauth2|www)\.googleapis\.com/.test(url)) return realFetch(input, init);
  const method = init?.method ?? 'GET';
  const body = String(init?.body ?? '');
  calls.push({ url, method, body });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/token')) {
    const p = new URLSearchParams(body);
    if (p.get('client_secret') !== 'geheim-secret-123') return json(401, { error: 'invalid_client' });
    if (p.get('grant_type') === 'authorization_code') {
      return p.get('code') === 'good' ? json(200, { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1' }) : json(400, { error: 'invalid_grant' });
    }
    return json(200, { access_token: 'at-2', expires_in: 3600 });
  }
  if (url.includes('/revoke')) return new Response('', { status: 200 });
  if (url.includes('/calendarList')) {
    return json(200, { items: [{ id: 'werkstatt@example.de', summary: 'Werkstatt', primary: true }, { id: 'cal-max', summary: 'Max' }] });
  }
  if (url.endsWith('/freeBusy')) {
    const req = JSON.parse(body);
    return json(200, { calendars: Object.fromEntries(req.items.map((i: { id: string }) => [i.id, { busy: [{ start: req.timeMin, end: req.timeMax }] }])) });
  }
  if (url.includes('/events')) {
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return eventsFail ? json(500, { error: 'backend' }) : json(200, { id: `ev${calls.length}` });
  }
  return json(404, {});
}) as typeof fetch;

let t: Awaited<ReturnType<typeof setup>>;
before(async () => {
  process.env.APP_SECRET = 'test-secret-with-at-least-32-characters!';
  t = await setup();
});
after(async () => {
  globalThis.fetch = realFetch;
  await t.close();
});

const callback = (query: string, cookie = t.cookie) => t.app.inject({ method: 'GET', url: `/api/integrations/google/callback?${query}`, headers: { cookie } });
const errorOf = (res: { headers: Record<string, unknown> }) => new URL(String(res.headers.location), 'http://x').searchParams.get('google_error');

test('without the platform OAuth client, connecting explains what is missing', async () => {
  const res = await t.api('POST', '/integrations/google_calendar/start');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'google_not_configured');
});

test('the platform admin saves the OAuth client; the secret is never returned', async () => {
  const bad = await t.api('PUT', '/admin/google', { clientId: 'falsch', clientSecret: 'geheim-secret-123' });
  assert.equal(bad.status, 400);
  const res = await t.api('PUT', '/admin/google', { clientId: CLIENT_ID, clientSecret: 'geheim-secret-123' });
  assert.equal(res.status, 200);
  assert.equal(res.body.configured, true);
  assert.equal(res.body.secretHint, '…-123');
  assert.equal(res.body.redirectUri, 'http://localhost:3001/api/integrations/google/callback');
  assert.ok(!JSON.stringify(res.body).includes('geheim-secret'));
});

let state = '';
test('a business connects its Google account through the consent screen', async () => {
  const start = await t.api('POST', '/integrations/google_calendar/start');
  const url = new URL(start.body.url);
  assert.equal(url.hostname, 'accounts.google.com');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  state = url.searchParams.get('state')!;

  assert.match(errorOf(await callback(`code=good&state=${state}x`))!, /abgelaufen/, 'a tampered state is refused');
  assert.match(errorOf(await callback(`error=access_denied&state=${state}`))!, /abgelehnt/);
  assert.match(errorOf(await callback(`code=bad&state=${state}`))!, /widerrufen oder er ist abgelaufen/);
  assert.match(errorOf(await callback(`code=good&state=${state}`, ''))!, /anmelden/, 'someone not signed in cannot finish the connection');

  const ok = await callback(`code=good&state=${state}`);
  assert.equal(ok.statusCode, 302);
  assert.equal(ok.headers.location, '/integrations?google=connected&provider=google_calendar');
  const list = await t.api('GET', '/integrations');
  const item = list.body.find((i: any) => i.provider === 'google_calendar');
  assert.equal(item.mode, 'live');
  assert.equal(item.detail, 'Verbunden mit werkstatt@example.de');
  const [row] = await t.db.select().from(s.integrations).where(and(eq(s.integrations.tenantId, t.tenantId), eq(s.integrations.provider, 'google_calendar')));
  assert.ok(!JSON.stringify(row.config).includes('rt-1'), 'the refresh token is stored encrypted');
});

test('staff are linked to calendars; busy times block them and bookings land in their calendar', async () => {
  const cal = await t.api('GET', '/integrations/google_calendar/calendars');
  assert.deepEqual(cal.body.calendars.map((c: any) => c.id), ['werkstatt@example.de', 'cal-max']);
  const [linked, other] = cal.body.staff;
  const wrong = await t.api('PUT', '/integrations/google_calendar/calendars', { staffCalendars: { [linked.id]: 'fremd' } });
  assert.equal(wrong.status, 400);
  const saved = await t.api('PUT', '/integrations/google_calendar/calendars', { staffCalendars: { [linked.id]: 'cal-max', [other.id]: null } });
  assert.deepEqual(saved.body.staffCalendars, { [linked.id]: 'cal-max' });

  const { calendar } = await providersFor(t.db, t.tenantId);
  const from = new Date('2026-11-02T07:00:00Z');
  const to = new Date('2026-11-02T16:00:00Z');
  const busy = await calendar.freeBusy({ calendarIds: [linked.id, other.id], from, to });
  assert.equal(busy[linked.id].length, 1);
  assert.equal(busy[other.id].length, 0, 'unlinked staff are not checked at Google');

  calls.length = 0;
  const a = await calendar.createEvent({ calendarId: linked.id, title: 'Inspektion – Max Müller', start: from, end: to });
  assert.match(a.eventId!, /^cal-max::ev/);
  const b = await calendar.createEvent({ calendarId: other.id, title: 'Reifenwechsel', start: from, end: to });
  assert.match(b.eventId!, /^primary::ev/);
  await calendar.cancelEvent({ calendarId: linked.id, eventId: a.eventId! });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('/calendars/cal-max/events/')));
});

test('a Google outage never blocks a booking and shows up on the integration card', async () => {
  eventsFail = true;
  const { calendar } = await providersFor(t.db, t.tenantId);
  const res = await calendar.createEvent({ calendarId: 'x', title: 'Test', start: new Date(), end: new Date() });
  assert.equal(res.eventId, null);
  await new Promise((r) => setTimeout(r, 50));
  const item = (await t.api('GET', '/integrations')).body.find((i: any) => i.provider === 'google_calendar');
  assert.match(item.lastError, /Google Kalender antwortet mit 500/);
  eventsFail = false;
});

test('disconnecting gives the access back at Google', async () => {
  calls.length = 0;
  await t.api('POST', '/integrations/google_calendar/disconnect');
  assert.ok(calls.some((c) => c.url.includes('/revoke')));
  const item = (await t.api('GET', '/integrations')).body.find((i: any) => i.provider === 'google_calendar');
  assert.equal(item.mode, 'sandbox');
  const after = await t.api('GET', '/integrations/google_calendar/calendars');
  assert.equal(after.status, 400);
});
