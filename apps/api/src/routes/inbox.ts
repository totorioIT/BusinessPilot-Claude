import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/client.js';
import { calls, conversations, customers, messages } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, parse, userActor } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { providersFor } from '../providers/registry.js';
import { answerQuestion } from '../services/knowledge.js';

const STATUS = ['ai_handling', 'needs_staff', 'missed', 'closed'] as const;

/** List items with a preview of the latest message (or the call summary for phone calls). */
export async function conversationListItems(db: DbOrTx, tenantId: string, filter: { channel?: string; status?: string; customerId?: string } = {}) {
  const lastText = sql<string | null>`(select m.text from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc limit 1)`;
  const rows = await db
    .select({ conv: conversations, lastText, customerName: customers.name })
    .from(conversations)
    .leftJoin(customers, eq(customers.id, conversations.customerId))
    .where(
      and(
        eq(conversations.tenantId, tenantId),
        filter.channel ? eq(conversations.channel, filter.channel as 'phone') : undefined,
        filter.status ? eq(conversations.status, filter.status as 'closed') : undefined,
        filter.customerId ? eq(conversations.customerId, filter.customerId) : undefined,
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  return rows.map(({ conv, lastText, customerName }) => ({
    id: conv.id,
    channel: conv.channel,
    status: conv.status,
    contactName: customerName ?? conv.contactName ?? conv.contactAddress ?? 'Unbekannt',
    customerId: conv.customerId,
    subject: conv.subject,
    preview: conv.channel === 'phone' ? (conv.summary ?? lastText) : (lastText ?? conv.summary),
    unreadCount: conv.unreadCount,
    lastMessageAt: conv.lastMessageAt,
  }));
}

async function getConversation(db: DbOrTx, tenantId: string, id: string) {
  const [conv] = await db.select().from(conversations).where(and(eq(conversations.tenantId, tenantId), eq(conversations.id, id)));
  if (!conv) throw notFound('Unterhaltung');
  return conv;
}

const messageDto = (m: typeof messages.$inferSelect) => ({
  id: m.id,
  direction: m.direction,
  author: m.author,
  authorName: m.authorName,
  text: m.text,
  createdAt: m.createdAt,
  deliveryStatus: m.deliveryStatus,
});

export async function inboxRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/conversations', async (req) => {
    const a = auth(req);
    const q = parse(z.object({ channel: z.enum(['phone', 'whatsapp', 'webchat']).optional(), status: z.enum(STATUS).optional() }), req.query);
    const items = await conversationListItems(db, a.tenantId, q);
    const all = q.channel || q.status ? await conversationListItems(db, a.tenantId) : items;
    return {
      stats: {
        calls: all.filter((c) => c.channel === 'phone').length,
        whatsapp: all.filter((c) => c.channel === 'whatsapp').length,
        missed: all.filter((c) => c.status === 'missed').length,
        needsStaff: all.filter((c) => c.status === 'needs_staff').length,
      },
      items,
    };
  });

  app.get('/conversations/:id', async (req) => {
    const a = auth(req);
    const conv = await getConversation(db, a.tenantId, (req.params as { id: string }).id);
    const [customer] = conv.customerId ? await db.select().from(customers).where(eq(customers.id, conv.customerId)) : [];
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(asc(messages.createdAt));
    const [call] = await db.select().from(calls).where(eq(calls.conversationId, conv.id)).orderBy(desc(calls.startedAt)).limit(1);
    return {
      conversation: {
        id: conv.id,
        channel: conv.channel,
        status: conv.status,
        contactName: customer?.name ?? conv.contactName ?? conv.contactAddress ?? 'Unbekannt',
        contactAddress: conv.contactAddress,
        subject: conv.subject,
        summary: conv.summary,
        sentiment: conv.sentiment,
        unreadCount: conv.unreadCount,
        lastMessageAt: conv.lastMessageAt,
      },
      customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone } : null,
      messages: msgs.map(messageDto),
      call: call
        ? {
            id: call.id,
            fromNumber: call.fromNumber,
            startedAt: call.startedAt,
            durationSec: call.durationSec,
            outcome: call.outcome,
            intent: call.intent,
            summary: call.summary,
            sentiment: conv.sentiment,
            transcript: call.transcript,
            actions: call.actions,
          }
        : null,
    };
  });

  app.patch('/conversations/:id', async (req) => {
    const a = auth(req);
    const conv = await getConversation(db, a.tenantId, (req.params as { id: string }).id);
    const { status } = parse(z.object({ status: z.enum(STATUS) }), req.body);
    await db.update(conversations).set({ status }).where(eq(conversations.id, conv.id));
    if (status !== conv.status) {
      const labels = { ai_handling: 'KI bearbeitet', needs_staff: 'Mitarbeiter nötig', missed: 'Verpasst', closed: 'Abgeschlossen' };
      await recordEvent(db, {
        tenantId: a.tenantId,
        type: status === 'needs_staff' ? 'conversation.handoff' : 'conversation.status_changed',
        actor: userActor(a),
        summary: `Unterhaltung mit ${conv.contactName ?? 'Kunde'} → ${labels[status]}`,
        entityType: 'conversation',
        entityId: conv.id,
      });
    }
    return { ok: true, status };
  });

  app.post('/conversations/:id/read', async (req) => {
    const a = auth(req);
    const conv = await getConversation(db, a.tenantId, (req.params as { id: string }).id);
    await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conv.id));
    return { ok: true };
  });

  app.post('/conversations/:id/messages', async (req, reply) => {
    const a = auth(req);
    const conv = await getConversation(db, a.tenantId, (req.params as { id: string }).id);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body);
    if (conv.channel !== 'whatsapp') throw badRequest('Antworten sind nur in WhatsApp-Unterhaltungen möglich.');
    if (!conv.contactAddress) throw badRequest('Für diese Unterhaltung ist keine Telefonnummer hinterlegt.');
    const providers = await providersFor(db, a.tenantId);
    const res = await providers.messaging.sendText({ to: conv.contactAddress, text });
    if (!res.ok) throw badRequest(`Nachricht konnte nicht gesendet werden: ${res.error}`, 'send_failed');
    const [msg] = await db
      .insert(messages)
      .values({
        id: newId('msg'),
        tenantId: a.tenantId,
        conversationId: conv.id,
        direction: 'outbound',
        author: 'staff',
        authorName: a.userName,
        text,
        providerMessageId: res.providerMessageId,
        deliveryStatus: 'sent',
      })
      .returning();
    await db.update(conversations).set({ lastMessageAt: new Date(), unreadCount: 0 }).where(eq(conversations.id, conv.id));
    await recordEvent(db, {
      tenantId: a.tenantId,
      type: 'message.staff_sent',
      actor: userActor(a),
      summary: `WhatsApp an ${conv.contactName ?? 'Kunde'} gesendet`,
      entityType: 'conversation',
      entityId: conv.id,
    });
    return reply.status(201).send(messageDto(msg));
  });

  app.post('/conversations/:id/suggest-reply', async (req) => {
    const a = auth(req);
    const conv = await getConversation(db, a.tenantId, (req.params as { id: string }).id);
    const [lastInbound] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, 'inbound')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    if (!lastInbound) throw badRequest('Es gibt noch keine Kundennachricht, auf die geantwortet werden kann.');
    const providers = await providersFor(db, a.tenantId);
    const result = await answerQuestion(db, providers.llm, a.tenantId, lastInbound.text);
    return { text: result.answer, sources: result.sources.map((s) => ({ id: s.id, title: s.title })) };
  });
}
