import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { campaigns, customers, integrations, jobs, serviceTypes, tenants } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, parse, requireRole, userActor } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { canSignLinks, signLink } from '../lib/signed-links.js';
import { addMinutes } from '../lib/time.js';
import { providersFor } from '../providers/registry.js';
import { campaignAudience } from '../services/campaigns.js';
import { marketingConsents, setMarketingConsent } from '../services/consents.js';

// Offers & news ("Aktionen"), rebooking settings and the customers' marketing consent.

const CONFIRM_VALID_DAYS = 30;
/** Spread campaign mails out so a provider never sees a burst from one tenant. */
const SEND_SPACING_SECONDS = 3;

const campaignDto = (c: typeof campaigns.$inferSelect) => ({
  id: c.id,
  title: c.title,
  subject: c.subject,
  body: c.body,
  audience: c.audience,
  status: c.status,
  recipientCount: c.recipientCount,
  sentCount: c.sentCount,
  failedCount: c.failedCount,
  createdAt: c.createdAt,
  sentAt: c.sentAt,
});

const audienceSchema = z.object({
  serviceTypeId: z.string().max(100).optional().nullable(),
  visitedWithinDays: z.number().int().min(1).max(3650).optional().nullable(),
});

const campaignBody = z.object({
  title: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]*$/, 'Der Betreff darf keinen Zeilenumbruch enthalten.'),
  body: z.string().trim().min(1).max(5000),
  audience: audienceSchema.default({}),
});

export async function marketingRoutes(app: FastifyInstance) {
  const db = app.db;

  const customerOf = async (tenantId: string, id: string) => {
    const [c] = await db.select().from(customers).where(and(eq(customers.tenantId, tenantId), eq(customers.id, id)));
    if (!c) throw notFound('Kunde');
    return c;
  };

  const ensureServiceType = async (tenantId: string, id: string | null | undefined) => {
    if (!id) return;
    const [st] = await db.select({ id: serviceTypes.id }).from(serviceTypes).where(and(eq(serviceTypes.tenantId, tenantId), eq(serviceTypes.id, id)));
    if (!st) throw notFound('Leistung');
  };

  // Consent
  app.get('/customers/:id/consents', async (req) => {
    const a = auth(req);
    const c = await customerOf(a.tenantId, (req.params as { id: string }).id);
    return marketingConsents(db, a.tenantId, c.id);
  });

  // Rate-limited because "request" sends an email to the address on file.
  app.put('/customers/:id/consents', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const a = auth(req);
    const c = await customerOf(a.tenantId, (req.params as { id: string }).id);
    const body = parse(
      z.object({
        channel: z.enum(['email', 'whatsapp']),
        action: z.enum(['grant', 'revoke', 'request']),
        source: z.string().trim().min(3, 'Bitte angeben, wie die Einwilligung vorliegt.').max(200).optional(),
      }),
      req.body,
    );
    const actor = userActor(a);
    if (body.action === 'grant') {
      if (!body.source) throw badRequest('Bitte angeben, wie die Einwilligung vorliegt, z. B. „Unterschrift auf dem Auftrag“.', 'validation');
      await setMarketingConsent(db, { tenantId: a.tenantId, customerId: c.id, channel: body.channel, status: 'granted', source: body.source, actor });
    } else if (body.action === 'revoke') {
      await setMarketingConsent(db, { tenantId: a.tenantId, customerId: c.id, channel: body.channel, status: 'revoked', source: body.source ?? `Eingetragen von ${a.userName}`, actor });
    } else {
      // Double opt-in: the customer confirms by clicking the link in the email.
      if (body.channel !== 'email') throw badRequest('Eine Bestätigung per Link gibt es nur für E-Mail.');
      if (!c.email) throw badRequest('Für diesen Kunden ist keine E-Mail-Adresse hinterlegt.');
      if (!canSignLinks()) throw badRequest('Auf dem Server fehlt APP_SECRET, deshalb kann kein Bestätigungslink erstellt werden.');
      const current = (await marketingConsents(db, a.tenantId, c.id)).find((x) => x.channel === 'email');
      if (current?.status === 'granted') throw conflict('already_granted', 'Die Einwilligung liegt bereits vor.');
      const [tenant] = await db.select().from(tenants).where(eq(tenants.id, a.tenantId));
      const token = signLink({ p: 'confirm', t: a.tenantId, c: c.id, ch: 'email', exp: Date.now() + CONFIRM_VALID_DAYS * 86400000 });
      const url = `${app.publicUrl}/api/public/consent/confirm?t=${token}`;
      const providers = await providersFor(db, a.tenantId);
      const res = await providers.email.send({
        to: c.email,
        fromName: tenant.name,
        replyTo: tenant.email ?? undefined,
        subject: `Bitte bestätigen: Angebote und Neuigkeiten von ${tenant.name}`,
        text:
          `Guten Tag ${c.name},\n\nSie möchten von ${tenant.name} gelegentlich Angebote, Neuigkeiten und Terminerinnerungen per E-Mail erhalten. ` +
          `Bitte bestätigen Sie das mit einem Klick:\n${url}\n\nDer Link ist ${CONFIRM_VALID_DAYS} Tage gültig. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail einfach. ` +
          `Sie können sich jederzeit wieder abmelden.\n\nViele Grüße\n${tenant.name}`,
      });
      if (!res.ok) throw badRequest(`Die Bestätigungs-E-Mail konnte nicht gesendet werden: ${res.error}`, 'provider_rejected');
      await setMarketingConsent(db, { tenantId: a.tenantId, customerId: c.id, channel: 'email', status: 'pending', source: 'Bestätigungs-E-Mail (Double-Opt-in)', actor });
    }
    return marketingConsents(db, a.tenantId, c.id);
  });

  // Rebooking interval per service
  app.patch('/service-types/:id', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { id } = req.params as { id: string };
    const body = parse(z.object({ rebookAfterDays: z.number().int().min(1).max(1095).nullable() }), req.body);
    const [st] = await db
      .update(serviceTypes)
      .set({ rebookAfterDays: body.rebookAfterDays })
      .where(and(eq(serviceTypes.tenantId, a.tenantId), eq(serviceTypes.id, id)))
      .returning();
    if (!st) throw notFound('Leistung');
    await recordEvent(db, {
      tenantId: a.tenantId,
      type: 'settings.rebooking_updated',
      actor: userActor(a),
      summary: body.rebookAfterDays ? `Wiederbuchung für „${st.name}“ nach ${body.rebookAfterDays} Tagen` : `Wiederbuchung für „${st.name}“ ausgeschaltet`,
    });
    return { id: st.id, code: st.code, name: st.name, durationMin: st.durationMin, bufferMin: st.bufferMin, rebookAfterDays: st.rebookAfterDays };
  });

  // Campaigns ("Aktionen")
  app.get('/campaigns', async (req) => {
    const a = auth(req);
    const rows = await db.select().from(campaigns).where(eq(campaigns.tenantId, a.tenantId)).orderBy(desc(campaigns.createdAt)).limit(200);
    const [brevo] = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.tenantId, a.tenantId), eq(integrations.provider, 'brevo'), eq(integrations.mode, 'live'), eq(integrations.status, 'connected')));
    return { items: rows.map(campaignDto), emailLive: Boolean(brevo), canSend: canSignLinks() };
  });

  app.post('/campaigns/audience', async (req) => {
    const a = auth(req);
    const audience = parse(audienceSchema, req.body ?? {});
    await ensureServiceType(a.tenantId, audience.serviceTypeId);
    const list = await campaignAudience(db, a.tenantId, audience);
    return { count: list.length };
  });

  const draftOf = async (tenantId: string, id: string) => {
    const [c] = await db.select().from(campaigns).where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.id, id)));
    if (!c) throw notFound('Aktion');
    if (c.status !== 'draft') throw conflict('campaign_not_draft', 'Diese Aktion wurde bereits versendet und kann nicht mehr geändert werden.');
    return c;
  };

  app.post('/campaigns', async (req, reply) => {
    const a = auth(req);
    const body = parse(campaignBody, req.body);
    await ensureServiceType(a.tenantId, body.audience.serviceTypeId);
    const [c] = await db
      .insert(campaigns)
      .values({ id: newId('cmp'), tenantId: a.tenantId, title: body.title, subject: body.subject, body: body.body, audience: body.audience, createdBy: a.userId })
      .returning();
    await recordEvent(db, { tenantId: a.tenantId, type: 'campaign.created', actor: userActor(a), summary: `Aktion „${c.title}“ angelegt`, entityType: 'campaign', entityId: c.id });
    return reply.status(201).send(campaignDto(c));
  });

  app.patch('/campaigns/:id', async (req) => {
    const a = auth(req);
    const before = await draftOf(a.tenantId, (req.params as { id: string }).id);
    const body = parse(campaignBody.partial(), req.body);
    await ensureServiceType(a.tenantId, body.audience?.serviceTypeId);
    const [c] = await db
      .update(campaigns)
      .set(body)
      .where(and(eq(campaigns.id, before.id), eq(campaigns.status, 'draft')))
      .returning();
    if (!c) throw conflict('campaign_not_draft', 'Diese Aktion wurde bereits versendet und kann nicht mehr geändert werden.');
    return campaignDto(c);
  });

  app.delete('/campaigns/:id', async (req) => {
    const a = auth(req);
    const c = await draftOf(a.tenantId, (req.params as { id: string }).id);
    await db.delete(campaigns).where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'draft')));
    await recordEvent(db, { tenantId: a.tenantId, type: 'campaign.deleted', actor: userActor(a), summary: `Aktion „${c.title}“ gelöscht`, entityType: 'campaign', entityId: c.id });
    return { ok: true };
  });

  // Sending reaches many customers at once, so only owners and admins may do it.
  app.post('/campaigns/:id/send', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const c = await draftOf(a.tenantId, (req.params as { id: string }).id);
    if (!canSignLinks()) throw badRequest('Auf dem Server fehlt APP_SECRET, deshalb können keine Abmeldelinks erstellt werden.');
    const recipients = await campaignAudience(db, a.tenantId, c.audience);
    if (recipients.length === 0) throw badRequest('Für diese Auswahl gibt es keine Kunden mit E-Mail-Einwilligung.', 'no_recipients');
    const now = new Date();
    const started = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(campaigns)
        .set({ status: 'sending', recipientCount: recipients.length, sentCount: 0, failedCount: 0 })
        .where(and(eq(campaigns.id, c.id), eq(campaigns.status, 'draft')))
        .returning();
      if (!row) return null; // sent twice at the same moment: only the first wins
      await tx.insert(jobs).values(
        recipients.map((r, i) => ({
          id: newId('job'),
          tenantId: a.tenantId,
          type: 'campaign_send',
          runAt: addMinutes(now, (i * SEND_SPACING_SECONDS) / 60),
          payload: { campaignId: c.id, customerId: r.id },
          dedupeKey: `campaign:${c.id}:${r.id}`,
        })),
      );
      return row;
    });
    if (!started) throw conflict('campaign_not_draft', 'Diese Aktion wird bereits versendet.');
    await recordEvent(db, {
      tenantId: a.tenantId,
      type: 'campaign.started',
      actor: userActor(a),
      summary: `Aktion „${c.title}“ wird an ${recipients.length} Kunden gesendet`,
      entityType: 'campaign',
      entityId: c.id,
    });
    return campaignDto(started);
  });
}
