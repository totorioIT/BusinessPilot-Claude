import { and, desc, eq, ne, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { conversations, customers, messages, tenants } from '../db/schema.js';
import { recordEvent } from '../lib/events.js';
import { newId } from '../lib/ids.js';
import type { IncomingWhatsApp, WhatsAppStatus } from '../providers/dialog360.js';
import { providersFor } from '../providers/registry.js';
import { answerQuestion } from './knowledge.js';

// Incoming WhatsApp messages: stored in the inbox first (fast, so the provider gets its 200 in
// time), then answered by the AI according to the tenant's autonomy setting.

/** In "Halbautomatisch" the AI only answers when the knowledge base clearly covers the question. */
export const SEMI_MIN_CONFIDENCE = 0.5;
export const HOLDING_REPLY = 'Vielen Dank für Ihre Nachricht. Ein Mitarbeiter meldet sich so schnell wie möglich bei Ihnen.';

const digitsKey = (phone: string) => phone.replace(/\D/g, '').slice(-9);

/** Stores one incoming message; returns the conversation id, or null when it was a duplicate delivery. */
export async function storeIncomingWhatsApp(db: DbOrTx, tenantId: string, msg: IncomingWhatsApp): Promise<string | null> {
  const [dupe] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.providerMessageId, msg.id)));
  if (dupe) return null;

  const address = /^\d+$/.test(msg.from) ? `+${msg.from}` : msg.from;
  const key = digitsKey(address);
  const [customer] =
    key.length >= 6
      ? await db
          .select()
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), sql`right(regexp_replace(coalesce(${customers.phone}, ''), '\\D', '', 'g'), 9) = ${key}`))
          .limit(1)
      : [];

  let [conv] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        eq(conversations.channel, 'whatsapp'),
        ne(conversations.status, 'closed'),
        sql`right(regexp_replace(coalesce(${conversations.contactAddress}, ''), '\\D', '', 'g'), 9) = ${key}`,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  if (!conv) {
    [conv] = await db
      .insert(conversations)
      .values({
        id: newId('conv'),
        tenantId,
        channel: 'whatsapp',
        status: 'ai_handling',
        customerId: customer?.id ?? null,
        contactName: customer?.name ?? msg.name,
        contactAddress: address,
        subject: 'WhatsApp',
      })
      .returning();
  }

  await db.insert(messages).values({
    id: newId('msg'),
    tenantId,
    conversationId: conv.id,
    direction: 'inbound',
    author: 'customer',
    authorName: customer?.name ?? msg.name,
    text: msg.text,
    providerMessageId: msg.id,
  });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), unreadCount: sql`${conversations.unreadCount} + 1` })
    .where(eq(conversations.id, conv.id));
  await recordEvent(db, {
    tenantId,
    type: 'message.received',
    actor: { type: 'provider', name: 'WhatsApp' },
    summary: `WhatsApp von ${customer?.name ?? msg.name ?? address}`,
    entityType: 'conversation',
    entityId: conv.id,
  });
  return conv.id;
}

/** Lets the AI answer the latest customer message, unless staff has taken over. */
export async function autoReplyWhatsApp(db: DbOrTx, tenantId: string, conversationId: string): Promise<void> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
  if (!conv?.contactAddress || conv.status !== 'ai_handling') return;
  const ai = tenant.aiSettings;
  if (ai.autonomy === 'assist') {
    await db.update(conversations).set({ status: 'needs_staff' }).where(eq(conversations.id, conv.id));
    return;
  }

  const history = await db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(desc(messages.createdAt));
  const question = history.find((m) => m.direction === 'inbound')?.text;
  if (!question) return;
  const providers = await providersFor(db, tenantId);
  const result = await answerQuestion(db, providers.llm, tenantId, question);
  const handOver = ai.autonomy === 'semi' && result.confidence < SEMI_MIN_CONFIDENCE;
  // AI Act: the first answer in a conversation says that an AI is writing.
  const intro = history.some((m) => m.author === 'ai') ? '' : `Hallo, hier ist ${ai.name}, die KI-Assistenz von ${tenant.name}. `;
  const text = intro + (handOver ? HOLDING_REPLY : result.answer);

  const res = await providers.messaging.sendText({ to: conv.contactAddress, text });
  await db.insert(messages).values({
    id: newId('msg'),
    tenantId,
    conversationId: conv.id,
    direction: 'outbound',
    author: 'ai',
    authorName: ai.name,
    text,
    providerMessageId: res.ok ? res.providerMessageId : null,
    deliveryStatus: res.ok ? 'sent' : 'failed',
  });
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date(), ...(handOver || !res.ok ? { status: 'needs_staff' as const } : {}) })
    .where(eq(conversations.id, conv.id));
  await recordEvent(db, {
    tenantId,
    type: handOver ? 'conversation.handoff' : 'message.ai_sent',
    actor: { type: 'ai', name: ai.name },
    summary: !res.ok
      ? `WhatsApp-Antwort an ${conv.contactName ?? 'Kunde'} fehlgeschlagen: ${res.error}`
      : handOver
        ? `WhatsApp von ${conv.contactName ?? 'Kunde'} an das Team übergeben`
        : `${ai.name} hat ${conv.contactName ?? 'Kunde'} per WhatsApp geantwortet`,
    entityType: 'conversation',
    entityId: conv.id,
  });
}

export async function applyWhatsAppStatuses(db: DbOrTx, tenantId: string, statuses: WhatsAppStatus[]) {
  for (const s of statuses) {
    await db
      .update(messages)
      .set({ deliveryStatus: s.status })
      .where(and(eq(messages.tenantId, tenantId), eq(messages.providerMessageId, s.id)));
  }
}
