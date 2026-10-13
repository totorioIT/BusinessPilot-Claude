import { and, count, eq, gte, inArray, ne } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { appointments, automations, conversations, events, leads, quotes, reviewRequests, tenants } from '../db/schema.js';
import { isoWeek } from '../lib/time.js';

// ROI from one set of AI events, so every tile, chart and sentence uses the same numbers.

export const ROI_GROUPS = [
  { key: 'calls', label: 'Anrufe beantwortet', types: ['call.handled'], minutes: 5 },
  { key: 'messages', label: 'WhatsApp-Nachrichten', types: ['message.ai_replied', 'message.ai_sent'], minutes: 3 },
  { key: 'appointments', label: 'Termine gebucht', types: ['appointment.booked'], minutes: 5 },
  { key: 'reminders', label: 'Erinnerungen gesendet', types: ['appointment.reminder_sent'], minutes: 2 },
  { key: 'leads', label: 'Leads erfasst', types: ['lead.created'], minutes: 4 },
  { key: 'quotes', label: 'Angebote vorbereitet', types: ['quote.prepared', 'quote.followed_up'], minutes: 10 },
  { key: 'reviews', label: 'Bewertungen angefragt', types: ['review.requested'], minutes: 2 },
] as const;

/** Assumed cost of one staff hour, used for the estimated value. */
export const HOURLY_RATE_CENTS = 3500;

const since = (days: number) => new Date(Date.now() - days * 86400000);

function hoursText(minutes: number) {
  const hours = Math.round((minutes / 60) * 10) / 10;
  const formatted = hours.toLocaleString('de-DE');
  return `${formatted} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
}

export async function analytics(db: DbOrTx, tenantId: string, days: number) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const allTypes = ROI_GROUPS.flatMap((g) => g.types as readonly string[]);
  const rows = await db
    .select({ type: events.type, createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.actorType, 'ai'), gte(events.createdAt, since(days)), inArray(events.type, allTypes)));

  const byChannel = ROI_GROUPS.map((g) => {
    const c = rows.filter((r) => (g.types as readonly string[]).includes(r.type)).length;
    return { key: g.key, label: g.label, count: c, minutes: c * g.minutes };
  });
  const interactions = rows.length;
  const minutesSaved = byChannel.reduce((s, g) => s + g.minutes, 0);
  const valueCents = Math.round((minutesSaved / 60) * HOURLY_RATE_CENTS);

  // Every calendar week touched by the period, oldest first, so the weekly bars add up to the total.
  const weeks = new Map<number, number>();
  const now = new Date();
  for (let d = days; d >= 0; d--) {
    const w = isoWeek(new Date(now.getTime() - d * 86400000), tenant.timezone);
    if (!weeks.has(w)) weeks.set(w, 0);
  }
  for (const r of rows) {
    const w = isoWeek(r.createdAt, tenant.timezone);
    if (weeks.has(w)) weeks.set(w, weeks.get(w)! + 1);
  }
  const weekly = [...weeks.entries()].map(([w, n]) => ({ week: `KW ${w}`, interactions: n }));

  const valueText = (valueCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  const summary =
    interactions === 0
      ? `In den letzten ${days} Tagen hat ${tenant.aiSettings.name} noch keine Kundeninteraktionen bearbeitet.`
      : `${tenant.aiSettings.name} hat in den letzten ${days} Tagen ${interactions} Kundeninteraktionen bearbeitet und dabei geschätzt ${hoursText(minutesSaved)} Arbeitszeit gespart. Das entspricht rund ${valueText}.`;

  return { interactions, minutesSaved, valueCents, hourlyRateCents: HOURLY_RATE_CENTS, byChannel, weekly, summary };
}

export async function dashboardKpis(db: DbOrTx, tenantId: string, days: number) {
  const from = since(days);
  const c = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const [calls, whatsappChats, appointmentsBooked, leadsCreated, activeAutomations, quotesInitiated, reviewsSent, handoffs] = await Promise.all([
    c(db.select({ n: count() }).from(conversations).where(and(eq(conversations.tenantId, tenantId), eq(conversations.channel, 'phone'), ne(conversations.status, 'missed'), gte(conversations.createdAt, from)))),
    c(db.select({ n: count() }).from(conversations).where(and(eq(conversations.tenantId, tenantId), eq(conversations.channel, 'whatsapp'), gte(conversations.createdAt, from)))),
    c(db.select({ n: count() }).from(appointments).where(and(eq(appointments.tenantId, tenantId), gte(appointments.createdAt, from)))),
    c(db.select({ n: count() }).from(leads).where(and(eq(leads.tenantId, tenantId), gte(leads.createdAt, from)))),
    c(db.select({ n: count() }).from(automations).where(and(eq(automations.tenantId, tenantId), eq(automations.enabled, true)))),
    c(db.select({ n: count() }).from(quotes).where(and(eq(quotes.tenantId, tenantId), gte(quotes.createdAt, from)))),
    c(db.select({ n: count() }).from(reviewRequests).where(and(eq(reviewRequests.tenantId, tenantId), eq(reviewRequests.status, 'sent'), gte(reviewRequests.createdAt, from)))),
    c(db.select({ n: count() }).from(events).where(and(eq(events.tenantId, tenantId), eq(events.type, 'conversation.handoff'), gte(events.createdAt, from)))),
  ]);
  return { calls, whatsappChats, appointmentsBooked, leadsCreated, activeAutomations, quotesInitiated, reviewRequests: reviewsSent, handoffs };
}
