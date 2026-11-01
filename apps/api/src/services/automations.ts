import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client.js';
import {
  appointments,
  automations,
  campaigns,
  communicationConsents,
  conversations,
  customers,
  jobs,
  messages,
  quotes,
  reviewRequests,
  serviceTypes,
  tasks,
  tenants,
} from '../db/schema.js';
import { canSignLinks, signLink } from '../lib/signed-links.js';
import { searchAvailability } from './scheduling.js';
import { recordEvent } from '../lib/events.js';
import { newId } from '../lib/ids.js';
import { addMinutes, localDate, spokenDateTime } from '../lib/time.js';
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
    await cancelJobs(db, tenantId, [`reminder:${appointmentId}`, `review:${appointmentId}`, `rebook:${appointmentId}`]);
  },

  async appointmentCompleted(db: DbOrTx, tenantId: string, appointmentId: string) {
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, appointmentId));
    if (!apt?.customerId) return;
    if (await enabledAutomation(db, tenantId, 'review_request')) {
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
    }
    // Rebooking: invite the customer again once the service is due (e.g. tyres after 6 months).
    if (apt.serviceTypeId && (await enabledAutomation(db, tenantId, 'rebooking'))) {
      const [st] = await db.select().from(serviceTypes).where(eq(serviceTypes.id, apt.serviceTypeId));
      if (st?.rebookAfterDays) {
        await schedule(db, tenantId, 'rebooking', addMinutes(new Date(), st.rebookAfterDays * 1440), { appointmentId }, `rebook:${appointmentId}`);
      }
    }
  },

  async quoteSent(db: DbOrTx, tenantId: string, quoteId: string) {
    if (!(await enabledAutomation(db, tenantId, 'quote_followup'))) return;
    await schedule(db, tenantId, 'quote_followup', addMinutes(new Date(), 4320), { quoteId }, `quote_followup:${quoteId}`);
  },
};

type Channel = { kind: 'whatsapp'; to: string } | { kind: 'email'; to: string };

/**
 * Service messages: WhatsApp needs an opt-in, otherwise email. Marketing (offers, news,
 * rebooking) goes by email only and only with the customer's marketing consent for email:
 * WhatsApp allows promotional messages outside a running chat only through templates
 * approved by Meta, which are not set up yet.
 */
async function pickChannel(db: DbOrTx, tenantId: string, customerId: string, purpose: 'service' | 'marketing'): Promise<Channel | null> {
  const [customer] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, customerId)));
  if (!customer) return null;
  const consents = await db
    .select()
    .from(communicationConsents)
    .where(and(eq(communicationConsents.tenantId, tenantId), eq(communicationConsents.customerId, customerId), eq(communicationConsents.status, 'granted')));
  if (purpose === 'marketing') {
    const emailOk = consents.some((c) => c.channel === 'email' && c.purpose === 'marketing');
    return customer.email && emailOk ? { kind: 'email', to: customer.email } : null;
  }
  if (customer.phone && consents.some((c) => c.channel === 'whatsapp')) return { kind: 'whatsapp', to: customer.phone };
  if (customer.email) return { kind: 'email', to: customer.email };
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
  // Every marketing mail must offer a working unsubscribe link; without APP_SECRET we can't sign one.
  if (opts.purpose === 'marketing' && !canSignLinks()) return { ok: false, reason: 'Auf dem Server fehlt APP_SECRET für den Abmeldelink.' };
  const providers = await providersFor(db, opts.tenantId);
  const [customer] = await db.select().from(customers).where(eq(customers.id, opts.customerId));
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, opts.tenantId));

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
    let text = opts.text;
    let headers: Record<string, string> | undefined;
    if (opts.purpose === 'marketing') {
      const url = `${publicUrl()}/api/public/unsubscribe?t=${signLink({ p: 'unsubscribe', t: opts.tenantId, c: opts.customerId, ch: 'email' })}`;
      text += `\n\n--\n${tenant.name}${tenant.address ? `, ${tenant.address}` : ''}\nSie erhalten diese E-Mail, weil Sie Neuigkeiten von uns zugestimmt haben. Abmelden mit einem Klick: ${url}`;
      // RFC 8058 one-click unsubscribe, required by Gmail and Yahoo for bulk senders.
      headers = { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    }
    const res = await providers.email.send({ to: channel.to, subject: opts.subject, text, fromName: tenant.name, replyTo: tenant.email ?? undefined, headers });
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

let configuredPublicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3001';
/** Set by the app at start so links in emails point to this server. */
export function setPublicUrl(url: string) {
  configuredPublicUrl = url.replace(/\/$/, '');
}
const publicUrl = () => configuredPublicUrl;

type Job = typeof jobs.$inferSelect;

async function bumpRunCount(db: DbOrTx, tenantId: string, key: string) {
  await db
    .update(automations)
    .set({ runCount: sql`${automations.runCount} + 1` })
    .where(and(eq(automations.tenantId, tenantId), eq(automations.templateKey, key)));
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Up to `count` free slots on different days within the next two weeks. */
async function suggestSlots(db: Db, tenantId: string, serviceCode: string, timezone: string, count = 2) {
  const providers = await providersFor(db, tenantId);
  const found: Date[] = [];
  for (let d = 1; d <= 14 && found.length < count; d++) {
    const date = localDate(addMinutes(new Date(), d * 1440), timezone);
    const slots = await searchAvailability(db, { tenantId, serviceCode, date, calendar: providers.calendar, limit: 1 }).catch(() => []);
    if (slots[0]) found.push(slots[0].startsAt);
  }
  return found;
}

export function fillPlaceholders(text: string, customer: { name: string }) {
  return text.replaceAll('{{vorname}}', firstName(customer.name)).replaceAll('{{name}}', customer.name);
}

const handlers: Record<string, (db: Db, job: Job) => Promise<void>> = {
  async rebooking(db, job) {
    const [apt] = await db.select().from(appointments).where(eq(appointments.id, String(job.payload.appointmentId)));
    if (!apt?.customerId || !apt.serviceTypeId || apt.status !== 'completed') return;
    // Skip when the customer already has the next visit planned.
    const [upcoming] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, job.tenantId),
          eq(appointments.customerId, apt.customerId),
          inArray(appointments.status, ['booked', 'confirmed']),
          sql`${appointments.startsAt} > now()`,
        ),
      )
      .limit(1);
    if (upcoming) return;
    const [st] = await db.select().from(serviceTypes).where(eq(serviceTypes.id, apt.serviceTypeId));
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, job.tenantId));
    const [customer] = await db.select().from(customers).where(eq(customers.id, apt.customerId));
    if (!st || !customer) return;
    const slots = await suggestSlots(db, job.tenantId, st.code, tenant.timezone);
    const last = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: tenant.timezone }).format(apt.startsAt);
    const offer = slots.length
      ? ` Freie Termine hätten wir zum Beispiel am ${slots.map((d) => spokenDateTime(d, tenant.timezone)).join(' oder am ')}.`
      : '';
    const contact = tenant.phone ? ` oder rufen Sie uns an: ${tenant.phone}` : '';
    const res = await sendToCustomer(db, {
      tenantId: job.tenantId,
      customerId: apt.customerId,
      purpose: 'marketing',
      subject: `Zeit für Ihren nächsten Termin: ${st.name}`,
      text: `Hallo ${firstName(customer.name)},\n\nIhr letzter Termin „${st.name}“ bei ${tenant.name} war am ${last}. Es ist bald wieder so weit.${offer}\n\nAntworten Sie einfach auf diese E-Mail${contact}, dann tragen wir Sie ein.\n\nViele Grüße\n${tenant.name}`,
      eventType: 'rebooking.sent',
      eventSummary: `Wiederbuchung angeboten: ${st.name} an ${customer.name}`,
    });
    if (res.ok) await bumpRunCount(db, job.tenantId, 'rebooking');
  },

  async campaign_send(db, job) {
    const campaignId = String(job.payload.campaignId);
    const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.tenantId, job.tenantId), eq(campaigns.id, campaignId)));
    const [customer] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, job.tenantId), eq(customers.id, String(job.payload.customerId))));
    if (!campaign) return;
    // Consent is checked again at send time: a customer may have unsubscribed in the meantime.
    const res = customer
      ? await sendToCustomer(db, {
          tenantId: job.tenantId,
          customerId: customer.id,
          purpose: 'marketing',
          subject: fillPlaceholders(campaign.subject, customer),
          text: fillPlaceholders(campaign.body, customer),
          eventType: 'campaign.message_sent',
          eventSummary: `Aktion „${campaign.title}“ an ${customer.name} gesendet`,
        })
      : { ok: false };
    const [updated] = await db
      .update(campaigns)
      .set(res.ok ? { sentCount: sql`${campaigns.sentCount} + 1` } : { failedCount: sql`${campaigns.failedCount} + 1` })
      .where(eq(campaigns.id, campaign.id))
      .returning();
    if (updated.status === 'sending' && updated.sentCount + updated.failedCount >= updated.recipientCount) {
      await db.update(campaigns).set({ status: 'sent', sentAt: new Date() }).where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, 'sending')));
      await recordEvent(db, {
        tenantId: job.tenantId,
        type: 'campaign.sent',
        actor: { type: 'system' },
        summary: `Aktion „${campaign.title}“ versendet: ${updated.sentCount} zugestellt${updated.failedCount ? `, ${updated.failedCount} nicht möglich` : ''}`,
        entityType: 'campaign',
        entityId: campaign.id,
      });
    }
  },

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
