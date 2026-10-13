import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { memberships, sessions, tenants, users } from '../db/schema.js';
import { newToken, sha256, verifyPassword } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, parse } from '../lib/http.js';

export const SESSION_COOKIE = 'bp_session';
const SESSION_DAYS = 14;

async function me(app: FastifyInstance, userId: string, tenantId: string) {
  const [row] = await app.db
    .select({ user: users, tenant: tenants, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(memberships.tenantId, tenantId)));
  return {
    user: { id: row.user.id, name: row.user.name, email: row.user.email, isPlatformAdmin: row.user.isPlatformAdmin },
    tenant: { id: row.tenant.id, name: row.tenant.name, industry: row.tenant.industry, timezone: row.tenant.timezone },
    role: row.role,
    ai: { name: row.tenant.aiSettings.name },
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }), req.body);
      const [user] = await app.db.select().from(users).where(eq(users.email, body.email));
      const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
      if (!user || !valid) throw new HttpError(401, 'invalid_credentials', 'E-Mail oder Passwort ist falsch.');
      const [membership] = await app.db.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
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
}
