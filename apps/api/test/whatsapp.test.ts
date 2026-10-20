import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/db/schema.js';
import { parseDialog360Webhook } from '../src/providers/dialog360.js';
import { whatsappIdle } from '../src/routes/webhooks.js';
import { setup } from './helpers.js';

// A stand-in for 360dialog: records every request and answers like the test account does.
const API_KEY = 'd360-test-key-abcdefghijklmnop';
const sent: { url: string; headers: Record<string, string>; body: any }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith('https://waba-sandbox.360dialog.io')) return realFetch(input, init);
  const headers = init?.headers as Record<string, string>;
  sent.push({ url, headers, body: JSON.parse(String(init?.body ?? '{}')) });
  if (headers['D360-API-KEY'] !== API_KEY) return new Response('{"error":"unauthorized"}', { status: 401 });
  if (url.endsWith('/v1/configs/webhook')) return new Response('{"url":"ok"}', { status: 200 });
  return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 201 });
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

const incoming = (id: string, text: string, from = '491712617554') => ({
  entry: [{ changes: [{ field: 'messages', value: { contacts: [{ profile: { name: 'Philipp' }, wa_id: from }], messages: [{ from, id, timestamp: '1', type: 'text', text: { body: text } }] } }] }],
});

let webhookPath = '';

test('a wrong 360dialog key is rejected and nothing is stored', async () => {
  const res = await t.api('POST', '/integrations/whatsapp_360dialog/connect', { apiKey: 'falsch', testAccount: true });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /lehnt den API-Schlüssel ab/);
  const list = await t.api('GET', '/integrations');
  assert.equal(list.body.find((i: any) => i.provider === 'whatsapp_360dialog').mode, 'sandbox');
});

test('connecting with a key registers the webhook and stores the key encrypted', async () => {
  sent.length = 0;
  const res = await t.api('POST', '/integrations/whatsapp_360dialog/connect', { apiKey: API_KEY, testAccount: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.mode, 'live');
  assert.match(res.body.detail, /Testzugang, Schlüssel …mnop/);
  assert.equal(res.body.webhookUrl, null, 'the secret webhook address is never shown');
  const hook = sent.find((r) => r.url.endsWith('/v1/configs/webhook'))!;
  assert.match(hook.body.url, /^http:\/\/localhost:3001\/api\/webhooks\/whatsapp_360dialog\/wh_/);
  webhookPath = new URL(hook.body.url).pathname;
  const [row] = await t.db.select().from(s.integrations).where(and(eq(s.integrations.tenantId, t.tenantId), eq(s.integrations.provider, 'whatsapp_360dialog')));
  assert.ok(!JSON.stringify(row.config).includes(API_KEY), 'key is not stored in plain text');
});

test('an incoming question is stored and answered by the AI with an AI notice', async () => {
  sent.length = 0;
  const res = await t.app.inject({ method: 'POST', url: webhookPath, payload: incoming('wamid.in1', 'Reifeneinlagerung?') });
  assert.equal(res.statusCode, 200);
  await whatsappIdle();
  const out = sent.find((r) => r.url.endsWith('/v1/messages'))!;
  assert.equal(out.body.to, '491712617554');
  assert.match(out.body.text.body, /^Hallo, hier ist .+, die KI-Assistenz von Kfz-Werkstatt Muster GmbH\./);

  const list = await t.api('GET', '/conversations?channel=whatsapp');
  const conv = list.body.items.find((c: any) => c.contactName === 'Philipp');
  assert.equal(conv.status, 'ai_handling');
  const detail = await t.api('GET', `/conversations/${conv.id}`);
  assert.deepEqual(detail.body.messages.map((m: any) => m.author), ['customer', 'ai']);

  // A repeated delivery of the same message is ignored; a status update marks the reply as read.
  await t.app.inject({ method: 'POST', url: webhookPath, payload: incoming('wamid.in1', 'Reifeneinlagerung?') });
  const status = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.out1', status: 'read' }] } }] }] };
  await t.app.inject({ method: 'POST', url: webhookPath, payload: status });
  await whatsappIdle();
  const again = await t.api('GET', `/conversations/${conv.id}`);
  assert.equal(again.body.messages.length, 2);
  assert.equal(again.body.messages[1].deliveryStatus, 'read');
});

test('an unknown question gets a holding reply and goes to the team', async () => {
  sent.length = 0;
  await t.app.inject({ method: 'POST', url: webhookPath, payload: incoming('wamid.in2', 'Verkauft ihr Xylophone?') });
  await whatsappIdle();
  const out = sent.find((r) => r.url.endsWith('/v1/messages'))!;
  assert.match(out.body.text.body, /Mitarbeiter meldet sich/);
  assert.doesNotMatch(out.body.text.body, /^Hallo, hier ist/, 'the AI notice comes only once per conversation');
  const list = await t.api('GET', '/conversations?channel=whatsapp');
  assert.equal(list.body.items.find((c: any) => c.contactName === 'Philipp').status, 'needs_staff');

  // Staff replies go out through 360dialog too.
  const conv = list.body.items.find((c: any) => c.contactName === 'Philipp');
  const reply = await t.api('POST', `/conversations/${conv.id}/messages`, { text: 'Leider nein 🙂' });
  assert.equal(reply.status, 201);
  assert.equal(sent.at(-1)!.body.text.body, 'Leider nein 🙂');
});

test('unknown webhook addresses are refused and disconnecting revokes the address', async () => {
  const bad = await t.app.inject({ method: 'POST', url: '/api/webhooks/whatsapp_360dialog/wh_falsch', payload: incoming('x', 'Hi') });
  assert.equal(bad.statusCode, 404);
  await t.api('POST', '/integrations/whatsapp_360dialog/disconnect');
  const after = await t.app.inject({ method: 'POST', url: webhookPath, payload: incoming('wamid.in3', 'Hallo?') });
  assert.equal(after.statusCode, 404);
});

test('parses buttons, other message types and BSUID senders', () => {
  const parsed = parseDialog360Webhook({
    entry: [{ changes: [{ value: { contacts: [{ user_id: 'u1', profile: { name: 'A' } }], messages: [
      { from_user_id: 'u1', id: 'm1', type: 'button', button: { text: 'Ja' } },
      { from: '49', id: 'm2', type: 'image' },
    ] } }] }],
  });
  assert.deepEqual(parsed.messages, [
    { id: 'm1', from: 'u1', name: 'A', text: 'Ja' },
    { id: 'm2', from: '49', name: null, text: '[image empfangen]' },
  ]);
});
