import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/db/schema.js';
import { sandboxLog } from '../src/providers/sandbox.js';
import { signLink, verifyLink } from '../src/lib/signed-links.js';
import { whatsappIdle } from '../src/routes/webhooks.js';
import { runDueJobs } from '../src/services/automations.js';
import { isStopMessage } from '../src/services/consents.js';
import { nextWeekday, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
before(async () => {
  process.env.APP_SECRET = 'test-secret-with-at-least-32-characters!';
  t = await setup();
});
after(async () => {
  await t.close();
});

const customerByName = async (name: string) => (await t.db.select().from(s.customers).where(eq(s.customers.name, name)))[0];
const emailsTo = (from: number, to: string) =>
  sandboxLog.slice(from).filter((e) => e.provider === 'email' && (e.payload as { to: string }).to === to) as { payload: { subject: string; text: string; headers?: Record<string, string> } }[];
const linkIn = (text: string, path: string) => {
  const m = text.match(new RegExp(`http://localhost:3001/api/public/${path}\\?t=([\\w.-]+)`));
  assert.ok(m, `link ${path} in mail`);
  return m[1];
};
const publicReq = (method: 'GET' | 'POST', path: string, token: string, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url: `/api/public/${path}?t=${token}`, headers, payload: method === 'POST' ? 'List-Unsubscribe=One-Click' : undefined });
const runAllJobs = async (type: string) => {
  const due = await t.db.select().from(s.jobs).where(and(eq(s.jobs.type, type), eq(s.jobs.status, 'pending')));
  const latest = Math.max(...due.map((j) => j.runAt.getTime()), Date.now());
  while ((await runDueJobs(t.db, new Date(latest + 1000))) > 0);
};

describe('signed links', () => {
  it('rejects tampered, expired or wrong-purpose tokens', () => {
    const token = signLink({ p: 'unsubscribe', t: 'ten_1', c: 'cus_1', ch: 'email' });
    assert.ok(verifyLink(token, 'unsubscribe'));
    assert.equal(verifyLink(token, 'confirm'), null);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ p: 'unsubscribe', t: 'ten_1', c: 'cus_2', ch: 'email' })).toString('base64url');
    assert.equal(verifyLink(`${forged}.${sig}`, 'unsubscribe'), null);
    assert.equal(verifyLink(`${payload}.x${sig}`, 'unsubscribe'), null);
    assert.equal(verifyLink(signLink({ p: 'confirm', t: 'a', c: 'b', ch: 'email', exp: Date.now() - 1 }), 'confirm'), null);
  });

  it('recognises STOP messages only as the whole message', () => {
    assert.ok(isStopMessage('STOP'));
    assert.ok(isStopMessage(' stopp! '));
    assert.ok(isStopMessage('Abmelden'));
    assert.equal(isStopMessage('Bitte nicht stoppen, ich komme morgen'), false);
  });
});

describe('marketing consent', () => {
  it('starts without consent and needs a source to grant it', async () => {
    const c = await customerByName('Max Müller');
    const res = await t.api('GET', `/customers/${c.id}/consents`);
    assert.deepEqual(res.body.map((x: { status: string }) => x.status), ['none', 'none']);
    const missing = await t.api('PUT', `/customers/${c.id}/consents`, { channel: 'email', action: 'grant' });
    assert.equal(missing.status, 400);
  });

  it('double opt-in: mail with link, page does nothing on GET, confirms on POST', async () => {
    const c = await customerByName('Max Müller');
    const before = sandboxLog.length;
    const res = await t.api('PUT', `/customers/${c.id}/consents`, { channel: 'email', action: 'request' });
    assert.equal(res.status, 200);
    assert.equal(res.body.find((x: { channel: string }) => x.channel === 'email').status, 'pending');
    const [mail] = emailsTo(before, c.email!);
    const token = linkIn(mail.payload.text, 'consent/confirm');

    const page = await publicReq('GET', 'consent/confirm', token);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Ja, ich möchte das/);
    assert.equal((await t.api('GET', `/customers/${c.id}/consents`)).body[0].status, 'pending', 'opening the link alone (mail scanners) changes nothing');

    const confirm = await publicReq('POST', 'consent/confirm', token, { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(confirm.statusCode, 200);
    assert.match(confirm.body, /Vielen Dank/);
    const after = (await t.api('GET', `/customers/${c.id}/consents`)).body[0];
    assert.equal(after.status, 'granted');
    assert.match(after.source, /Double-Opt-in/);
  });

  it('does not resend the confirmation mail within a few minutes', async () => {
    const c = await customerByName('Julia Schmidt');
    const first = await t.api('PUT', `/customers/${c.id}/consents`, { channel: 'email', action: 'request' });
    assert.equal(first.status, 200);
    const again = await t.api('PUT', `/customers/${c.id}/consents`, { channel: 'email', action: 'request' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'confirmation_recently_sent');
    // Reset so later tests start from no consent.
    await t.db.delete(s.communicationConsents).where(eq(s.communicationConsents.customerId, c.id));
  });

  it('changing the email address voids consent and old confirmation links', async () => {
    const c = await customerByName('Max Müller');
    const before = sandboxLog.length;
    await t.db.delete(s.communicationConsents).where(eq(s.communicationConsents.customerId, c.id));
    await t.api('PUT', `/customers/${c.id}/consents`, { channel: 'email', action: 'request' });
    const token = linkIn(emailsTo(before, c.email!)[0].payload.text, 'consent/confirm');

    const changed = await t.api('PATCH', `/customers/${c.id}`, { email: 'neu.max@example.de' });
    assert.equal(changed.status, 200);
    assert.equal((await t.api('GET', `/customers/${c.id}/consents`)).body[0].status, 'revoked');
    const confirm = await publicReq('POST', 'consent/confirm', token, { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(confirm.statusCode, 400, 'link for the old address no longer works');
    assert.equal((await t.api('GET', `/customers/${c.id}/consents`)).body[0].status, 'revoked');

    // Restore the original address and the granted consent the later tests rely on.
    await t.api('PATCH', `/customers/${c.id}`, { email: c.email });
    await t.api('PUT', `/customers/${c.id}/consents`, { channel: 'email', action: 'grant', source: 'Test: wiederhergestellt' });
  });

  it('a token for another tenant or a broken token shows an error page', async () => {
    const res = await publicReq('GET', 'unsubscribe', signLink({ p: 'unsubscribe', t: 'ten_fremd', c: 'cus_x', ch: 'email' }));
    assert.equal(res.statusCode, 400);
    const broken = await publicReq('POST', 'unsubscribe', 'abc.def', { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(broken.statusCode, 400);
  });
});

describe('Aktionen (campaigns)', () => {
  let campaignId = '';

  it('only counts customers with email consent', async () => {
    const julia = await customerByName('Julia Schmidt');
    await t.api('PUT', `/customers/${julia.id}/consents`, { channel: 'email', action: 'grant', source: 'Unterschrift auf dem Auftrag' });
    const res = await t.api('POST', '/campaigns/audience', {});
    assert.equal(res.body.count, 2, 'Max (confirmed) and Julia (signed)');
  });

  it('sends with unsubscribe link and one-click header, then counts', async () => {
    const created = await t.api('POST', '/campaigns', {
      title: 'Neue Alufelgen',
      subject: 'Neue Felgen für Ihren Wagen, {{vorname}}',
      body: 'Hallo {{vorname}},\n\nab sofort haben wir neue Alufelgen im Angebot.',
    });
    assert.equal(created.status, 201);
    campaignId = created.body.id;
    const before = sandboxLog.length;
    const sent = await t.api('POST', `/campaigns/${campaignId}/send`);
    assert.equal(sent.status, 200);
    assert.equal(sent.body.status, 'sending');
    assert.equal(sent.body.recipientCount, 2);
    await runAllJobs('campaign_send');

    const max = await customerByName('Max Müller');
    const [mail] = emailsTo(before, max.email!);
    assert.equal(mail.payload.subject, 'Neue Felgen für Ihren Wagen, Max');
    assert.match(mail.payload.text, /^Hallo Max,/);
    assert.match(mail.payload.text, /Abmelden mit einem Klick/);
    assert.equal(mail.payload.headers?.['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(emailsTo(before, 'p.wagner@example.de').length, 0, 'no mail without consent');

    const list = await t.api('GET', '/campaigns');
    const c = list.body.items.find((x: { id: string }) => x.id === campaignId);
    assert.equal(c.status, 'sent');
    assert.equal(c.sentCount, 2);
    assert.equal(list.body.emailLive, false, 'Brevo not connected in tests');
  });

  it('a sent campaign can neither be edited nor sent again', async () => {
    assert.equal((await t.api('PATCH', `/campaigns/${campaignId}`, { title: 'X' })).status, 409);
    assert.equal((await t.api('POST', `/campaigns/${campaignId}/send`)).status, 409);
  });

  it('one-click unsubscribe from the mail header revokes consent', async () => {
    const max = await customerByName('Max Müller');
    const [mail] = emailsTo(0, max.email!).filter((m) => /Alufelgen/.test(m.payload.text));
    const token = linkIn(mail.payload.text, 'unsubscribe');
    // Mail apps POST without an Origin header.
    const res = await publicReq('POST', 'unsubscribe', token, { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /abgemeldet/);
    assert.equal((await t.api('GET', `/customers/${max.id}/consents`)).body[0].status, 'revoked');
    assert.equal((await t.api('POST', '/campaigns/audience', {})).body.count, 1);
  });

  it('staff may draft but not send', async () => {
    const [demo] = await t.db.select().from(s.users).where(eq(s.users.email, 'demo@businesspilot.de'));
    await t.db.update(s.memberships).set({ role: 'staff' }).where(and(eq(s.memberships.userId, demo.id), eq(s.memberships.tenantId, t.tenantId)));
    try {
      const draft = await t.api('POST', '/campaigns', { title: 'Gutschein', subject: 'Gutscheinaktion', body: 'Text' });
      assert.equal(draft.status, 201);
      assert.equal((await t.api('POST', `/campaigns/${draft.body.id}/send`)).status, 403);
    } finally {
      await t.db.update(s.memberships).set({ role: 'owner' }).where(and(eq(s.memberships.userId, demo.id), eq(s.memberships.tenantId, t.tenantId)));
    }
  });
});

describe('Wiederbuchung (rebooking)', () => {
  it('stores the interval per service', async () => {
    const types = await t.api('GET', '/service-types');
    const reifen = types.body.find((x: { code: string }) => x.code === 'reifenwechsel');
    assert.equal(reifen.rebookAfterDays, 180);
    const res = await t.api('PATCH', `/service-types/${reifen.id}`, { rebookAfterDays: 170 });
    assert.equal(res.body.rebookAfterDays, 170);
    assert.equal((await t.api('PATCH', `/service-types/${reifen.id}`, { rebookAfterDays: 0 })).status, 400);
  });

  it('invites after completion, only with consent, with free slots', async () => {
    await t.api('POST', '/automations', { templateKey: 'rebooking' });
    const julia = await customerByName('Julia Schmidt'); // has email consent from above
    const date = nextWeekday(3);
    const { body } = await t.api('GET', `/availability?serviceCode=reifenwechsel&date=${date}`);
    const apt = await t.api('POST', '/appointments', { serviceCode: 'reifenwechsel', slotId: body.slots[0].slotId, customerId: julia.id });
    await t.api('PATCH', `/appointments/${apt.body.id}`, { status: 'completed' });

    const [job] = await t.db.select().from(s.jobs).where(eq(s.jobs.dedupeKey, `rebook:${apt.body.id}`));
    assert.ok(job, 'rebooking job scheduled');
    const days = (job.runAt.getTime() - Date.now()) / 86400000;
    assert.ok(days > 169 && days < 171, `about 170 days ahead, got ${days}`);

    const before = sandboxLog.length;
    await runDueJobs(t.db, new Date(job.runAt.getTime() + 1000));
    // The review request after the visit may go out in the same run; pick the rebooking mail.
    const [mail] = emailsTo(before, julia.email!).filter((m) => /nächsten Termin/.test(m.payload.subject));
    assert.ok(mail, 'invitation mail sent');
    assert.match(mail.payload.subject, /Reifenwechsel/);
    assert.match(mail.payload.text, /Freie Termine hätten wir zum Beispiel/);
    assert.match(mail.payload.text, /Abmelden mit einem Klick/);
  });

  it('sends nothing without consent', async () => {
    const wagner = await customerByName('Peter Wagner');
    const date = nextWeekday(4);
    const { body } = await t.api('GET', `/availability?serviceCode=reifenwechsel&date=${date}`);
    const apt = await t.api('POST', '/appointments', { serviceCode: 'reifenwechsel', slotId: body.slots[0].slotId, customerId: wagner.id });
    await t.api('PATCH', `/appointments/${apt.body.id}`, { status: 'completed' });
    const [job] = await t.db.select().from(s.jobs).where(eq(s.jobs.dedupeKey, `rebook:${apt.body.id}`));
    const before = sandboxLog.length;
    await runDueJobs(t.db, new Date(job.runAt.getTime() + 1000));
    // Service messages (review link, reminders) may still go out; the rebooking offer must not.
    assert.equal(emailsTo(before, wagner.email!).filter((m) => /nächsten Termin/.test(m.payload.subject)).length, 0);
    assert.equal(sandboxLog.slice(before).filter((e) => JSON.stringify(e.payload).includes('bald wieder so weit')).length, 0, 'not by WhatsApp either');
  });
});

describe('STOP via WhatsApp', () => {
  it('revokes marketing consent and answers without the AI', async () => {
    const API_KEY = 'd360-test-key-abcdefghijklmnop';
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://waba-sandbox.360dialog.io')) return realFetch(input, init);
      if (url.endsWith('/v1/configs/webhook')) return new Response('{"url":"ok"}', { status: 200 });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.stop' }] }), { status: 201 });
    }) as typeof fetch;
    try {
      await t.api('POST', '/integrations/whatsapp_360dialog/connect', { apiKey: API_KEY, testAccount: true });
      const julia = await customerByName('Julia Schmidt');
      const wa = julia.phone!.replace(/\D/g, '');
      // Call the service directly: storing and answering are what the webhook does.
      const { storeIncomingWhatsApp, autoReplyWhatsApp } = await import('../src/services/whatsapp.js');
      const convId = await storeIncomingWhatsApp(t.db, t.tenantId, { id: 'wamid.in.stop', from: wa, name: 'Julia', text: 'STOP' });
      assert.ok(convId);
      await autoReplyWhatsApp(t.db, t.tenantId, convId!);
      await whatsappIdle();
      const consents = (await t.api('GET', `/customers/${julia.id}/consents`)).body;
      assert.equal(consents.find((c: { channel: string }) => c.channel === 'email').status, 'revoked');
      const msgs = await t.db.select().from(s.messages).where(eq(s.messages.conversationId, convId!));
      const reply = msgs.filter((m) => m.direction === 'outbound').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      assert.match(reply!.text, /keine Angebote und Neuigkeiten mehr/);
      assert.equal(reply!.author, 'system');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('Brevo email', () => {
  it('checks the key, stores it encrypted and sends through Brevo', async () => {
    const KEY = 'xkeysib-test-0123456789abcdef';
    const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith('https://api.brevo.com')) return realFetch(input, init);
      const headers = init?.headers as Record<string, string>;
      calls.push({ url, headers, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (headers['api-key'] !== KEY) return new Response('{"code":"unauthorized"}', { status: 401 });
      if (url.endsWith('/account')) return new Response('{"email":"konto@example.de"}', { status: 200 });
      return new Response('{"messageId":"<m1@brevo>"}', { status: 201 });
    }) as typeof fetch;
    try {
      const wrong = await t.api('POST', '/integrations/brevo/connect', { apiKey: 'falsch', senderEmail: 'info@example.de' });
      assert.equal(wrong.status, 400);
      assert.match(wrong.body.message, /lehnt den API-Schlüssel ab/);
      const res = await t.api('POST', '/integrations/brevo/connect', { apiKey: KEY, senderEmail: 'info@example.de' });
      assert.equal(res.status, 200);
      assert.equal(res.body.mode, 'live');
      assert.match(res.body.detail, /info@example\.de/);
      const [row] = await t.db.select().from(s.integrations).where(and(eq(s.integrations.tenantId, t.tenantId), eq(s.integrations.provider, 'brevo')));
      assert.ok(!JSON.stringify(row.config).includes(KEY), 'key is not stored in plain text');
      assert.equal((await t.api('GET', '/campaigns')).body.emailLive, true);

      const julia = await customerByName('Julia Schmidt');
      await t.api('PUT', `/customers/${julia.id}/consents`, { channel: 'email', action: 'grant', source: 'Formular im Laden' });
      const draft = await t.api('POST', '/campaigns', { title: 'Gutschein', subject: 'Gutscheinaktion', body: 'Hallo {{name}}' });
      await t.api('POST', `/campaigns/${draft.body.id}/send`);
      await runAllJobs('campaign_send');
      const mail = calls.find((c) => c.url.endsWith('/smtp/email'))!;
      assert.equal(mail.body.to[0].email, julia.email);
      assert.equal(mail.body.sender.email, 'info@example.de');
      assert.equal(mail.body.sender.name, 'Kfz-Werkstatt Muster GmbH');
      assert.match(mail.body.headers['List-Unsubscribe'], /^<http:\/\/localhost:3001\/api\/public\/unsubscribe\?t=/);
    } finally {
      globalThis.fetch = realFetch;
      await t.api('POST', '/integrations/brevo/disconnect');
    }
  });
});

describe('request logs', () => {
  it('drop query strings and the webhook secret', async () => {
    const { redactUrl } = await import('../src/app.js');
    assert.equal(redactUrl('/api/public/unsubscribe?t=abc.def'), '/api/public/unsubscribe');
    assert.equal(redactUrl('/api/webhooks/whatsapp_360dialog/wh_s3cr3t'), '/api/webhooks/whatsapp_360dialog/wh_[redacted]');
  });
});
