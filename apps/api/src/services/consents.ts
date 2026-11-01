import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { communicationConsents } from '../db/schema.js';
import { recordEvent, type Actor } from '../lib/events.js';
import { newId } from '../lib/ids.js';

// Marketing consent per customer and channel (UWG §7, DSGVO Art. 6/7). Offers, news and
// rebooking reminders only go to customers whose consent is "granted". Every change is written
// to the event log so the business can show when and how a customer agreed or objected.

export type ConsentChannel = 'email' | 'whatsapp';
export const CONSENT_CHANNELS: ConsentChannel[] = ['email', 'whatsapp'];
const CHANNEL_LABEL: Record<ConsentChannel, string> = { email: 'E-Mail', whatsapp: 'WhatsApp' };

export async function marketingConsents(db: DbOrTx, tenantId: string, customerId: string) {
  const rows = await db
    .select()
    .from(communicationConsents)
    .where(and(eq(communicationConsents.tenantId, tenantId), eq(communicationConsents.customerId, customerId), eq(communicationConsents.purpose, 'marketing')));
  return CONSENT_CHANNELS.map((channel) => {
    const r = rows.find((x) => x.channel === channel);
    return {
      channel,
      status: (r?.status ?? 'none') as 'granted' | 'revoked' | 'pending' | 'none',
      source: r?.source ?? null,
      grantedAt: r?.grantedAt ?? null,
      revokedAt: r?.revokedAt ?? null,
      updatedAt: r?.updatedAt ?? null,
    };
  });
}

export async function setMarketingConsent(
  db: DbOrTx,
  opts: { tenantId: string; customerId: string; channel: ConsentChannel; status: 'granted' | 'revoked' | 'pending'; source: string; actor: Actor },
) {
  const now = new Date();
  const times =
    opts.status === 'granted' ? { grantedAt: now, revokedAt: null } : opts.status === 'revoked' ? { revokedAt: now } : { grantedAt: null, revokedAt: null };
  await db
    .insert(communicationConsents)
    .values({ id: newId('con'), tenantId: opts.tenantId, customerId: opts.customerId, channel: opts.channel, purpose: 'marketing', status: opts.status, source: opts.source, ...times, updatedAt: now })
    .onConflictDoUpdate({
      target: [communicationConsents.tenantId, communicationConsents.customerId, communicationConsents.channel, communicationConsents.purpose],
      set: { status: opts.status, source: opts.source, ...times, updatedAt: now },
    });
  const label = CHANNEL_LABEL[opts.channel];
  const summary =
    opts.status === 'granted'
      ? `Werbe-Einwilligung ${label} erteilt (${opts.source})`
      : opts.status === 'revoked'
        ? `Werbe-Einwilligung ${label} widerrufen (${opts.source})`
        : `Bestätigungs-E-Mail für Werbe-Einwilligung gesendet`;
  await recordEvent(db, {
    tenantId: opts.tenantId,
    type: `consent.${opts.status}`,
    actor: opts.actor,
    summary,
    entityType: 'customer',
    entityId: opts.customerId,
    data: { channel: opts.channel, source: opts.source },
  });
}

/** "STOP" and its usual German variants, as the whole message. */
export function isStopMessage(text: string): boolean {
  return /^\s*(stop|stopp|abmelden|abbestellen|keine werbung)[\s.!]*$/i.test(text);
}
