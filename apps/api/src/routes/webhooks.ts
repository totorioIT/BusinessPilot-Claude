import type { FastifyInstance } from 'fastify';
import { and, eq, isNull } from 'drizzle-orm';
import { apiKeys } from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { parseDialog360Webhook } from '../providers/dialog360.js';
import { logWebhook } from '../services/webhook-log.js';
import { applyWhatsAppStatuses, autoReplyWhatsApp, storeIncomingWhatsApp } from '../services/whatsapp.js';

// AI replies run after the response, because 360dialog wants its 200 within 5 seconds.
// Tests wait for them through whatsappIdle().
const pending = new Set<Promise<void>>();
export const whatsappIdle = () => Promise.all([...pending]);

export async function webhookRoutes(app: FastifyInstance) {
  const db = app.db;

  app.post('/whatsapp_360dialog/:secret', async (req, reply) => {
    const { secret } = req.params as { secret: string };
    const [key] = await db
      .select({ tenantId: apiKeys.tenantId })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, sha256(secret)), eq(apiKeys.provider, 'whatsapp_360dialog'), isNull(apiKeys.revokedAt)));
    const path = '/webhooks/whatsapp';
    if (!key) {
      logWebhook(null, { path, status: 404, body: req.body, note: 'Unbekannte Webhook-Adresse' });
      return reply.status(404).send({ error: 'not_found', message: 'Unbekannte Webhook-Adresse.' });
    }
    const { messages, statuses } = parseDialog360Webhook(req.body);
    await applyWhatsAppStatuses(db, key.tenantId, statuses);
    for (const msg of messages) {
      const conversationId = await storeIncomingWhatsApp(db, key.tenantId, msg);
      if (!conversationId) continue;
      const job = autoReplyWhatsApp(db, key.tenantId, conversationId)
        .catch((err) => req.log.error(err, 'WhatsApp-Antwort fehlgeschlagen'))
        .finally(() => pending.delete(job));
      pending.add(job);
    }
    const first = messages[0];
    logWebhook(key.tenantId, {
      path,
      status: 200,
      body: first ? { von: first.from, name: first.name, text: first.text } : { status: statuses.map((s) => s.status).join(', ') || '(leer)' },
    });
    return { ok: true };
  });
}
