import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, inArray, notLike } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiKeys,
  automations,
  conversations,
  customers,
  events,
  integrations,
  knowledgeItems,
  memberships,
  reviewRequests,
  staffMembers,
  tenants,
  users,
} from '../db/schema.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { newToken, sha256 } from '../lib/crypto.js';
import { recordEvent } from '../lib/events.js';
import { auth, optionalString, parse, requireRole, userActor } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { IONOS_BASE_URL, listModels, openAiCompatibleLlm } from '../providers/openai-compatible.js';
import { PROVIDERS } from '../providers/registry.js';
import { canEncrypt, decrypt, encrypt } from '../lib/secretbox.js';
import { revokeGoogleToken } from '../providers/google-calendar.js';
import { setDialog360Webhook } from '../providers/dialog360.js';
import { clearAiSettings, getAiSettings, saveAiSettings, storedToken } from '../services/ai-settings.js';
import { answerQuestion } from '../services/knowledge.js';
import { webhookLog } from '../services/webhook-log.js';
import { analytics, dashboardKpis } from '../services/analytics.js';
import { AUTOMATION_TEMPLATES, templateByKey } from '../services/automation-templates.js';

const eventDto = (e: typeof events.$inferSelect) => ({
  id: e.id,
  type: e.type,
  actorType: e.actorType,
  actorName: e.actorName,
  summary: e.summary,
  entityType: e.entityType,
  entityId: e.entityId,
  createdAt: e.createdAt,
});

const automationDto = (a: typeof automations.$inferSelect) => ({
  id: a.id,
  templateKey: a.templateKey,
  name: a.name,
  description: a.description,
  enabled: a.enabled,
  runCount: a.runCount,
  steps: a.steps.map((s) => ({ type: s.type, label: s.label })),
});

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function systemRoutes(app: FastifyInstance) {
  const db = app.db;

  const activity = (tenantId: string, limit: number) =>
    db
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), notLike(events.type, 'user.%')))
      .orderBy(desc(events.createdAt))
      .limit(limit)
      .then((rows) => rows.map(eventDto));

  app.get('/dashboard', async (req) => {
    const a = auth(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const [roi, kpis, feed] = await Promise.all([analytics(db, a.tenantId, days), dashboardKpis(db, a.tenantId, days), activity(a.tenantId, 15)]);
    return { hero: { interactions: roi.interactions, minutesSaved: roi.minutesSaved, valueCents: roi.valueCents }, kpis, activity: feed };
  });

  app.get('/events', async (req) => {
    const a = auth(req);
    const { limit } = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    return activity(a.tenantId, limit);
  });

  app.get('/analytics', async (req) => {
    const a = auth(req);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }), req.query);
    return analytics(db, a.tenantId, days);
  });

  // Automations
  app.get('/automations', async (req) => {
    const a = auth(req);
    const rows = await db.select().from(automations).where(eq(automations.tenantId, a.tenantId)).orderBy(asc(automations.createdAt));
    return {
      items: rows.map(automationDto),
      templates: AUTOMATION_TEMPLATES.map((t) => ({ ...t, active: rows.some((r) => r.templateKey === t.key && r.enabled) })),
    };
  });

  app.post('/automations', async (req, reply) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { templateKey } = parse(z.object({ templateKey: z.string() }), req.body);
    const t = templateByKey(templateKey);
    if (!t) throw notFound('Vorlage');
    await db
      .insert(automations)
      .values({ id: newId('aut'), tenantId: a.tenantId, templateKey: t.key, name: t.name, description: t.description, steps: t.steps, enabled: true })
      .onConflictDoUpdate({ target: [automations.tenantId, automations.templateKey], set: { enabled: true } });
    const [row] = await db.select().from(automations).where(and(eq(automations.tenantId, a.tenantId), eq(automations.templateKey, t.key)));
    await recordEvent(db, { tenantId: a.tenantId, type: 'automation.enabled', actor: userActor(a), summary: `Automation „${t.name}“ aktiviert`, entityType: 'automation', entityId: row.id });
    return reply.status(201).send(automationDto(row));
  });

  app.patch('/automations/:id', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
    const [row] = await db
      .update(automations)
      .set({ enabled })
      .where(and(eq(automations.tenantId, a.tenantId), eq(automations.id, (req.params as { id: string }).id)))
      .returning();
    if (!row) throw notFound('Automation');
    await recordEvent(db, {
      tenantId: a.tenantId,
      type: enabled ? 'automation.enabled' : 'automation.disabled',
      actor: userActor(a),
      summary: `Automation „${row.name}“ ${enabled ? 'aktiviert' : 'pausiert'}`,
      entityType: 'automation',
      entityId: row.id,
    });
    return automationDto(row);
  });

  // Reviews
  app.get('/reviews', async (req) => {
    const a = auth(req);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, a.tenantId));
    const rows = await db
      .select({ rr: reviewRequests, customer: customers })
      .from(reviewRequests)
      .leftJoin(customers, eq(customers.id, reviewRequests.customerId))
      .where(eq(reviewRequests.tenantId, a.tenantId))
      .orderBy(desc(reviewRequests.createdAt));
    const items = rows.map(({ rr, customer }) => ({
      id: rr.id,
      customer: customer ? { id: customer.id, name: customer.name } : null,
      channel: rr.channel,
      status: rr.status,
      scheduledFor: rr.scheduledFor,
      sentAt: rr.sentAt,
      clickedAt: rr.clickedAt,
    }));
    return {
      stats: {
        planned: items.filter((i) => i.status === 'planned').length,
        sent: items.filter((i) => i.status === 'sent' || i.status === 'clicked').length,
        clicked: items.filter((i) => i.status === 'clicked').length,
      },
      reviewUrlConfigured: Boolean(tenant.googleReviewUrl),
      items,
    };
  });

  // Knowledge
  const knowledgeBody = z.object({
    category: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(5000),
  });
  const knowledgeDto = (k: typeof knowledgeItems.$inferSelect) => ({
    id: k.id,
    category: k.category,
    title: k.title,
    content: k.content,
    version: k.version,
    updatedAt: k.updatedAt,
  });

  app.get('/knowledge', async (req) => {
    const a = auth(req);
    const rows = await db.select().from(knowledgeItems).where(eq(knowledgeItems.tenantId, a.tenantId)).orderBy(asc(knowledgeItems.category), asc(knowledgeItems.title));
    return rows.map(knowledgeDto);
  });

  app.post('/knowledge', async (req, reply) => {
    const a = auth(req);
    const body = parse(knowledgeBody, req.body);
    const [k] = await db.insert(knowledgeItems).values({ id: newId('kno'), tenantId: a.tenantId, ...body }).returning();
    await recordEvent(db, { tenantId: a.tenantId, type: 'knowledge.created', actor: userActor(a), summary: `Wissenseintrag „${k.title}“ angelegt`, entityType: 'knowledge', entityId: k.id });
    return reply.status(201).send(knowledgeDto(k));
  });

  app.patch('/knowledge/:id', async (req) => {
    const a = auth(req);
    const id = (req.params as { id: string }).id;
    const body = parse(knowledgeBody.partial(), req.body);
    const [before] = await db.select().from(knowledgeItems).where(and(eq(knowledgeItems.tenantId, a.tenantId), eq(knowledgeItems.id, id)));
    if (!before) throw notFound('Wissenseintrag');
    const [k] = await db
      .update(knowledgeItems)
      .set({ ...body, version: before.version + 1, updatedAt: new Date() })
      .where(eq(knowledgeItems.id, id))
      .returning();
    await recordEvent(db, { tenantId: a.tenantId, type: 'knowledge.updated', actor: userActor(a), summary: `Wissenseintrag „${k.title}“ bearbeitet`, entityType: 'knowledge', entityId: k.id });
    return knowledgeDto(k);
  });

  app.delete('/knowledge/:id', async (req) => {
    const a = auth(req);
    const id = (req.params as { id: string }).id;
    const [k] = await db.delete(knowledgeItems).where(and(eq(knowledgeItems.tenantId, a.tenantId), eq(knowledgeItems.id, id))).returning();
    if (!k) throw notFound('Wissenseintrag');
    await recordEvent(db, { tenantId: a.tenantId, type: 'knowledge.deleted', actor: userActor(a), summary: `Wissenseintrag „${k.title}“ gelöscht`, entityType: 'knowledge', entityId: id });
    return { ok: true };
  });

  // Settings
  const tenantOf = async (tenantId: string) => (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0];

  app.get('/settings/company', async (req) => {
    const t = await tenantOf(auth(req).tenantId);
    return { name: t.name, industry: t.industry, address: t.address, phone: t.phone, googleReviewUrl: t.googleReviewUrl, timezone: t.timezone };
  });

  app.put('/settings/company', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(200),
        industry: z.string().trim().min(1).max(100),
        address: optionalString,
        phone: optionalString,
        googleReviewUrl: z.string().trim().url('Bitte eine vollständige URL angeben').startsWith('https://').optional().nullable().or(z.literal('')).transform((v) => v || null),
        timezone: z.string().refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), 'Unbekannte Zeitzone').optional(),
      }),
      req.body,
    );
    await db.update(tenants).set(body).where(eq(tenants.id, a.tenantId));
    await recordEvent(db, { tenantId: a.tenantId, type: 'settings.company_updated', actor: userActor(a), summary: 'Unternehmensdaten geändert' });
    const t = await tenantOf(a.tenantId);
    return { name: t.name, industry: t.industry, address: t.address, phone: t.phone, googleReviewUrl: t.googleReviewUrl, timezone: t.timezone };
  });

  app.get('/settings/hours', async (req) => (await tenantOf(auth(req).tenantId)).businessHours);

  app.put('/settings/hours', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const hours = parse(
      z
        .array(z.object({ day: z.number().int().min(1).max(7), open: z.string().regex(timeRe), close: z.string().regex(timeRe) }))
        .max(7)
        .refine((h) => new Set(h.map((x) => x.day)).size === h.length, 'Jeder Wochentag darf nur einmal vorkommen')
        .refine((h) => h.every((x) => x.open < x.close), 'Öffnungszeit muss vor Schließzeit liegen'),
      req.body,
    );
    await db.update(tenants).set({ businessHours: hours.sort((x, y) => x.day - y.day) }).where(eq(tenants.id, a.tenantId));
    await recordEvent(db, { tenantId: a.tenantId, type: 'settings.hours_updated', actor: userActor(a), summary: 'Geschäftszeiten geändert' });
    return (await tenantOf(a.tenantId)).businessHours;
  });

  app.get('/settings/ai', async (req) => (await tenantOf(auth(req).tenantId)).aiSettings);

  app.put('/settings/ai', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const body = parse(
      z.object({
        name: z.string().trim().min(1).max(50),
        language: z.string().trim().min(2).max(30),
        tone: z.string().trim().min(1).max(50),
        greeting: z.string().trim().min(1).max(500),
        autonomy: z.enum(['assist', 'semi', 'autopilot']),
        escalation: z.string().trim().max(1000),
      }),
      req.body,
    );
    await db.update(tenants).set({ aiSettings: body }).where(eq(tenants.id, a.tenantId));
    await recordEvent(db, { tenantId: a.tenantId, type: 'settings.ai_updated', actor: userActor(a), summary: 'Einstellungen des KI-Mitarbeiters geändert' });
    return body;
  });

  app.get('/settings/team', async (req) => {
    const a = auth(req);
    const [userRows, staffRows] = await Promise.all([
      db
        .select({ id: users.id, name: users.name, email: users.email, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, a.tenantId))
        .orderBy(asc(users.name)),
      db.select().from(staffMembers).where(eq(staffMembers.tenantId, a.tenantId)).orderBy(asc(staffMembers.name)),
    ]);
    return { users: userRows, staff: staffRows.map((s) => ({ id: s.id, name: s.name, skills: s.skills, active: s.active })) };
  });

  // Integrations
  const integrationList = async (tenantId: string) => {
    const rows = await db.select().from(integrations).where(eq(integrations.tenantId, tenantId));
    const ai = await getAiSettings(db);
    return PROVIDERS.map((p) => {
      const row = rows.find((r) => r.provider === p.provider);
      // The model is set up once for the whole platform, so every tenant sees it as connected.
      if (p.provider === 'openai') {
        return { ...providerBase(p), mode: ai.configured ? 'live' : 'sandbox', status: ai.configured ? 'connected' : 'disconnected', lastError: null, webhookUrl: null, detail: ai.model };
      }
      return {
        ...providerBase(p),
        mode: row?.mode ?? 'sandbox',
        status: row?.status ?? 'disconnected',
        lastError: row?.lastError ?? null,
        // WhatsApp's webhook address carries a secret and is registered with 360dialog automatically.
        webhookUrl: p.provider === 'fonio' ? `${app.publicUrl}/api/voice/fonio/inbound` : p.hasWebhook && p.provider !== 'whatsapp_360dialog' ? `${app.publicUrl}/api/webhooks/${p.provider}` : null,
        detail:
          row?.mode !== 'live' || row.status !== 'connected'
            ? null
            : p.provider === 'whatsapp_360dialog'
              ? `${row.config.testAccount === 'true' ? '360dialog-Testzugang' : '360dialog'}, Schlüssel ${row.config.keyHint}`
              : p.provider === 'google_calendar'
                ? `Verbunden mit ${row.config.account}`
                : null,
      };
    });
  };
  const providerBase = (p: (typeof PROVIDERS)[number]) => ({ provider: p.provider, name: p.name, description: p.description, category: p.category });

  app.get('/integrations', async (req) => integrationList(auth(req).tenantId));

  // What fonio sent recently; calls with a missing or wrong key are only shown to platform admins.
  app.get('/integrations/fonio/log', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    return webhookLog(a.tenantId, a.isPlatformAdmin);
  });

  app.post('/integrations/:provider/connect', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const provider = (req.params as { provider: string }).provider;
    if (!PROVIDERS.some((p) => p.provider === provider)) throw notFound('Integration');
    if (provider === 'openai') throw badRequest('Das KI-Modell wird unter Plattform-Admin eingerichtet.');
    const body = parse(z.object({ apiKey: optionalString, testAccount: z.boolean().optional() }), req.body ?? {});

    // With a 360dialog key WhatsApp goes live: the key is checked by registering our webhook,
    // whose address carries a fresh secret because 360dialog's test account can't send headers.
    let mode: 'sandbox' | 'live' = 'sandbox';
    let config: Record<string, string> = {};
    if (provider === 'whatsapp_360dialog' && body.apiKey) {
      if (!canEncrypt()) throw badRequest('Auf dem Server fehlt APP_SECRET, deshalb kann der Schlüssel nicht sicher gespeichert werden.');
      const apiKey = body.apiKey.trim();
      const testAccount = body.testAccount ?? true;
      const secret = `wh_${newToken()}`;
      try {
        await setDialog360Webhook({ apiKey, testAccount }, `${app.publicUrl}/api/webhooks/whatsapp_360dialog/${secret}`);
      } catch (err) {
        throw badRequest(`Verbindung zu 360dialog fehlgeschlagen: ${(err as Error).message}`, 'provider_rejected');
      }
      await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.tenantId, a.tenantId), eq(apiKeys.provider, provider)));
      await db.insert(apiKeys).values({ id: sha256(secret), tenantId: a.tenantId, provider, label: 'WhatsApp Webhook' });
      mode = 'live';
      config = { apiKey: encrypt(apiKey), keyHint: `…${apiKey.slice(-4)}`, testAccount: String(testAccount) };
    }
    await db
      .insert(integrations)
      .values({ id: newId('int'), tenantId: a.tenantId, provider, mode, status: 'connected', config })
      .onConflictDoUpdate({ target: [integrations.tenantId, integrations.provider], set: { mode, status: 'connected', config, lastError: null, updatedAt: new Date() } });

    // fonio authenticates its webhook calls with a bearer key; it is shown exactly once.
    let apiKey: string | undefined;
    if (provider === 'fonio') {
      apiKey = `bp_live_${newToken()}`;
      await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.tenantId, a.tenantId), eq(apiKeys.provider, 'fonio')));
      await db.insert(apiKeys).values({ id: sha256(apiKey), tenantId: a.tenantId, provider: 'fonio', label: 'fonio Webhook' });
    }
    const name = PROVIDERS.find((p) => p.provider === provider)!.name;
    await recordEvent(db, { tenantId: a.tenantId, type: 'integration.connected', actor: userActor(a), summary: `${name} verbunden (${mode === 'live' ? 'live' : 'Sandbox'})` });
    const item = (await integrationList(a.tenantId)).find((i) => i.provider === provider)!;
    return { ...item, apiKey };
  });

  app.post('/integrations/:provider/disconnect', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const provider = (req.params as { provider: string }).provider;
    if (!PROVIDERS.some((p) => p.provider === provider)) throw notFound('Integration');
    if (provider === 'google_calendar') {
      // Give the access back at Google too, so the business's account no longer lists BusinessPilot.
      const [row] = await db.select().from(integrations).where(and(eq(integrations.tenantId, a.tenantId), eq(integrations.provider, provider)));
      if (row?.config.refreshToken) await revokeGoogleToken(decrypt(row.config.refreshToken)).catch(() => {});
    }
    await db
      .update(integrations)
      .set({ status: 'disconnected', mode: 'sandbox', config: {}, updatedAt: new Date() })
      .where(and(eq(integrations.tenantId, a.tenantId), eq(integrations.provider, provider)));
    if (provider === 'fonio' || provider === 'whatsapp_360dialog') {
      await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.tenantId, a.tenantId), eq(apiKeys.provider, provider)));
    }
    const name = PROVIDERS.find((p) => p.provider === provider)!.name;
    await recordEvent(db, { tenantId: a.tenantId, type: 'integration.disconnected', actor: userActor(a), summary: `${name} getrennt` });
    return (await integrationList(a.tenantId)).find((i) => i.provider === provider);
  });

  // Platform admin
  app.get('/admin/tenants', async (req) => {
    const a = auth(req);
    if (!a.isPlatformAdmin) throw forbidden();
    const rows = await db.select().from(tenants).orderBy(asc(tenants.createdAt));
    const ids = rows.map((t) => t.id);
    const [userCounts, convCounts] = ids.length
      ? await Promise.all([
          db.select({ tenantId: memberships.tenantId, n: count() }).from(memberships).where(inArray(memberships.tenantId, ids)).groupBy(memberships.tenantId),
          db
            .select({ tenantId: conversations.tenantId, channel: conversations.channel, n: count() })
            .from(conversations)
            .where(inArray(conversations.tenantId, ids))
            .groupBy(conversations.tenantId, conversations.channel),
        ])
      : [[], []];
    const items = rows.map((t) => ({
      id: t.id,
      name: t.name,
      industry: t.industry,
      plan: t.plan,
      status: t.status,
      users: userCounts.find((u) => u.tenantId === t.id)?.n ?? 0,
      calls: convCounts.find((c) => c.tenantId === t.id && c.channel === 'phone')?.n ?? 0,
      chats: convCounts.find((c) => c.tenantId === t.id && c.channel === 'whatsapp')?.n ?? 0,
      createdAt: t.createdAt,
    }));
    return {
      stats: { tenants: items.length, users: items.reduce((s, i) => s + i.users, 0), active: items.filter((i) => i.status === 'active').length },
      items,
    };
  });

  // Platform admin: the LLM account all tenants share. The token is write-only from here on;
  // responses only ever show its last four characters.
  const platformAdmin = (req: Parameters<typeof auth>[0]) => {
    const a = auth(req);
    if (!a.isPlatformAdmin) throw forbidden();
    return a;
  };
  const aiConnection = z.object({
    baseUrl: z.string().trim().url().default(IONOS_BASE_URL),
    token: z.string().trim().min(20).max(4000).optional(),
  });
  const tokenFor = async (token: string | undefined) => {
    const t = token ?? (await storedToken(db));
    if (!t) throw badRequest('Bitte zuerst den Token eintragen.');
    return t;
  };
  const providerError = (err: unknown) => badRequest(err instanceof Error ? err.message : 'Der KI-Anbieter ist nicht erreichbar.', 'llm_error');

  app.get('/admin/ai', async (req) => {
    platformAdmin(req);
    return { ...(await getAiSettings(db)), canStoreSecrets: canEncrypt() };
  });

  app.post('/admin/ai/models', async (req) => {
    platformAdmin(req);
    const body = parse(aiConnection, req.body ?? {});
    try {
      return { models: await listModels({ baseUrl: body.baseUrl, token: await tokenFor(body.token) }) };
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err) throw err;
      throw providerError(err);
    }
  });

  app.put('/admin/ai', async (req) => {
    const a = platformAdmin(req);
    if (!canEncrypt()) throw badRequest('Auf dem Server fehlt APP_SECRET. Das Update-Skript legt ihn beim nächsten Durchlauf an.', 'no_secret');
    const body = parse(aiConnection.extend({ model: z.string().trim().min(1).max(200) }), req.body);
    const token = await tokenFor(body.token);
    try {
      await openAiCompatibleLlm({ baseUrl: body.baseUrl, token, model: body.model, timeoutMs: 30_000 }).complete({
        messages: [{ role: 'user', content: 'Antworte nur mit: OK' }],
        maxTokens: 5,
      });
    } catch (err) {
      throw providerError(err);
    }
    await saveAiSettings(db, { baseUrl: body.baseUrl, model: body.model, token });
    await recordEvent(db, { tenantId: a.tenantId, type: 'integration.connected', actor: userActor(a), summary: `KI-Modell ${body.model} eingerichtet` });
    return { ...(await getAiSettings(db)), canStoreSecrets: true };
  });

  app.delete('/admin/ai', async (req) => {
    const a = platformAdmin(req);
    await clearAiSettings(db);
    await recordEvent(db, { tenantId: a.tenantId, type: 'integration.disconnected', actor: userActor(a), summary: 'KI-Modell entfernt, Antworten wieder aus dem Wissen' });
    return { ...(await getAiSettings(db)), canStoreSecrets: canEncrypt() };
  });

  // Ask the knowledge base of the admin's own business with a chosen model, to compare models
  // on real questions before switching.
  app.post('/admin/ai/test', async (req) => {
    const a = platformAdmin(req);
    const body = parse(z.object({ question: z.string().trim().min(2).max(500), model: z.string().trim().min(1).max(200).optional() }), req.body);
    const settings = await getAiSettings(db);
    const model = body.model ?? settings.model;
    if (!model) throw badRequest('Bitte zuerst ein Modell auswählen und speichern.');
    const llm = openAiCompatibleLlm({ baseUrl: settings.baseUrl, model, token: await tokenFor(undefined) });
    const started = Date.now();
    try {
      const result = await answerQuestion(db, llm, a.tenantId, body.question);
      return { model, answer: result.answer, ms: Date.now() - started, sources: result.sources.map((s) => ({ id: s.id, title: s.title })) };
    } catch (err) {
      throw providerError(err);
    }
  });
}
