import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { memberships, sessions, staffMembers, tenants, users } from '../db/schema.js';
import { hashPassword, newToken } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, parse, requireRole, userActor } from '../lib/http.js';
import { newId } from '../lib/ids.js';

// Creating businesses (platform admin) and managing who can log in to a business (its owner).

export const INDUSTRIES = ['Kfz-Werkstatt', 'Friseur', 'Beauty & Kosmetik', 'Fitness', 'Handwerk', 'Handel', 'Restaurant', 'Sonstiges'];
export const PLANS = ['start', 'business', 'autopilot'] as const;

/** A readable one-time password: shown once, the person changes it after the first login. */
function startPassword() {
  return newToken().replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
}

const person = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email('Bitte eine gültige E-Mail-Adresse eingeben.'),
});

export async function adminRoutes(app: FastifyInstance) {
  const db = app.db;

  /**
   * Adds a login to a business. An existing account (same e-mail) just gets access, keeping its
   * password; a new one gets a start password that is returned exactly once.
   */
  const grantAccess = async (tenantId: string, p: { name: string; email: string }, role: 'owner' | 'admin' | 'staff') => {
    const [existing] = await db.select().from(users).where(eq(users.email, p.email));
    if (existing) {
      const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, existing.id), eq(memberships.tenantId, tenantId)));
      if (m) throw badRequest('Diese E-Mail-Adresse hat bereits Zugang zu diesem Betrieb.', 'already_member');
      await db.insert(memberships).values({ userId: existing.id, tenantId, role });
      return { userId: existing.id, startPassword: null as string | null };
    }
    const password = startPassword();
    const userId = newId('usr');
    await db.insert(users).values({ id: userId, email: p.email, name: p.name, passwordHash: await hashPassword(password) });
    await db.insert(memberships).values({ userId, tenantId, role });
    return { userId, startPassword: password };
  };

  app.post('/admin/tenants', async (req, reply) => {
    const a = auth(req);
    if (!a.isPlatformAdmin) throw forbidden();
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(160),
        industry: z.enum(INDUSTRIES as [string, ...string[]]),
        plan: z.enum(PLANS).default('start'),
        owner: person,
      }),
      req.body,
    );
    const tenantId = newId('wrk');
    await db.insert(tenants).values({
      id: tenantId,
      name: body.name,
      industry: body.industry,
      plan: body.plan,
      status: 'trial',
      aiSettings: {
        name: 'Anna',
        language: 'Deutsch',
        tone: 'Freundlich',
        greeting: 'Wie kann ich Ihnen helfen?',
        // New businesses start careful: the AI suggests, people send, until the owner trusts it.
        autonomy: 'assist',
        escalation: 'Bei Notfällen, Beschwerden oder Preisverhandlungen an einen Mitarbeiter übergeben.',
      },
      businessHours: [1, 2, 3, 4, 5].map((day) => ({ day, open: '08:00', close: '17:00' })),
    });
    const access = await grantAccess(tenantId, body.owner, 'owner');
    await recordEvent(db, { tenantId, type: 'tenant.created', actor: userActor(a), summary: `Betrieb angelegt, Inhaber: ${body.owner.name}` });
    return reply.status(201).send({ id: tenantId, name: body.name, owner: { email: body.owner.email, startPassword: access.startPassword } });
  });

  app.patch('/admin/tenants/:id', async (req) => {
    const a = auth(req);
    if (!a.isPlatformAdmin) throw forbidden();
    const { id } = req.params as { id: string };
    const body = parse(z.object({ status: z.enum(['trial', 'active', 'paused']).optional(), plan: z.enum(PLANS).optional() }), req.body);
    const [row] = await db.update(tenants).set(body).where(eq(tenants.id, id)).returning();
    if (!row) throw notFound('Betrieb');
    await recordEvent(db, { tenantId: id, type: 'tenant.updated', actor: userActor(a), summary: `Betrieb geändert: ${Object.entries(body).map(([k, v]) => `${k}=${v}`).join(', ')}` });
    return { id: row.id, status: row.status, plan: row.plan };
  });

  app.get('/admin/industries', async (req) => {
    if (!auth(req).isPlatformAdmin) throw forbidden();
    return { industries: INDUSTRIES, plans: PLANS };
  });

  // Team logins of the current business.
  app.post('/settings/team/users', async (req, reply) => {
    const a = requireRole(req, ['owner', 'admin']);
    const body = parse(person.extend({ role: z.enum(['admin', 'staff']) }), req.body);
    const access = await grantAccess(a.tenantId, body, body.role);
    // Logins can be booked like any other staff member when they are linked to one.
    const [staff] = await db
      .select()
      .from(staffMembers)
      .where(and(eq(staffMembers.tenantId, a.tenantId), eq(staffMembers.name, body.name)));
    if (staff && !staff.userId) await db.update(staffMembers).set({ userId: access.userId }).where(eq(staffMembers.id, staff.id));
    await recordEvent(db, { tenantId: a.tenantId, type: 'user.invited', actor: userActor(a), summary: `Zugang für ${body.name} angelegt (${body.role === 'admin' ? 'Admin' : 'Mitarbeiter'})` });
    return reply.status(201).send({ userId: access.userId, email: body.email, startPassword: access.startPassword });
  });

  app.patch('/settings/team/users/:userId', async (req) => {
    const a = requireRole(req, ['owner']);
    const { userId } = req.params as { userId: string };
    const { role } = parse(z.object({ role: z.enum(['owner', 'admin', 'staff']) }), req.body);
    if (userId === a.userId) throw badRequest('Die eigene Rolle kann man nicht selbst ändern.');
    const [row] = await db.update(memberships).set({ role }).where(and(eq(memberships.tenantId, a.tenantId), eq(memberships.userId, userId))).returning();
    if (!row) throw notFound('Zugang');
    return { ok: true, role };
  });

  app.delete('/settings/team/users/:userId', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { userId } = req.params as { userId: string };
    if (userId === a.userId) throw badRequest('Den eigenen Zugang kann man nicht selbst entfernen.');
    const [m] = await db.select().from(memberships).where(and(eq(memberships.tenantId, a.tenantId), eq(memberships.userId, userId)));
    if (!m) throw notFound('Zugang');
    if (m.role === 'owner' && a.role !== 'owner') throw forbidden();
    await db.delete(memberships).where(and(eq(memberships.tenantId, a.tenantId), eq(memberships.userId, userId)));
    await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.tenantId, a.tenantId)));
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await recordEvent(db, { tenantId: a.tenantId, type: 'user.removed', actor: userActor(a), summary: `Zugang von ${u?.name ?? 'Nutzer'} entfernt` });
    return { ok: true };
  });
}
