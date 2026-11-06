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
import { authRoutes, restrictionFor, SESSION_COOKIE, SESSION_IDLE_MS } from './routes/auth.js';
import { crmRoutes } from './routes/crm.js';
import { inboxRoutes } from './routes/inbox.js';
import { schedulingRoutes } from './routes/scheduling.js';
import { systemRoutes } from './routes/system.js';
import { voiceRoutes } from './routes/voice.js';
import { webhookRoutes } from './routes/webhooks.js';
import { googleRoutes } from './routes/google.js';
import { adminRoutes } from './routes/admin.js';
import { marketingRoutes } from './routes/marketing.js';
import { publicRoutes } from './routes/public.js';
import { setPublicUrl } from './services/automations.js';

/** What a restricted session may still do (see restrictionFor). */
const RESTRICTED_ALLOWED = new Set([
  'GET /api/auth/me',
  'POST /api/auth/logout',
  'POST /api/auth/logout-all',
  'POST /api/auth/password',
  'POST /api/auth/mfa/setup',
  'POST /api/auth/mfa/enable',
]);

export const redactUrl = (url: string) => url.split('?')[0].replace(/\/wh_[^/]+/g, '/wh_[redacted]');

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
  const app = Fastify({
    // Request logs keep only the path: query strings carry signed links and OAuth codes, and the
    // WhatsApp webhook path carries its secret, none of which belong in server logs.
    logger: opts.logger
      ? {
          serializers: {
            req: (req) => ({ method: req.method, url: redactUrl(req.url), remoteAddress: req.ip }),
          },
        }
      : false,
    trustProxy: true,
    bodyLimit: 1_000_000,
  });
  app.decorate('db', opts.db);
  app.decorate('publicUrl', opts.publicUrl);
  setPublicUrl(opts.publicUrl);
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
  // A session ends 14 days after login or after SESSION_IDLE_MS without requests.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/voice/')) return;
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const now = new Date();
    const [row] = await opts.db
      .select({
        sessionId: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        userId: users.id,
        userName: users.name,
        isPlatformAdmin: users.isPlatformAdmin,
        mustChangePassword: users.mustChangePassword,
        mfaEnabledAt: users.mfaEnabledAt,
        tenantId: sessions.tenantId,
        role: memberships.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .leftJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.tenantId, sessions.tenantId)))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, now), gt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_IDLE_MS))));
    // Platform admins may open any tenant for support; they act there with owner rights.
    if (!row || !(row.role || row.isPlatformAdmin)) return;
    // Recording activity at most every five minutes keeps writes low.
    if (now.getTime() - row.lastSeenAt.getTime() > 5 * 60_000) {
      await opts.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
    }
    const restriction = restrictionFor(row, row.role);
    req.auth = {
      userId: row.userId,
      userName: row.userName,
      isPlatformAdmin: row.isPlatformAdmin,
      tenantId: row.tenantId,
      role: row.role ?? 'owner',
      support: !row.role,
      restriction,
    };
    // Until the start password is changed or two-factor login is set up, only those steps work.
    const path = req.url.split('?')[0];
    if (restriction && !RESTRICTED_ALLOWED.has(`${req.method} ${path}`)) {
      return reply.status(403).send({
        error: restriction === 'password_change' ? 'password_change_required' : 'mfa_setup_required',
        message:
          restriction === 'password_change'
            ? 'Bitte zuerst ein eigenes Passwort festlegen.'
            : 'Bitte zuerst die Zwei-Faktor-Anmeldung einrichten.',
      });
    }
  });

  // Basic CSRF protection for cookie-authenticated writes: browsers always send Origin on
  // cross-site POST/PATCH/DELETE, so reject any whose origin isn't this host.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.url.startsWith('/api/voice/')) return;
    const origin = req.headers.origin;
    if (!origin) return;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (URL.parse(origin)?.host !== host) {
      return reply.status(403).send({ error: 'forbidden', message: 'Ungültige Herkunft der Anfrage.' });
    }
  });

  // Browser hardening for every response: no framing (clickjacking), no MIME sniffing, no
  // full URLs leaking to other sites, and HTTPS only once the site runs on HTTPS.
  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    // Only our own scripts, styles, images and fonts load; injected markup can't run code or post elsewhere.
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
      );
    }
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (opts.cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000');
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
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(marketingRoutes, { prefix: '/api' });
  await app.register(publicRoutes, { prefix: '/api/public' });

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
