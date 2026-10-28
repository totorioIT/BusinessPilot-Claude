import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { asc, inArray } from 'drizzle-orm';
import { memberships, sessions, tenants, users } from '../db/schema.js';
import { hashPassword, newToken, sha256, verifyPassword } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, parse, userActor } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';

export const SESSION_COOKIE = 'bp_session';
const SESSION_DAYS = 14;

// Guessing one account's password from many IPs is stopped per e-mail address: after
// MAX_FAILURES wrong passwords the account refuses logins until the window has passed.
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { count: number; since: number }>();
const lockedOut = (email: string) => {
  const f = failures.get(email);
  if (f && Date.now() - f.since > FAILURE_WINDOW_MS) failures.delete(email);
  return (failures.get(email)?.count ?? 0) >= MAX_FAILURES;
};
const recordFailure = (email: string) => {
  const f = failures.get(email) ?? { count: 0, since: Date.now() };
  failures.set(email, { ...f, count: f.count + 1 });
  // Bounded memory: the oldest entries go first.
  if (failures.size > 10_000) failures.delete(failures.keys().next().value!);
};
/** Checked against when the e-mail is unknown, so the answer takes as long as for a real account. */
const dummyHash = hashPassword(newToken());

async function me(app: FastifyInstance, userId: string, tenantId: string) {
  const [user] = await app.db.select().from(users).where(eq(users.id, userId));
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, tenantId));
  const own = await app.db
    .select({ tenantId: memberships.tenantId, role: memberships.role, name: tenants.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(tenants.name));
  const current = own.find((m) => m.tenantId === tenantId);
  return {
    user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
    tenant: { id: tenant.id, name: tenant.name, industry: tenant.industry, timezone: tenant.timezone },
    role: current?.role ?? 'owner',
    /** True while a platform admin looks at a tenant they don't belong to. */
    support: !current,
    /** The tenants this user belongs to, for switching between them. */
    tenants: own.map((m) => ({ id: m.tenantId, name: m.name, role: m.role })),
    ai: { name: tenant.aiSettings.name },
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }), req.body);
      if (lockedOut(body.email)) throw new HttpError(429, 'locked', 'Zu viele falsche Versuche. Bitte in 15 Minuten erneut versuchen.');
      const [user] = await app.db.select().from(users).where(eq(users.email, body.email));
      const valid = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash));
      if (!user || !valid) {
        recordFailure(body.email);
        throw new HttpError(401, 'invalid_credentials', 'E-Mail oder Passwort ist falsch.');
      }
      failures.delete(body.email);
      // Owners land in their own business first; someone in several businesses can switch later.
      const all = await app.db.select().from(memberships).where(eq(memberships.userId, user.id));
      const rank = { owner: 0, admin: 1, staff: 2 };
      const [membership] = all.sort((a, b) => rank[a.role] - rank[b.role] || a.tenantId.localeCompare(b.tenantId));
      if (!membership) throw new HttpError(403, 'no_tenant', 'Ihr Zugang ist noch keinem Betrieb zugeordnet.');

      const token = newToken();
      await app.db.insert(sessions).values({
        id: sha256(token),
        userId: user.id,
        tenantId: membership.tenantId,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000),
      });
      await recordEvent(app.db, {
        tenantId: membership.tenantId,
        type: 'user.login',
        actor: { type: 'user', id: user.id, name: user.name },
        summary: `${user.name} hat sich angemeldet`,
      });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: app.cookieSecure,
        path: '/',
        maxAge: SESSION_DAYS * 86400,
      });
      return me(app, user.id, membership.tenantId);
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await app.db.delete(sessions).where(eq(sessions.id, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const a = auth(req);
    return me(app, a.userId, a.tenantId);
  });

  /** Switch the session to another business: one the user belongs to, or any for a platform admin. */
  app.post('/auth/tenant', async (req) => {
    const a = auth(req);
    const { tenantId } = parse(z.object({ tenantId: z.string().min(1) }), req.body);
    const [tenant] = await app.db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw notFound('Betrieb');
    const [membership] = await app.db.select().from(memberships).where(and(eq(memberships.userId, a.userId), eq(memberships.tenantId, tenantId)));
    if (!membership && !a.isPlatformAdmin) throw forbidden();
    const token = req.cookies[SESSION_COOKIE]!;
    await app.db.update(sessions).set({ tenantId }).where(eq(sessions.id, sha256(token)));
    if (!membership) {
      // Support access is visible to the business in its activity log.
      await recordEvent(app.db, {
        tenantId,
        type: 'support.access',
        actor: userActor(a),
        summary: `Support-Zugriff durch ${a.userName} (BusinessPilot)`,
      });
    }
    return me(app, a.userId, tenantId);
  });

  app.post('/auth/password', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const a = auth(req);
    const body = parse(z.object({ current: z.string().min(1).max(200), next: z.string().min(10, 'Das neue Passwort braucht mindestens 10 Zeichen.').max(200) }), req.body);
    const [user] = await app.db.select().from(users).where(eq(users.id, a.userId));
    if (!(await verifyPassword(body.current, user.passwordHash))) throw new HttpError(400, 'wrong_password', 'Das aktuelle Passwort stimmt nicht.');
    await app.db.update(users).set({ passwordHash: await hashPassword(body.next) }).where(eq(users.id, a.userId));
    // Other devices have to sign in again with the new password.
    const token = req.cookies[SESSION_COOKIE]!;
    const others = await app.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, a.userId));
    const keep = sha256(token);
    const drop = others.map((o) => o.id).filter((id) => id !== keep);
    if (drop.length) await app.db.delete(sessions).where(inArray(sessions.id, drop));
    return { ok: true };
  });
}
