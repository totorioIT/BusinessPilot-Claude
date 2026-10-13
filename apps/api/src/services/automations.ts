import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client.js';
import {
  appointments,
  automations,
  communicationConsents,
  conversations,
  customers,
  jobs,
  messages,
  quotes,
  reviewRequests,
  tasks,
  tenants,
} from '../db/schema.js';
import { recordEvent } from '../lib/events.js';
import { newId } from '../lib/ids.js';
import { addMinutes, spokenDateTime } from '../lib/time.js';
import { providersFor } from '../providers/registry.js';

// Campaign/automation core from the blueprint: domain events schedule durable jobs here,
// consent is checked before anything is sent, and results are written back as events.

async function enabledAutomation(db: DbOrTx, tenantId: string, key: string) {
  const [a] = await db
    .select()
    .from(automations)
    .where(and(eq(automations.tenantId, tenantId), eq(automations.templateKey, key), eq(automations.enabled, true)));
  return a ?? null;
}

async function schedule(db: DbOrTx, tenantId: string, type: string, runAt: Date, payload: Record<string, unknown>, dedupeKey: string) {
  await db
    .insert(jobs)
    .values({ id: newId('job'), tenantId, type, runAt, payload, dedupeKey })
    .onConflictDoNothing({ target: [jobs.tenantId, jobs.dedupeKey] });
}

async function cancelJobs(db: DbOrTx, tenantId: string, dedupeKeys: string[]) {
  await db
    .update(jobs)
    .set({ status: 'cancelled' })
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.status, 'pending'), inArray(jobs.dedupeKey, dedupeKeys)));
}

export const automationHooks = {
  async missedCall(db: DbOrTx, tenantId: string, conversationId: string) {
    if (!(await enabledAutomation(db, tenantId, 'missed_call'))) return;
    await schedule(db, tenantId, 'missed_call', addMinutes(new Date(), 2), { conversationId }, `missed_call:${conversationId}`);
  },

  async appointmentBooked(db: DbOrTx, tenantId: string, appointmentId: string, startsAt: Date) {
    if (!(await enabledAutomation(db, tenantId, 'appointment_reminder'))) return;
    const runAt = addMinutes(startsAt, -1440);
    if (runAt.getTime() < Date.now()) return; // booked for tomorrow or sooner: the confirmation is enough
    await schedule(db, tenantId, 'appointment_reminder', runAt, { appointmentId }, `reminder:${appointmentId}`);
  },

  async appointmentCancelled(db: DbOrTx, tenantId: string, appointmentId: string) {
    await cancelJobs(db, tenantId, [`reminder:${appointmentId}`, `review:${appointmentId}`]);
  },

  async appointmentCompleted(db: DbOrTx, tenantId: string, appointmentId: string) {
    if (!(await enabledAutomation(db, tenantId, 'review_request'))) return;
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
    if (!apt?.customerId) return;
    const runAt = addMinutes(new Date(), 120);
    await db.insert(reviewRequests).values({
      id: newId('rr'),
      tenantId,
      customerId: apt.customerId,
      appointmentId,
      channel: 'whatsapp',
      status: 'planned',
      scheduledFor: runAt,
    });
    await schedule(db, tenantId, 'review_request', runAt, { appointmentId }, `review:${appointmentId}`);
  },

  async quoteSent(db: DbOrTx, tenantId: string, quoteId: string) {
    if (!(await enabledAutomation(db, tenantId, 'quote_followup'))) return;
    await schedule(db, tenantId, 'quote_followup', addMinutes(new Date(), 4320), { quoteId }, `quote_followup:${quoteId}`);
  },
};

type Channel = { kind: 'whatsapp'; to: string } | { kind: 'email'; to: string };

/** WhatsApp needs an opt-in; otherwise fall back to email. Marketing purposes need explicit consent. */
async function pickChannel(db: DbOrTx, tenantId: string, customerId: string, purpose: 'service' | 'marketing'): Promise<Channel | null> {
  const [customer] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (!customer) return null;
  const consents = await db
    .select()
    .from(communicationConsents)
    .where(and(eq(communicationConsents.tenantId, tenantId), eq(communicationConsents.customerId, customerId), eq(communicationConsents.status, 'granted')));
  const has = (channel: string) => consents.some((c) => c.channel === channel && (purpose === 'service' || c.purpose === 'marketing'));
  if (customer.phone && has('whatsapp')) return { kind: 'whatsapp', to: customer.phone };
  if (customer.email && (purpose === 'service' || has('email'))) return { kind: 'email', to: customer.email };
  return null;
}

async function whatsappConversation(db: DbOrTx, tenantId: string, customerId: string, name: string, phone: string) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenantId, tenantId), eq(conversations.customerId, customerId), eq(conversations.channel, 'whatsapp')))
    .orderBy(sql`${conversations.lastMessageAt} desc`)
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(conversations)
    .values({ id: newId('conv'), tenantId, customerId, channel: 'whatsapp', status: 'closed', contactName: name, contactAddress: phone })
    .returning();
  return created;
}

/** Sends an automated message to a customer and records it in the inbox and the event log. */
export async function sendToCustomer(
  db: Db,
  opts: { tenantId: string; customerId: string; purpose: 'service' | 'marketing'; text: string; subject: string; eventType: string; eventSummary: string },
): Promise<{ ok: boolean; reason?: string }> {
  const channel = await pickChannel(db, opts.tenantId, opts.customerId, opts.purpose);
  if (!channel) return { ok: false, reason: 'Keine Einwilligung oder Kontaktdaten für den Versand.' };
  const providers = await providersFor(db, opts.tenantId);
  const [customer] = await db.select().from(customers).where(eq(customers.id, opts.customerId));

  if (channel.kind === 'whatsapp') {
    const res = await providers.messaging.sendText({ to: channel.to, text: opts.text });
    if (!res.ok) return { ok: false, reason: res.error };
    const conv = await whatsappConversation(db, opts.tenantId, opts.customerId, customer.name, channel.to);
    await db.insert(messages).values({
      id: newId('msg'),
      tenantId: opts.tenantId,
      conversationId: conv.id,
      direction: 'outbound',
      author: 'ai',
      text: opts.text,
      providerMessageId: res.providerMessageId,
      deliveryStatus: 'sent',
    });
    await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conv.id));
  } else {
    const res = await providers.email.send({ to: channel.to, subject: opts.subject, text: opts.text });
    if (!res.ok) return { ok: false, reason: res.error };
  }
  await recordEvent(db, {
    tenantId: opts.tenantId,
    type: opts.eventType,
    actor: { type: 'ai' },
    summary: opts.eventSummary,
    entityType: 'customer',
    entityId: opts.customerId,
    data: { channel: channel.kind },
  });
  return { ok: true };
}

type Job = typeof jobs.$inferSelect;

async function bumpRunCount(db: DbOrTx, tenantId: string, key: string) {
  await db
    .update(automations)
    .set({ runCount: sql`${automations.runCount} + 1` })
    .where(and(eq(automations.tenantId, tenantId), eq(automations.templateKey, key)));
}

const handlers: Record<string, (db: Db, job: Job) => Promise<void>> = {
  async missed_call(db, job) {
    const [conv] = await db.select().from(conversations).where(eq(conversations.id, String(job.payload.conversationId)));
    if (!conv) return;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, job.tenantId));
    if (conv.customerId) {
      await sendToCustomer(db, {
        tenantId: job.tenantId,
        customerId: conv.customerId,
        purpose: 'service',
        subject: `Ihr Anruf bei ${tenant.name}`,
        text: `Hallo, hier ist ${tenant.aiSettings.name} von ${tenant.name}. Wir haben Ihren Anruf leider verpasst. Wie können wir Ihnen helfen?`,
        eventType: 'message.ai_sent',
        eventSummary: 'Nachricht nach verpasstem Anruf gesendet',
      });
    }
    await db.insert(tasks).values({
      id: newId('tsk'),
      tenantId: job.tenantId,
      title: `Rückruf: verpasster Anruf ${conv.contactName ?? conv.contactAddress ?? ''}`.trim(),
      priority: 'high',
      source: 'automation',
      entityType: 'conversation',
      entityId: conv.id,
    });
    await bumpRunCount(db, job.tenantId, 'missed_call');
  },

  async appointment_reminder(db, job) {
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, String(job.payload.appointmentId)));
    if (!apt || !apt.customerId || apt.status === 'cancelled') return;
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, job.tenantId));
    const when = spokenDateTime(apt.startsAt, tenant.timezone);
    await sendToCustomer(db, {
      tenantId: job.tenantId,
      customerId: apt.customerId,
      purpose: 'service',
      subject: `Terminerinnerung ${tenant.name}`,
      text: `Erinnerung: Ihr Termin „${apt.title}“ bei ${tenant.name} ist am ${when}. Falls Sie nicht kommen können, antworten Sie einfach auf diese Nachricht.`,
      eventType: 'appointment.reminder_sent',
      eventSummary: `Terminerinnerung gesendet: ${apt.title}`,
    });
    await bumpRunCount(db, job.tenantId, 'appointment_reminder');
  },

  async review_request(db, job) {
    const appointmentId = String(job.payload.appointmentId);
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, job.tenantId));
    const [rr] = await db
      .select()
      .from(reviewRequests)
      .where(and(eq(reviewRequests.tenantId, job.tenantId), eq(reviewRequests.appointmentId, appointmentId)));
    if (!apt?.customerId || !rr) return;
    if (!tenant.googleReviewUrl) {
      await db.update(reviewRequests).set({ status: 'failed' }).where(eq(reviewRequests.id, rr.id));
      return;
    }
    const res = await sendToCustomer(db, {
      tenantId: job.tenantId,
      customerId: apt.customerId,
      purpose: 'service',
      subject: `Vielen Dank für Ihren Besuch bei ${tenant.name}`,
      text: `Vielen Dank für Ihren Besuch bei ${tenant.name}! Wir freuen uns über Ihre ehrliche Bewertung: ${tenant.googleReviewUrl}\nWenn etwas nicht gepasst hat, antworten Sie gern direkt hier, dann kümmern wir uns sofort.`,
      eventType: 'review.requested',
      eventSummary: 'Bewertungsanfrage gesendet',
    });
    await db
      .update(reviewRequests)
      .set(res.ok ? { status: 'sent', sentAt: new Date() } : { status: 'failed' })
      .where(eq(reviewRequests.id, rr.id));
    if (res.ok) await bumpRunCount(db, job.tenantId, 'review_request');
  },

  async quote_followup(db, job) {
    const [quote] = await db.select().from(quotes).where(eq(quotes.id, String(job.payload.quoteId)));
    if (!quote || quote.status !== 'sent' || !quote.customerId) return;
    await sendToCustomer(db, {
      tenantId: job.tenantId,
      customerId: quote.customerId,
      purpose: 'service',
      subject: `Ihr Angebot ${quote.number}`,
      text: `Guten Tag, haben Sie unser Angebot ${quote.number} („${quote.title}“) erhalten? Bei Fragen helfen wir gern weiter.`,
      eventType: 'quote.followed_up',
      eventSummary: `Angebot ${quote.number} nachgefasst`,
    });
    await db.insert(tasks).values({
      id: newId('tsk'),
      tenantId: job.tenantId,
      title: `Angebot ${quote.number} telefonisch nachfassen`,
      priority: 'normal',
      source: 'automation',
      entityType: 'quote',
      entityId: quote.id,
      dueDate: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    });
    await bumpRunCount(db, job.tenantId, 'quote_followup');
  },
};

/** Runs due jobs once. Safe to call from several processes thanks to SKIP LOCKED. */
export async function runDueJobs(db: Db, now = new Date(), batch = 20): Promise<number> {
  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt))
      .limit(batch)
      .for('update', { skipLocked: true });
    if (due.length === 0) return [];
    await tx
      .update(jobs)
      .set({ status: 'running', attempts: sql`${jobs.attempts} + 1` })
      .where(inArray(jobs.id, due.map((j) => j.id)));
    return due;
  });

  for (const job of claimed) {
    try {
      const handler = handlers[job.type];
      if (!handler) throw new Error(`Unbekannter Job-Typ ${job.type}`);
      await handler(db, job);
      await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id));
    } catch (err) {
      const retry = job.attempts + 1 < 5;
      await db
        .update(jobs)
        .set({
          status: retry ? 'pending' : 'failed',
          runAt: addMinutes(new Date(), 5 * (job.attempts + 1)),
          lastError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(jobs.id, job.id));
    }
  }
  return claimed.length;
}

export function startJobRunner(db: Db, log: (msg: string, err?: unknown) => void, intervalMs = 15000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runDueJobs(db);
    } catch (err) {
      log('Job-Runner fehlgeschlagen', err);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
