import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { platformSettings } from '../src/db/schema.js';
import { setup } from './helpers.js';

// A stand-in for IONOS: speaks the OpenAI wire format and records what it was asked.
const TOKEN = 'ionos-test-token-0123456789abcdef';
const requests: { path: string; body: any }[] = [];
let down = false;
const fake: Server = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    requests.push({ path: req.url!, body: raw ? JSON.parse(raw) : null });
    const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (down) return send(503, { error: 'unavailable' });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
    if (req.url === '/v1/models') return send(200, { data: [{ id: 'meta-llama/Llama-3.3-70B-Instruct' }, { id: 'Qwen/Qwen3.5-397B-A17B' }] });
    send(200, { choices: [{ message: { content: 'Wir haben Mo–Fr von 8 bis 18 Uhr geöffnet.' } }] });
  });
});

let ctx: Awaited<ReturnType<typeof setup>>;
let baseUrl = '';

before(async () => {
  process.env.APP_SECRET = 'test-secret-with-at-least-32-characters!';
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/v1`;
  ctx = await setup();
});
after(async () => {
  await ctx.close();
  fake.close();
});

test('platform admin connects the LLM; the token is stored encrypted and never returned', async () => {
  const { api, db } = ctx;
  assert.equal((await api('GET', '/admin/ai')).body.configured, false);

  const wrong = await api('POST', '/admin/ai/models', { baseUrl, token: 'falscher-token-0123456789' });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /Token wurde abgelehnt/);

  const models = await api('POST', '/admin/ai/models', { baseUrl, token: TOKEN });
  assert.deepEqual(models.body.models, ['Qwen/Qwen3.5-397B-A17B', 'meta-llama/Llama-3.3-70B-Instruct']);

  const saved = await api('PUT', '/admin/ai', { baseUrl, token: TOKEN, model: 'Qwen/Qwen3.5-397B-A17B' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.tokenHint, '…cdef');
  assert.ok(!JSON.stringify(saved.body).includes(TOKEN));
  assert.equal(requests.at(-1)!.body.reasoning_effort, 'none', 'Qwen 3 reasoning is switched off');

  const [row] = await db.select().from(platformSettings);
  assert.ok(!JSON.stringify(row.value).includes(TOKEN), 'token is encrypted at rest');

  // Switching the model later works without re-entering the token.
  const switched = await api('PUT', '/admin/ai', { baseUrl, model: 'meta-llama/Llama-3.3-70B-Instruct' });
  assert.equal(switched.body.model, 'meta-llama/Llama-3.3-70B-Instruct');

  const answer = await api('POST', '/admin/ai/test', { question: 'Wann habt ihr geöffnet?' });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.answer, 'Wir haben Mo–Fr von 8 bis 18 Uhr geöffnet.');
  assert.match(requests.at(-1)!.body.messages[0].content, /WISSEN/);
  assert.match(requests.at(-1)!.body.messages[0].content, /Öffnungszeiten: Montag: \d\d:\d\d–\d\d:\d\d Uhr/, 'opening hours from the settings go along');
});

test('customer replies use the live model and fall back to the knowledge text when it is down', async () => {
  const { api } = ctx;
  const conv = (await api('GET', '/conversations?channel=whatsapp')).body.items[0];
  const live = await api('POST', `/conversations/${conv.id}/suggest-reply`);
  assert.equal(live.body.text, 'Wir haben Mo–Fr von 8 bis 18 Uhr geöffnet.');

  down = true;
  const fallback = await api('POST', `/conversations/${conv.id}/suggest-reply`);
  down = false;
  assert.equal(fallback.status, 200);
  assert.notEqual(fallback.body.text, live.body.text);
});

test('only platform admins see or change the LLM settings', async () => {
  const { api, db } = ctx;
  const { users } = await import('../src/db/schema.js');
  await db.update(users).set({ isPlatformAdmin: false });
  assert.equal((await api('GET', '/admin/ai')).status, 403);
  assert.equal((await api('DELETE', '/admin/ai')).status, 403);
  await db.update(users).set({ isPlatformAdmin: true });
  assert.equal((await api('DELETE', '/admin/ai')).body.configured, false);
});
