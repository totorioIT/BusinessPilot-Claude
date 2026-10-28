import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiKeys,
  appointments,
  calls,
  conversations,
  customerAssets,
  customers,
  leads,
  messages,
  serviceTypes,
  tasks,
  tenants,
  voiceSessions,
} from '../db/schema.js';
import { newToken, sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { parse } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { addMinutes, isoWeekday, localDate, localTime, spokenDateTime, zonedToUtc } from '../lib/time.js';
import { providersFor } from '../providers/registry.js';
import { automationHooks } from '../services/automations.js';
import { answerQuestion } from '../services/knowledge.js';
import { bookSlot, searchAvailability } from '../services/scheduling.js';
import { logWebhook } from '../services/webhook-log.js';
import { nextCustomerNumber } from './crm.js';

// fonio webhook and tool endpoints (blueprint "Integrationsflows und Payloads").
// fonio runs the conversation; before any decision it asks BusinessPilot here.
// Values arrive from fonio's variable templates, so they are often strings ("true", "").

const AI = { type: 'ai' as const, name: null };
const SESSION_MINUTES = 60;
const POST_CALL_FALLBACK_MINUTES = 120;
/** A call's first tool request comes within minutes of ringing; older inbound sessions belong to other calls. */
const INBOUND_ADOPT_MINUTES = 15;

const str = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim()));
const bool = z
  .union([z.boolean(), z.string()])
  .optional()
  .nullable()
  .transform((v) => v === true || (typeof v === 'string' && ['true', 'ja', 'yes', '1'].includes(v.toLowerCase())));

/** fonio sends the call's start time but no duration; the report arrives right after hang-up. */
const secondsSince = (start: unknown) => {
  const t = typeof start === 'string' || typeof start === 'number' ? new Date(start).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.min(4 * 3600, Math.round((Date.now() - t) / 1000))) : 0;
};

/** Compare phone numbers by their last 9 digits, which ignores +49 / 0 prefixes and spacing. */
export const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-9);

async function tenantFromKey(app: FastifyInstance, req: FastifyRequest) {
  const header = req.headers.authorization ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!key) throw new HttpError(401, 'unauthorized', 'API-Schlüssel fehlt.');
  const [row] = await app.db
    .select({ tenantId: apiKeys.tenantId })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, sha256(key)), eq(apiKeys.provider, 'fonio'), isNull(apiKeys.revokedAt)));
  if (!row) throw new HttpError(401, 'unauthorized', 'Ungültiger API-Schlüssel.');
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, row.tenantId));
  (req as FastifyRequest & { voiceTenantId?: string }).voiceTenantId = tenant.id;
  return tenant;
}

/** The session a fonio call was given at ring time. */
async function voiceSession(app: FastifyInstance, tenantId: string, token: string | null, call?: { callId: string | null; fromNumber?: string | null }) {
  if (!token) {
    // Browser test calls in fonio skip the inbound webhook, so tools and the post-call report
    // can identify the call by fonio's call id instead; the first one to arrive opens the session.
    if (call?.callId) return callSession(app, tenantId, call.callId, call.fromNumber ?? null);
    throw new HttpError(400, 'session_required', 'session_token oder call_id fehlt.');
  }
  const [s] = await app.db
    .select()
    .from(voiceSessions)
    .where(and(eq(voiceSessions.id, sha256(token)), eq(voiceSessions.tenantId, tenantId), gt(voiceSessions.expiresAt, new Date())));
  if (!s) throw new HttpError(401, 'session_expired', 'Die Gesprächssitzung ist abgelaufen.');
  return s;
}

const callSessionId = (tenantId: string, callId: string) => sha256(`fonio-call:${tenantId}:${callId}`);

async function callSession(app: FastifyInstance, tenantId: string, callId: string, fromNumber: string | null) {
  const id = callSessionId(tenantId, callId);
  const [existing] = await app.db.select().from(voiceSessions).where(eq(voiceSessions.id, id));
  if (existing) return existing;

  // On real calls the inbound webhook already opened a session, but fonio can't hand its token to the
  // tools. Adopt the newest inbound session no call id has claimed yet, so caller recognition and the
  // conversation carry over.
  const [inbound] = await app.db
    .select({ session: voiceSessions })
    .from(voiceSessions)
    .leftJoin(calls, eq(calls.conversationId, voiceSessions.conversationId))
    .where(
      and(
        eq(voiceSessions.tenantId, tenantId),
        isNull(calls.id),
        gt(voiceSessions.createdAt, addMinutes(new Date(), -INBOUND_ADOPT_MINUTES)),
        sql`(select count(*) from ${voiceSessions} v2 where v2.conversation_id = ${voiceSessions.conversationId}) = 1`,
      ),
    )
    .orderBy(desc(voiceSessions.createdAt))
    .limit(1);
  if (inbound) {
    const s = inbound.session;
    const [adopted] = await app.db
      .insert(voiceSessions)
      .values({ id, tenantId, conversationId: s.conversationId, customerId: s.customerId, fromNumber: s.fromNumber ?? fromNumber, expiresAt: s.expiresAt })
      .onConflictDoNothing()
      .returning();
    if (adopted) return adopted;
    const [winner] = await app.db.select().from(voiceSessions).where(eq(voiceSessions.id, id));
    return winner;
  }

  const [conv] = await app.db
    .insert(conversations)
    .values({ id: newId('conv'), tenantId, channel: 'phone', status: 'ai_handling', contactAddress: fromNumber, subject: 'Eingehender Anruf' })
    .returning();
  const [created] = await app.db
    .insert(voiceSessions)
    .values({ id, tenantId, conversationId: conv.id, fromNumber, expiresAt: addMinutes(new Date(), SESSION_MINUTES) })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  // Two tool calls raced; keep the session that won and drop the spare conversation.
  await app.db.delete(conversations).where(eq(conversations.id, conv.id));
  const [winner] = await app.db.select().from(voiceSessions).where(eq(voiceSessions.id, id));
  return winner;
}

const WEEKDAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];

/** What a voice agent says about a date ("2026-10-24", "24.10.", "morgen", "Samstag") → "YYYY-MM-DD". */
export function spokenDate(input: string | null, timeZone: string, now = new Date()): string | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  const today = localDate(now, timeZone);
  const plusDays = (n: number) => localDate(addMinutes(zonedToUtc(today, '12:00', timeZone), n * 1440), timeZone);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dm = text.match(/(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{2,4})?/);
  if (dm) {
    const year = dm[3] ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : Number(today.slice(0, 4));
    let date = `${year}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    if (!dm[3] && date < today) date = `${year + 1}${date.slice(4)}`;
    return date;
  }
  if (/übermorgen|uebermorgen/.test(text)) return plusDays(2);
  if (/morgen/.test(text)) return plusDays(1);
  if (/heute/.test(text)) return today;
  const wd = WEEKDAYS.findIndex((d) => text.includes(d));
  if (wd >= 0) {
    const diff = (wd + 1 - isoWeekday(today) + 7) % 7;
    return plusDays(diff === 0 && /nächst|naechst/.test(text) ? 7 : diff);
  }
  return null;
}

/** "10:30", "10.30", "10 Uhr", "halb elf" is out of scope → "HH:MM". */
export function spokenTime(input: string | null): string | null {
  const m = input?.match(/(\d{1,2})(?:[:.](\d{2}))?/);
  if (!m || Number(m[1]) > 23) return null;
  return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
}

/** Finds the service by code or by what the caller called it ("Reifen wechseln" → reifenwechsel). */
async function voiceServiceType(db: FastifyInstance['db'], tenantId: string, input: string) {
  const norm = (v: string) => v.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
  const all = await db.select().from(serviceTypes).where(and(eq(serviceTypes.tenantId, tenantId), eq(serviceTypes.active, true)));
  const q = norm(input);
  const st =
    all.find((s) => s.code === input) ??
    all.find((s) => norm(s.code) === q || norm(s.name) === q) ??
    all.find((s) => q.includes(norm(s.code)) || norm(s.name).includes(q) || q.includes(norm(s.name))) ??
    all.find((s) => norm(s.code).slice(0, 5) === q.slice(0, 5));
  return { st: st ?? null, names: all.map((s) => s.name) };
}

const timeOfDayFilter = (tod: string | null, start: Date, tz: string) => {
  if (!tod) return true;
  const hour = Number(localTime(start, tz).slice(0, 2));
  if (/vormittag|morning|früh/i.test(tod)) return hour < 12;
  if (/nachmittag|afternoon/i.test(tod)) return hour >= 12 && hour < 17;
  if (/abend|evening/i.test(tod)) return hour >= 16;
  return true;
};

export async function voiceRoutes(app: FastifyInstance) {
  const db = app.db;

  // Every call fonio makes is listed on the integrations page, so a misconfigured assistant
  // (missing header, empty variable) shows up there instead of failing silently.
  app.addHook('onSend', async (req, reply, payload) => {
    let note: string | null = null;
    if (reply.statusCode >= 400 && typeof payload === 'string') {
      try {
        note = (JSON.parse(payload) as { message?: string }).message ?? null;
      } catch {
        note = null;
      }
    }
    const tenantId = (req as FastifyRequest & { voiceTenantId?: string }).voiceTenantId ?? null;
    logWebhook(tenantId, { path: req.url.replace(/^\/api\/voice/, '').split('?')[0], status: reply.statusCode, body: req.body, note: note ?? (req as FastifyRequest & { voiceNote?: string }).voiceNote ?? null });
    return payload;
  });

  app.post('/fonio/inbound', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(z.object({ fromNumber: str, toNumber: str }).passthrough(), req.body);
    const from = body.fromNumber;

    let customer: typeof customers.$inferSelect | undefined;
    if (from && phoneKey(from).length >= 6) {
      [customer] = await db
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenant.id), sql`right(regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g'), 9) = ${phoneKey(from)}`))
        .limit(1);
    }
    const [asset] = customer
      ? await db.select().from(customerAssets).where(eq(customerAssets.customerId, customer.id)).orderBy(desc(customerAssets.createdAt)).limit(1)
      : [];
    const [lastApt] = customer
      ? await db.select().from(appointments).where(eq(appointments.customerId, customer.id)).orderBy(desc(appointments.startsAt)).limit(1)
      : [];

    const [conv] = await db
      .insert(conversations)
      .values({
        id: newId('conv'),
        tenantId: tenant.id,
        customerId: customer?.id ?? null,
        channel: 'phone',
        status: 'ai_handling',
        contactName: customer?.name ?? null,
        contactAddress: from,
        subject: 'Eingehender Anruf',
      })
      .returning();

    const token = `sess_${newToken()}`;
    await db.insert(voiceSessions).values({
      id: sha256(token),
      tenantId: tenant.id,
      conversationId: conv.id,
      customerId: customer?.id ?? null,
      fromNumber: from,
      expiresAt: addMinutes(new Date(), SESSION_MINUTES),
    });

    const ai = tenant.aiSettings;
    return {
      tenant_id: tenant.id,
      bp_session_token: token,
      company_name: tenant.name,
      ai_name: ai.name,
      // AI Act Art. 50: callers must be told they are talking to an AI.
      greeting: `Hallo, ich bin ${ai.name}, die KI-Assistenz von ${tenant.name}. ${ai.greeting}`.trim(),
      customer_known: Boolean(customer),
      customer_id: customer?.id ?? '',
      customer_name: customer?.name ?? '',
      vehicle_id: asset?.id ?? '',
      vehicle_plate: asset?.identifier ?? '',
      vehicle_model: asset?.label ?? '',
      last_service: lastApt?.title ?? '',
      preferred_language: 'de',
      human_transfer_number: tenant.phone ?? '',
    };
  });

  app.post('/tools/customer/lookup', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(z.object({ session_token: str, call_id: str, fromNumber: str, phone: str, name: str, plate: str }).passthrough(), req.body);
    const session = await voiceSession(app, tenant.id, body.session_token, { callId: body.call_id, fromNumber: body.fromNumber });
    let rows: (typeof customers.$inferSelect)[] = [];
    // A name or plate is only what the caller says; only the calling number is checked by the
    // network. Callers matched by what they say learn nothing they didn't already know.
    let matchedBy: 'plate' | 'phone' | 'name' = 'plate';
    let plate: string | null = null;
    if (body.plate) {
      plate = body.plate.replace(/[\s-]/g, '').toUpperCase();
      const hits = await db
        .select({ customer: customers })
        .from(customerAssets)
        .innerJoin(customers, eq(customers.id, customerAssets.customerId))
        .where(and(eq(customerAssets.tenantId, tenant.id), sql`upper(regexp_replace(coalesce(${customerAssets.identifier}, ''), '[\\s-]', '', 'g')) = ${plate}`));
      rows = hits.map((h) => h.customer);
    }
    const phone = body.phone ?? session.fromNumber;
    if (rows.length === 0 && phone) {
      matchedBy = 'phone';
      rows = await db
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, tenant.id), sql`right(regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g'), 9) = ${phoneKey(phone)}`));
    }
    if (rows.length === 0 && body.name) {
      matchedBy = 'name';
      rows = await db.select().from(customers).where(and(eq(customers.tenantId, tenant.id), sql`lower(${customers.name}) = lower(${body.name})`));
    }
    if (rows.length !== 1) {
      return { ok: true, result: rows.length === 0 ? 'not_found' : 'ambiguous', spoken_summary: 'Ich konnte Sie leider nicht eindeutig zuordnen. Wie ist Ihr vollständiger Name?' };
    }
    const c = rows[0];
    const verified = Boolean(session.fromNumber && c.phone && phoneKey(session.fromNumber) === phoneKey(c.phone));
    const assets = (await db.select().from(customerAssets).where(eq(customerAssets.customerId, c.id))).filter((x) =>
      verified ? true : matchedBy === 'plate' && (x.identifier ?? '').replace(/[\s-]/g, '').toUpperCase() === plate,
    );
    await db.update(voiceSessions).set({ customerId: c.id }).where(eq(voiceSessions.id, session.id));
    if (session.conversationId) await db.update(conversations).set({ customerId: c.id, contactName: c.name }).where(eq(conversations.id, session.conversationId));
    return {
      ok: true,
      result: 'found',
      customer_id: c.id,
      customer_name: c.name,
      /** False when the caller's number doesn't belong to this customer: share no further details. */
      verified,
      vehicles: assets.map((x) => ({ vehicle_id: x.id, label: x.label, plate: x.identifier })),
      spoken_summary: `Ich habe Sie gefunden, ${c.name}.`,
    };
  });

  app.post('/tools/availability/search', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(
      z.object({ session_token: str, service_code: str, requested_date: str, requested_time_of_day: str }).passthrough(),
      req.body,
    );
    // Searching changes nothing, so it needs no session: fonio may ask before anything else happened.
    if (!body.service_code) return { ok: false, result: 'service_required', spoken_summary: 'Um welche Leistung geht es genau?' };
    const { st, names } = await voiceServiceType(db, tenant.id, body.service_code);
    if (!st) {
      return { ok: false, result: 'unknown_service', services: names, spoken_summary: `Diese Leistung kann ich leider nicht direkt buchen. Buchen kann ich: ${names.join(', ')}.` };
    }
    const providers = await providersFor(db, tenant.id);
    const startDate = spokenDate(body.requested_date, tenant.timezone) ?? localDate(new Date(), tenant.timezone);

    try {
      // Look at the requested day first, then up to a week ahead, and offer at most three slots.
      for (let i = 0; i < 8; i++) {
        const date = localDate(addMinutes(zonedToUtc(startDate, '12:00', tenant.timezone), i * 1440), tenant.timezone);
        const slots = (await searchAvailability(db, { tenantId: tenant.id, serviceCode: st.code, date, calendar: providers.calendar })).filter((s) =>
          timeOfDayFilter(body.requested_time_of_day, s.startsAt, tenant.timezone),
        );
        if (slots.length === 0) continue;
        const offer = slots.length > 3 ? [slots[0], slots[Math.floor(slots.length / 2)], slots[slots.length - 1]] : slots;
        const times = offer.map((s) => `${localTime(s.startsAt, tenant.timezone)} Uhr`);
        const day = spokenDateTime(offer[0].startsAt, tenant.timezone).split(' um ')[0];
        return {
          ok: true,
          result: 'slots_available',
          service_code: st.code,
          slots: offer.map((s) => ({
            slot_id: s.slotId,
            date: localDate(s.startsAt, tenant.timezone),
            time: localTime(s.startsAt, tenant.timezone),
            starts_at: s.startsAt.toISOString(),
            ends_at: s.endsAt.toISOString(),
          })),
          spoken_summary: `${i === 0 ? '' : 'An Ihrem Wunschtag ist leider nichts frei. '}Am ${day} sind Termine um ${times.join(', ').replace(/, ([^,]*)$/, ' und $1')} frei.`,
          requires_customer_confirmation: true,
        };
      }
      return { ok: true, result: 'no_slots', slots: [], spoken_summary: 'In der nächsten Woche ist leider kein Termin frei. Ich notiere einen Rückruf.' };
    } catch (err) {
      // Degraded mode: never invent slots when the calendar can't be checked.
      req.log.error(err);
      return { ok: false, result: 'calendar_unavailable', spoken_summary: 'Ich kann den Kalender gerade nicht prüfen. Ich notiere Ihren Terminwunsch, und wir rufen Sie zurück.' };
    }
  });

  app.post('/tools/appointments/book', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(
      z
        .object({
          session_token: str,
          call_id: str,
          fromNumber: str,
          slot_id: str,
          date: str,
          time: str,
          service_code: str,
          customer_id: str,
          vehicle_id: str,
          customer_name: str,
          customer_confirmed: bool,
          idempotency_key: str,
        })
        .passthrough(),
      req.body,
    );
    const session = await voiceSession(app, tenant.id, body.session_token, { callId: body.call_id, fromNumber: body.fromNumber });
    if (!body.customer_confirmed) {
      return { ok: false, result: 'confirmation_required', spoken_summary: 'Soll ich den Termin verbindlich für Sie buchen?' };
    }
    let slotId = body.slot_id;
    if (!slotId) {
      // Voice agents repeat what was said ("Samstag, 10 Uhr") more reliably than an opaque slot id.
      const date = spokenDate(body.date, tenant.timezone);
      const time = spokenTime(body.time);
      if (!date || !time || !body.service_code) return { ok: false, result: 'slot_required', spoken_summary: 'Für welche Leistung und an welchem Tag zu welcher Uhrzeit möchten Sie den Termin?' };
      const { st, names } = await voiceServiceType(db, tenant.id, body.service_code);
      if (!st) return { ok: false, result: 'unknown_service', services: names, spoken_summary: `Buchen kann ich: ${names.join(', ')}.` };
      const providers = await providersFor(db, tenant.id);
      const slots = await searchAvailability(db, { tenantId: tenant.id, serviceCode: st.code, date, calendar: providers.calendar });
      const match = slots.find((s) => localTime(s.startsAt, tenant.timezone) === time);
      if (!match) {
        const times = slots.slice(0, 3).map((s) => `${localTime(s.startsAt, tenant.timezone)} Uhr`);
        return {
          ok: false,
          result: 'slot_unavailable',
          spoken_summary: times.length ? `Um ${time} Uhr ist leider nichts frei. An dem Tag ginge noch ${times.join(', ').replace(/, ([^,]*)$/, ' oder $1')}.` : 'An diesem Tag ist leider nichts mehr frei.',
        };
      }
      slotId = match.slotId;
    }

    let customerId = body.customer_id ?? session.customerId;
    if (customerId) {
      const [c] = await db.select({ id: customers.id }).from(customers).where(and(eq(customers.tenantId, tenant.id), eq(customers.id, customerId)));
      if (!c) customerId = null;
    }
    if (!customerId) {
      if (!body.customer_name) return { ok: false, result: 'name_required', spoken_summary: 'Auf welchen Namen darf ich den Termin eintragen?' };
      const [c] = await db
        .insert(customers)
        .values({ id: newId('cus'), tenantId: tenant.id, number: await nextCustomerNumber(db, tenant.id), name: body.customer_name, phone: session.fromNumber })
        .returning();
      customerId = c.id;
      await recordEvent(db, { tenantId: tenant.id, type: 'customer.created', actor: AI, summary: `Neuer Kunde ${c.name} aus Anruf angelegt`, entityType: 'customer', entityId: c.id });
      await db.update(voiceSessions).set({ customerId }).where(eq(voiceSessions.id, session.id));
      if (session.conversationId) await db.update(conversations).set({ customerId, contactName: c.name }).where(eq(conversations.id, session.conversationId));
    }

    const providers = await providersFor(db, tenant.id);
    try {
      const result = await bookSlot(db, {
        tenantId: tenant.id,
        slotId,
        customerId,
        assetId: body.vehicle_id,
        channel: 'Telefon',
        idempotencyKey: body.idempotency_key ?? sha256(`${session.id}:${slotId}`),
        calendar: providers.calendar,
      });
      const apt = result.appointment;
      if (result.created) {
        await recordEvent(db, {
          tenantId: tenant.id,
          type: 'appointment.booked',
          actor: AI,
          summary: `${tenant.aiSettings.name} hat „${apt.title}“ am ${spokenDateTime(apt.startsAt, tenant.timezone)} gebucht`,
          entityType: 'appointment',
          entityId: apt.id,
        });
        await automationHooks.appointmentBooked(db, tenant.id, apt.id, apt.startsAt);
      }
      return {
        ok: true,
        result: 'appointment_booked',
        appointment_id: apt.id,
        starts_at: apt.startsAt.toISOString(),
        confirmation_code: apt.confirmationCode,
        spoken_summary: `Der Termin am ${spokenDateTime(apt.startsAt, tenant.timezone)} ist verbindlich gebucht.`,
      };
    } catch (err) {
      if (err instanceof HttpError && err.code === 'slot_taken') {
        return { ok: false, result: 'slot_taken', spoken_summary: 'Dieser Termin wurde gerade vergeben. Darf ich Ihnen eine andere Zeit vorschlagen?' };
      }
      throw err;
    }
  });

  app.post('/tools/service-request', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(z.object({ session_token: str, call_id: str, fromNumber: str, description: str, title: str }).passthrough(), req.body);
    const session = await voiceSession(app, tenant.id, body.session_token, { callId: body.call_id, fromNumber: body.fromNumber });
    const title = body.title ?? body.description?.slice(0, 80) ?? 'Anfrage aus Anruf';
    const [lead] = await db
      .insert(leads)
      .values({ id: newId('led'), tenantId: tenant.id, customerId: session.customerId, title, stage: 'new', channel: 'Telefon', nextAction: 'Anfrage prüfen und Kunden kontaktieren' })
      .returning();
    await db.insert(tasks).values({
      id: newId('tsk'),
      tenantId: tenant.id,
      title: `Anfrage prüfen: ${title}`,
      priority: 'normal',
      source: 'ai',
      entityType: 'lead',
      entityId: lead.id,
    });
    await recordEvent(db, { tenantId: tenant.id, type: 'lead.created', actor: AI, summary: `Neue Anfrage aus Anruf: ${title}`, entityType: 'lead', entityId: lead.id, data: { description: body.description } });
    return { ok: true, result: 'request_created', request_id: lead.id, spoken_summary: 'Ich habe Ihr Anliegen aufgenommen. Ein Mitarbeiter meldet sich bei Ihnen.' };
  });

  app.post('/tools/callback', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(z.object({ session_token: str, call_id: str, fromNumber: str, reason: str, preferred_time: str }).passthrough(), req.body);
    const session = await voiceSession(app, tenant.id, body.session_token, { callId: body.call_id, fromNumber: body.fromNumber });
    const [task] = await db
      .insert(tasks)
      .values({
        id: newId('tsk'),
        tenantId: tenant.id,
        title: `Rückruf ${session.fromNumber ?? ''}: ${body.reason ?? 'Anliegen klären'}${body.preferred_time ? ` (Wunsch: ${body.preferred_time})` : ''}`,
        priority: 'high',
        source: 'ai',
        dueDate: localDate(new Date(), tenant.timezone),
        entityType: 'conversation',
        entityId: session.conversationId,
      })
      .returning();
    if (session.conversationId) await db.update(conversations).set({ status: 'needs_staff' }).where(eq(conversations.id, session.conversationId));
    await recordEvent(db, { tenantId: tenant.id, type: 'conversation.handoff', actor: AI, summary: `Rückruf angelegt: ${body.reason ?? 'Anliegen klären'}`, entityType: 'task', entityId: task.id });
    return { ok: true, result: 'callback_created', spoken_summary: 'Ich habe einen Rückruf für Sie notiert. Wir melden uns so schnell wie möglich.' };
  });

  app.post('/tools/knowledge/query', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(z.object({ session_token: str, question: str }).passthrough(), req.body);
    if (!body.question) return { ok: false, result: 'question_required' };
    const providers = await providersFor(db, tenant.id);
    const result = await answerQuestion(db, providers.llm, tenant.id, body.question);
    return { ok: true, ...result, spoken_summary: result.answer };
  });

  app.post('/tools/transfer-target', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(z.object({ session_token: str, call_id: str, fromNumber: str, reason: str }).passthrough(), req.body);
    const session = await voiceSession(app, tenant.id, body.session_token, { callId: body.call_id, fromNumber: body.fromNumber });
    if (session.conversationId) await db.update(conversations).set({ status: 'needs_staff' }).where(eq(conversations.id, session.conversationId));
    await recordEvent(db, { tenantId: tenant.id, type: 'conversation.handoff', actor: AI, summary: `Anruf an Team weitergeleitet${body.reason ? `: ${body.reason}` : ''}` });
    return { ok: true, transfer_number: tenant.phone ?? '', spoken_summary: 'Ich verbinde Sie jetzt mit einem Kollegen.' };
  });

  app.post('/fonio/post-call', async (req) => {
    const tenant = await tenantFromKey(app, req);
    const body = parse(
      z
        .object({
          session_token: str,
          outcome: str,
          intent: str,
          appointment_id: str,
          customer_name_extracted: str,
          vehicle_plate_extracted: str,
          callback_required: bool,
          summary: str,
          duration_sec: z.coerce.number().int().min(0).optional().nullable(),
          call_id: str,
          transcript: z
            .union([z.string(), z.array(z.object({ speaker: z.string(), text: z.string() }))])
            .optional()
            .nullable(),
        })
        .passthrough(),
      req.body,
    );
    // Post-call may arrive after the session expired, so look it up without the expiry check.
    let [session] = body.session_token
      ? await db.select().from(voiceSessions).where(and(eq(voiceSessions.id, sha256(body.session_token)), eq(voiceSessions.tenantId, tenant.id)))
      : [];
    if (!session && body.call_id) {
      [session] = await db.select().from(voiceSessions).where(eq(voiceSessions.id, callSessionId(tenant.id, body.call_id)));
    }
    if (!session) {
      // fonio doesn't always hand the inbound variables on to the post-call request. Then the
      // call belongs to the newest recent session without a call record, preferring the caller's number.
      const from = (body as Record<string, unknown>).fromNumber ?? (body as Record<string, unknown>).from_number;
      const candidates = await db
        .select({ session: voiceSessions })
        .from(voiceSessions)
        .leftJoin(calls, eq(calls.conversationId, voiceSessions.conversationId))
        .where(and(eq(voiceSessions.tenantId, tenant.id), isNull(calls.id), gt(voiceSessions.createdAt, addMinutes(new Date(), -POST_CALL_FALLBACK_MINUTES))))
        .orderBy(desc(voiceSessions.createdAt))
        .limit(20);
      const key = typeof from === 'string' && phoneKey(from).length >= 6 ? phoneKey(from) : null;
      session = (key && candidates.find((c) => c.session.fromNumber && phoneKey(c.session.fromNumber) === key)?.session) || candidates[0]?.session;
      if (session) (req as FastifyRequest & { voiceNote?: string }).voiceNote = 'Ohne gültiges session_token dem letzten offenen Anruf zugeordnet.';
      else {
        // No inbound webhook ran for this call (e.g. a browser test call), so the report opens its own conversation.
        const fromNumber = typeof from === 'string' && from.trim() ? from.trim() : null;
        const [conv] = await db
          .insert(conversations)
          .values({ id: newId('conv'), tenantId: tenant.id, channel: 'phone', status: 'ai_handling', contactAddress: fromNumber, subject: 'Anruf' })
          .returning();
        [session] = await db
          .insert(voiceSessions)
          .values({ id: sha256(`sess_${newToken()}`), tenantId: tenant.id, conversationId: conv.id, fromNumber, expiresAt: new Date() })
          .returning();
        (req as FastifyRequest & { voiceNote?: string }).voiceNote = 'Kein Anrufbeginn gemeldet, neues Gespräch angelegt.';
      }
    }
    if (!session.conversationId) throw new HttpError(404, 'not_found', 'Gespräch nicht gefunden.');

    const transcript = Array.isArray(body.transcript)
      ? body.transcript.map((l) => ({ speaker: (/kunde|customer|user/i.test(l.speaker) ? 'customer' : 'ai') as 'customer' | 'ai', text: l.text }))
      : typeof body.transcript === 'string'
        ? body.transcript
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [who, ...rest] = line.split(':');
              const isCustomer = /kunde|customer|user|anrufer/i.test(who);
              return { speaker: (isCustomer ? 'customer' : 'ai') as 'customer' | 'ai', text: rest.join(':').trim() || line };
            })
        : [];

    const missed = /missed|verpasst|no_answer/i.test(body.outcome ?? '');
    const actions: string[] = [];
    if (session.customerId) actions.push('Kontakt erkannt');
    if (body.appointment_id) actions.push('Termin gebucht');
    if (body.callback_required) actions.push('Rückruf angelegt');

    await db.insert(calls).values({
      id: newId('call'),
      tenantId: tenant.id,
      conversationId: session.conversationId,
      fromNumber: session.fromNumber,
      startedAt: session.createdAt,
      durationSec: body.duration_sec ?? secondsSince((body as Record<string, unknown>).started_at),
      outcome: body.outcome,
      intent: body.intent,
      summary: body.summary,
      transcript,
      actions,
      providerCallId: body.call_id,
    });
    for (const line of transcript) {
      await db.insert(messages).values({
        id: newId('msg'),
        tenantId: tenant.id,
        conversationId: session.conversationId,
        direction: line.speaker === 'customer' ? 'inbound' : 'outbound',
        author: line.speaker,
        text: line.text,
      });
    }
    const status = missed ? 'missed' : body.callback_required ? 'needs_staff' : 'closed';
    await db
      .update(conversations)
      .set({ status, summary: body.summary, subject: body.intent ?? 'Anruf', lastMessageAt: new Date() })
      .where(eq(conversations.id, session.conversationId));

    if (missed) {
      await recordEvent(db, { tenantId: tenant.id, type: 'call.missed', actor: { type: 'provider', name: 'fonio' }, summary: `Verpasster Anruf von ${session.fromNumber ?? 'unbekannt'}`, entityType: 'conversation', entityId: session.conversationId });
      await automationHooks.missedCall(db, tenant.id, session.conversationId);
    } else {
      await recordEvent(db, {
        tenantId: tenant.id,
        type: 'call.handled',
        actor: AI,
        summary: `${tenant.aiSettings.name} hat einen Anruf bearbeitet${body.intent ? `: ${body.intent}` : ''}`,
        entityType: 'conversation',
        entityId: session.conversationId,
      });
    }
    const [existingCallback] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenant.id), eq(tasks.entityId, session.conversationId), eq(tasks.source, 'ai')));
    if (body.callback_required && !existingCallback) {
      await db.insert(tasks).values({
        id: newId('tsk'),
        tenantId: tenant.id,
        title: `Rückruf nach Anruf: ${body.intent ?? body.summary?.slice(0, 60) ?? 'Anliegen klären'}`,
        priority: 'high',
        source: 'ai',
        dueDate: localDate(new Date(), tenant.timezone),
        entityType: 'conversation',
        entityId: session.conversationId,
      });
    }
    return { ok: true };
  });
}
