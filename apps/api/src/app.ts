import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { and, eq, gt } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Db } from './db/client.js';
import { memberships, sessions, users } from './db/schema.js';
import { sha256 } from './lib/crypto.js';
import { HttpError } from './lib/errors.js';
import { authRoutes, SESSION_COOKIE } from './routes/auth.js';
import { crmRoutes } from './routes/crm.js';
import { inboxRoutes } from './routes/inbox.js';
import { schedulingRoutes } from './routes/scheduling.js';
import { systemRoutes } from './routes/system.js';
import { voiceRoutes } from './routes/voice.js';
import { webhookRoutes } from './routes/webhooks.js';
import { googleRoutes } from './routes/google.js';

export type AppOptions = {
  db: Db;
  publicUrl: string;
  cookieSecure: boolean;
  dashboardDist?: string;
  logger?: boolean;
};

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    publicUrl: string;
    cookieSecure: boolean;
  }
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 1_000_000 });
  app.decorate('db', opts.db);
  app.decorate('publicUrl', opts.publicUrl);
  app.decorate('cookieSecure', opts.cookieSecure);
  app.decorateRequest('auth', null);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    const e = err as { statusCode?: number; validation?: unknown; message: string };
    if (e.statusCode === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Zu viele Versuche. Bitte warten Sie einen Moment.' });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: 'bad_request', message: e.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.' });
  });

  // Resolve the session cookie on every /api request; routes call auth(req) to require it.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/voice/')) return;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const [row] = await opts.db
      .select({
        userId: users.id,
        userName: users.name,
        isPlatformAdmin: users.isPlatformAdmin,
        tenantId: sessions.tenantId,
        role: memberships.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.tenantId, sessions.tenantId)))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())));
    if (row) req.auth = row;
  });

  // Basic CSRF protection for cookie-authenticated writes: browsers always send Origin on
  // cross-site POST/PATCH/DELETE, so reject any whose origin isn't this host.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.url.startsWith('/api/voice/')) return;
    const origin = req.headers.origin;
    if (!origin) return;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (new URL(origin).host !== host) {
      return reply.status(403).send({ error: 'forbidden', message: 'Ungültige Herkunft der Anfrage.' });
    }
  });

  app.get('/api/health', async () => ({ ok: true, version: process.env.GIT_COMMIT ?? 'dev' }));

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(crmRoutes, { prefix: '/api' });
  await app.register(inboxRoutes, { prefix: '/api' });
  await app.register(schedulingRoutes, { prefix: '/api' });
  await app.register(systemRoutes, { prefix: '/api' });
  await app.register(voiceRoutes, { prefix: '/api/voice' });
  await app.register(webhookRoutes, { prefix: '/api/webhooks' });
  await app.register(googleRoutes, { prefix: '/api' });

  if (opts.dashboardDist && existsSync(opts.dashboardDist)) {
    await app.register(fastifyStatic, { root: path.resolve(opts.dashboardDist), wildcard: false });
    // Single-page app: unknown non-API paths return index.html so client routing works on reload.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not_found', message: 'Nicht gefunden.' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
