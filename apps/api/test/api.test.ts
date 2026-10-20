import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import * as s from '../src/db/schema.js';
import { zonedToUtc } from '../src/lib/time.js';
import { runDueJobs } from '../src/services/automations.js';
import { sandboxLog } from '../src/providers/sandbox.js';
import { nextWeekday, setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
before(async () => {
  t = await setup();
});
after(async () => {
  await t.close();
});

describe('time helpers', () => {
  it('maps Berlin wall-clock time to UTC across daylight saving', () => {
    assert.equal(zonedToUtc('2026-07-01', '08:00', 'Europe/Berlin').toISOString(), '2026-07-01T06:00:00.000Z');
    assert.equal(zonedToUtc('2026-12-01', '08:00', 'Europe/Berlin').toISOString(), '2026-12-01T07:00:00.000Z');
    assert.equal(zonedToUtc('2026-10-25', '12:00', 'Europe/Berlin').toISOString(), '2026-10-25T11:00:00.000Z');
  });
});

describe('auth', () => {
  it('rejects wrong passwords and unauthenticated requests', async () => {
    const { res } = await t.login('demo@businesspilot.de', 'falsch');
    assert.equal(res.statusCode, 401);
    const anon = await t.api('GET', '/customers', undefined, '');
    assert.equal(anon.status, 401);
  });

  it('returns the current user and tenant', async () => {
    const me = await t.api('GET', '/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.tenant.name, 'Kfz-Werkstatt Muster GmbH');
    assert.equal(me.body.role, 'owner');
  });

  it('blocks cross-site writes', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/customers',
      payload: { name: 'X' },
      headers: { cookie: (await t.login()).cookie, origin: 'https://evil.example', host: 'localhost:3001' },
    });
    assert.equal(res.statusCode, 403);
  });
});

describe('tenant isolation', () => {
  it('never returns another tenant’s customer', async () => {
    const [other] = await t.db.select().from(s.tenants).where(eq(s.tenants.name, 'Beauty Lounge Lena'));
    await t.db.insert(s.customers).values({ id: 'cus_OTHERTENANT01', tenantId: other.id, number: 'K-1', name: 'Fremdkunde' });
    const res = await t.api('GET', '/customers/cus_OTHERTENANT01');
    assert.equal(res.status, 404);
    const list = await t.api('GET', '/customers?q=Fremd');
    assert.equal(list.body.length, 0);
    const patch = await t.api('PATCH', '/customers/cus_OTHERTENANT01', { name: 'Hack' });
    assert.equal(patch.status, 404);
  });
});

describe('CRM', () => {
  it('creates a customer with a vehicle and shows it in the customer file', async () => {
    const c = await t.api('POST', '/customers', { name: 'Erika Mustermann', phone: '+49 171 5550000', email: '' });
    assert.equal(c.status, 201);
    assert.match(c.body.number, /^K-/);
    const a = await t.api('POST', `/customers/${c.body.id}/assets`, { kind: 'vehicle', label: 'Opel Corsa', identifier: 'M-EM 1' });
    assert.equal(a.status, 201);
    const detail = await t.api('GET', `/customers/${c.body.id}`);
    assert.equal(detail.body.assets[0].identifier, 'M-EM 1');
  });

  it('computes quote totals from line items, never from the client', async () => {
    const q = await t.api('POST', '/quotes', {
      title: 'Test',
      items: [
        { description: 'Teil', quantity: 2, unitPriceCents: 1000 },
        { description: 'Arbeit', quantity: 1.5, unitPriceCents: 10000 },
      ],
      totalCents: 1,
    });
    assert.equal(q.status, 201);
    assert.equal(q.body.totalCents, 17000);
    assert.match(q.body.number, /^AN-\d+$/);
  });

  it('keeps lead stage totals consistent with the cards', async () => {
    const res = await t.api('GET', '/leads');
    for (const stage of res.body.stages) {
      const cards = res.body.items.filter((l: { stage: string }) => l.stage === stage.key);
      assert.equal(stage.count, cards.length);
      assert.equal(stage.valueCents, cards.reduce((sum: number, l: { valueCents: number }) => sum + l.valueCents, 0));
    }
  });
});

describe('scheduling', () => {
  const date = nextWeekday(3);

  it('offers slots only inside business hours (Berlin time)', async () => {
    const res = await t.api('GET', `/availability?serviceCode=reifenwechsel&date=${date}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.slots.length > 0);
    const open = zonedToUtc(date, '07:30', 'Europe/Berlin').getTime();
    const close = zonedToUtc(date, '17:00', 'Europe/Berlin').getTime();
    for (const slot of res.body.slots) {
      assert.ok(new Date(slot.startsAt).getTime() >= open);
      assert.ok(new Date(slot.endsAt).getTime() <= close);
    }
  });

  it('never double-books a slot under concurrent requests', async () => {
    const { body } = await t.api('GET', `/availability?serviceCode=diagnose&date=${date}`);
    const slotId = body.slots[0].slotId;
    // Diagnose needs the one staff member with the "diagnose" skill, so only one booking can win.
    const results = await Promise.all(Array.from({ length: 5 }, () => t.api('POST', '/appointments', { serviceCode: 'diagnose', slotId })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 4);
    const after = await t.api('GET', `/availability?serviceCode=diagnose&date=${date}`);
    assert.ok(!after.body.slots.some((s: { startsAt: string }) => s.startsAt === body.slots[0].startsAt));
  });

  it('frees the slot again when an appointment is cancelled', async () => {
    const { body } = await t.api('GET', `/availability?serviceCode=hu&date=${date}`);
    const booked = await t.api('POST', '/appointments', { serviceCode: 'hu', slotId: body.slots[0].slotId });
    assert.equal(booked.status, 201);
    await t.api('PATCH', `/appointments/${booked.body.id}`, { status: 'cancelled' });
    const again = await t.api('GET', `/availability?serviceCode=hu&date=${date}`);
    assert.equal(again.body.slots[0].startsAt, body.slots[0].startsAt);
  });
});

describe('fonio voice flow', () => {
  it('rejects calls without a valid key', async () => {
    const res = await t.voice('/fonio/inbound', { fromNumber: '+491701234567' }, 'wrong');
    assert.equal(res.status, 401);
  });

  it('recognises a caller, finds slots, books once and records the call', async () => {
    const inbound = await t.voice('/fonio/inbound', { fromNumber: '0170 1234567', toNumber: '+49891234567' });
    assert.equal(inbound.status, 200);
    assert.equal(inbound.body.customer_name, 'Max Müller');
    assert.match(inbound.body.greeting, /KI/); // AI Act disclosure
    const token = inbound.body.bp_session_token;

    const search = await t.voice('/tools/availability/search', { session_token: token, service_code: 'reifenwechsel', requested_date: nextWeekday(4) });
    assert.equal(search.body.result, 'slots_available');
    assert.ok(search.body.slots.length <= 3);

    const unconfirmed = await t.voice('/tools/appointments/book', { session_token: token, slot_id: search.body.slots[0].slot_id, customer_confirmed: 'false' });
    assert.equal(unconfirmed.body.result, 'confirmation_required');

    const book = { session_token: token, slot_id: search.body.slots[0].slot_id, customer_confirmed: 'true' };
    const first = await t.voice('/tools/appointments/book', book);
    const retry = await t.voice('/tools/appointments/book', book);
    assert.equal(first.body.result, 'appointment_booked');
    assert.equal(retry.body.appointment_id, first.body.appointment_id); // idempotent

    const post = await t.voice('/fonio/post-call', {
      session_token: token,
      outcome: 'completed',
      intent: 'Reifenwechsel',
      summary: 'Termin gebucht',
      transcript: 'Anna: Hallo\nKunde: Reifenwechsel bitte',
      duration_sec: '95',
    });
    assert.equal(post.status, 200);
    const list = await t.api('GET', '/conversations?channel=phone');
    const conv = list.body.items.find((c: { preview: string }) => c.preview === 'Termin gebucht');
    assert.ok(conv);
    const detail = await t.api('GET', `/conversations/${conv.id}`);
    assert.equal(detail.body.call.transcript.length, 2);
    assert.deepEqual(detail.body.call.actions, ['Kontakt erkannt']);
  });

  it('creates a new customer for an unknown caller when booking', async () => {
    const inbound = await t.voice('/fonio/inbound', { fromNumber: '+49 157 0000001' });
    assert.equal(inbound.body.customer_known, false);
    const token = inbound.body.bp_session_token;
    const search = await t.voice('/tools/availability/search', { session_token: token, service_code: 'reifenwechsel', requested_date: nextWeekday(5) });
    const noName = await t.voice('/tools/appointments/book', { session_token: token, slot_id: search.body.slots[0].slot_id, customer_confirmed: true });
    assert.equal(noName.body.result, 'name_required');
    const ok = await t.voice('/tools/appointments/book', { session_token: token, slot_id: search.body.slots[0].slot_id, customer_confirmed: true, customer_name: 'Neu Kunde' });
    assert.equal(ok.body.result, 'appointment_booked');
    const customers = await t.api('GET', '/customers?q=Neu Kunde');
    assert.equal(customers.body[0].phone, '+49 157 0000001');
  });

  it('files the post-call under the latest open call when fonio sends no usable session token', async () => {
    const inbound = await t.voice('/fonio/inbound', { fromNumber: '+49 160 5550001' });
    const post = await t.voice('/fonio/post-call', { session_token: '{{bp_session_token}}', summary: 'Ohne Token zugeordnet', transcript: 'Kunde: Hallo' });
    assert.equal(post.status, 200);
    const list = await t.api('GET', '/conversations?channel=phone');
    const conv = list.body.items.find((c: { preview: string }) => c.preview === 'Ohne Token zugeordnet');
    assert.ok(conv, 'the call is filed although the token was not filled in');
    assert.ok(inbound.body.bp_session_token);

    const log = await t.api('GET', '/integrations/fonio/log');
    const entry = log.body.entries.find((e: { path: string }) => e.path === '/fonio/post-call');
    assert.match(entry.note, /letzten offenen Anruf/);
    assert.equal(entry.fields.summary, 'Ohne Token zugeordnet');
    assert.ok(log.body.unauthenticated.some((e: { status: number }) => e.status === 401), 'calls with a wrong key are listed for platform admins');
  });

  it('opens a conversation for a post-call report when no call start was reported', async () => {
    // The earlier tests leave open sessions; age them past the fallback window.
    const { voiceSessions } = await import('../src/db/schema.js');
    await t.db.update(voiceSessions).set({ createdAt: new Date(Date.now() - 3 * 3600_000) });
    const post = await t.voice('/fonio/post-call', { summary: 'Nur Nachbericht', fromNumber: '+49 171 5550002', started_at: new Date(Date.now() - 90_000).toISOString() });
    assert.equal(post.status, 200);
    const list = await t.api('GET', '/conversations?channel=phone');
    const conv = list.body.items.find((c: { preview: string }) => c.preview === 'Nur Nachbericht');
    const detail = await t.api('GET', `/conversations/${conv.id}`);
    assert.ok(Math.abs(detail.body.call.durationSec - 90) <= 5, 'duration from the start time');
  });

  it('books by spoken day, time and service name with only fonio\'s call id', async () => {
    const date = nextWeekday(6);
    const search = await t.voice('/tools/availability/search', { service_code: 'Reifen wechseln', requested_date: date });
    assert.equal(search.body.result, 'slots_available');
    const slot = search.body.slots[0];
    assert.match(slot.time, /^\d\d:\d\d$/);

    const unknown = await t.voice('/tools/appointments/book', { call_id: 'fonio-call-1', service_code: 'Reifenwechsel', date: slot.date, time: '03:00', customer_confirmed: 'true', customer_name: 'Tel Kunde' });
    assert.equal(unknown.body.result, 'slot_unavailable');

    const [d, m] = [slot.date.slice(8, 10), slot.date.slice(5, 7)];
    const book = await t.voice('/tools/appointments/book', { call_id: 'fonio-call-1', service_code: 'Reifenwechsel', date: `${d}.${m}.`, time: `${slot.time} Uhr`, customer_confirmed: 'ja', customer_name: 'Tel Kunde' });
    assert.equal(book.body.result, 'appointment_booked');

    // The report after the call lands in the same conversation as the booking.
    const post = await t.voice('/fonio/post-call', { call_id: 'fonio-call-1', summary: 'Reifenwechsel per Call-ID gebucht' });
    assert.equal(post.status, 200);
    const list = await t.api('GET', '/conversations?channel=phone');
    const conv = list.body.items.find((c: { preview: string }) => c.preview === 'Reifenwechsel per Call-ID gebucht');
    assert.equal(conv.contactName, 'Tel Kunde');
  });

  it('understands spoken dates', async () => {
    const { spokenDate, spokenTime } = await import('../src/routes/voice.js');
    const now = new Date('2026-10-20T10:00:00Z'); // a Tuesday
    assert.equal(spokenDate('morgen', 'Europe/Berlin', now), '2026-10-21');
    assert.equal(spokenDate('Samstag', 'Europe/Berlin', now), '2026-10-24');
    assert.equal(spokenDate('nächsten Dienstag', 'Europe/Berlin', now), '2026-10-27');
    assert.equal(spokenDate('3.1.', 'Europe/Berlin', now), '2027-01-03');
    assert.equal(spokenTime('9 Uhr'), '09:00');
    assert.equal(spokenTime('14.30'), '14:30');
  });

  it('answers from the knowledge base', async () => {
    const res = await t.voice('/tools/knowledge/query', { question: 'Wann habt ihr samstags offen?' });
    assert.match(res.body.answer, /samstags/);
  });
});

describe('automations', () => {
  it('sends the review link to every customer after completion (no gating)', async () => {
    const date = nextWeekday(3);
    const [customer] = await t.db.select().from(s.customers).where(eq(s.customers.name, 'Peter Wagner'));
    const { body } = await t.api('GET', `/availability?serviceCode=reifenwechsel&date=${date}`);
    const apt = await t.api('POST', '/appointments', { serviceCode: 'reifenwechsel', slotId: body.slots[body.slots.length - 1].slotId, customerId: customer.id });
    await t.api('PATCH', `/appointments/${apt.body.id}`, { status: 'completed' });

    const [job] = await t.db.select().from(s.jobs).where(and(eq(s.jobs.type, 'review_request'), eq(s.jobs.dedupeKey, `review:${apt.body.id}`)));
    assert.ok(job, 'review job scheduled');
    const sentBefore = sandboxLog.length;
    await runDueJobs(t.db, new Date(job.runAt.getTime() + 1000));
    const sent = sandboxLog.slice(sentBefore).find((e) => e.action === 'sendText');
    assert.ok(sent);
    assert.match(JSON.stringify(sent.payload), /g\.page\/r\/kfz-werkstatt-muster\/review/);
    assert.doesNotMatch(JSON.stringify(sent.payload), /zufrieden\?/i);

    const reviews = await t.api('GET', '/reviews');
    assert.ok(reviews.body.items.some((r: { status: string; customer: { name: string } }) => r.customer?.name === 'Peter Wagner' && r.status === 'sent'));
  });

  it('activating a template twice keeps one automation', async () => {
    await t.api('POST', '/automations', { templateKey: 'new_lead' });
    await t.api('POST', '/automations', { templateKey: 'new_lead' });
    const res = await t.api('GET', '/automations');
    assert.equal(res.body.items.filter((a: { templateKey: string }) => a.templateKey === 'new_lead').length, 1);
  });
});

describe('analytics', () => {
  it('uses one consistent set of numbers', async () => {
    const res = await t.api('GET', '/analytics?days=30');
    const a = res.body;
    assert.equal(a.byChannel.reduce((sum: number, g: { minutes: number }) => sum + g.minutes, 0), a.minutesSaved);
    assert.equal(a.byChannel.reduce((sum: number, g: { count: number }) => sum + g.count, 0), a.interactions);
    assert.equal(a.weekly.reduce((sum: number, w: { interactions: number }) => sum + w.interactions, 0), a.interactions);
    assert.equal(a.valueCents, Math.round((a.minutesSaved / 60) * a.hourlyRateCents));
    const dash = await t.api('GET', '/dashboard?days=30');
    assert.equal(dash.body.hero.interactions, a.interactions);
  });
});
