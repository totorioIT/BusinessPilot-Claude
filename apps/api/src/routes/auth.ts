import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { authTokens, memberships, sessions, tenants, users } from '../db/schema.js';
import { hashPassword, needsRehash, newToken, sha256, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, parse, userActor, type AuthContext } from '../lib/http.js';
import { canEncrypt } from '../lib/secretbox.js';
import { newMfaSetup, newRecoveryCodes, useRecoveryCode, verifyTotp } from '../services/mfa.js';
import { assertAcceptablePassword, MAX_PASSWORD_LENGTH } from '../services/password-policy.js';
import { systemMailer } from '../services/system-email.js';

export const SESSION_COOKIE = 'bp_session';
/** Absolute lifetime of a session. */
const SESSION_DAYS = 14;
/** A session ends after this long without any request. */
export const SESSION_IDLE_MS = 8 * 60 * 60_000;
/** Time to enter the second factor after the password. */
const MFA_CHALLENGE_MS = 5 * 60_000;
const MFA_MAX_ATTEMPTS = 5;
const RESET_VALID_MS = 30 * 60_000;
/** At most one reset mail per account in this time, so nobody floods an inbox. */
const RESET_COOLDOWN_MS = 2 * 60_000;

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

type UserRow = typeof users.$inferSelect;

/** Two-factor login is required for platform admins and owners (switch off only for tests). */
export const mfaEnforced = () => process.env.MFA_ENFORCE !== 'false';
const mfaRequiredFor = (u: { isPlatformAdmin: boolean }, role: string | null) => mfaEnforced() && (u.isPlatformAdmin || role === 'owner');

/** What a person has to do before they may use the app. */
export function restrictionFor(u: { mustChangePassword: boolean; mfaEnabledAt: Date | null; isPlatformAdmin: boolean }, role: string | null): AuthContext['restriction'] {
  if (u.mustChangePassword) return 'password_change';
  if (!u.mfaEnabledAt && mfaRequiredFor(u, role)) return 'mfa_setup';
  return null;
}

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
  const role = current?.role ?? 'owner';
  return {
    user: { id: user.id, name: user.name, email: user.email, isPlatformAdmin: user.isPlatformAdmin },
    tenant: { id: tenant.id, name: tenant.name, industry: tenant.industry, timezone: tenant.timezone },
    role,
    /** True while a platform admin looks at a tenant they don't belong to. */
    support: !current,
    /** The tenants this user belongs to, for switching between them. */
    tenants: own.map((m) => ({ id: m.tenantId, name: m.name, role: m.role })),
    ai: { name: tenant.aiSettings.name },
    security: {
      mfaEnabled: Boolean(user.mfaEnabledAt),
      mfaRequired: mfaRequiredFor(user, current?.role ?? null),
      recoveryCodesLeft: user.mfaRecoveryCodes.length,
      /** Set while the person must first change the start password or set up two-factor login. */
      restriction: restrictionFor(user, current?.role ?? null),
    },
  };
}

export async function authRoutes(app: FastifyInstance) {
  const db = app.db;

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.cookieSecure,
      path: '/',
      maxAge: SESSION_DAYS * 86400,
    });

  /** A fresh random token for every login and every change of rights (no session fixation). */
  const startSession = async (reply: FastifyReply, userId: string, tenantId: string) => {
    const token = newToken();
    await db.insert(sessions).values({ id: sha256(token), userId, tenantId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) });
    setSessionCookie(reply, token);
    return token;
  };

  /** Owners land in their own business first; someone in several businesses can switch later. */
  const homeTenant = async (userId: string) => {
    const all = await db.select().from(memberships).where(eq(memberships.userId, userId));
    const rank = { owner: 0, admin: 1, staff: 2 };
    const [m] = all.sort((a, b) => rank[a.role] - rank[b.role] || a.tenantId.localeCompare(b.tenantId));
    if (!m) throw new HttpError(403, 'no_tenant', 'Ihr Zugang ist noch keinem Betrieb zugeordnet.');
    return m.tenantId;
  };

  const finishLogin = async (reply: FastifyReply, user: UserRow, how: string) => {
    const tenantId = await homeTenant(user.id);
    await startSession(reply, user.id, tenantId);
    await recordEvent(db, { tenantId, type: 'user.login', actor: { type: 'user', id: user.id, name: user.name }, summary: `${user.name} hat sich angemeldet${how}` });
    return me(app, user.id, tenantId);
  };

  const dropSessions = async (userId: string, keepToken?: string) => {
    const keep = keepToken ? sha256(keepToken) : null;
    const all = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId));
    const drop = all.map((s) => s.id).filter((id) => id !== keep);
    if (drop.length) await db.delete(sessions).where(inArray(sessions.id, drop));
  };

  const currentToken = (req: { cookies: Record<string, string | undefined> }) => req.cookies[SESSION_COOKIE]!;

  const tenantEvent = async (userId: string, type: string, summary: string, actor?: AuthContext) => {
    const [m] = await db.select({ tenantId: memberships.tenantId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
    const tenantId = actor?.tenantId ?? m?.tenantId;
    if (!tenantId) return;
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await recordEvent(db, { tenantId, type, actor: actor ? userActor(actor) : { type: 'user', id: userId, name: u?.name ?? null }, summary });
  };

  app.post('/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(MAX_PASSWORD_LENGTH) }), req.body);
    if (lockedOut(body.email)) throw new HttpError(429, 'locked', 'Zu viele falsche Versuche. Bitte in 15 Minuten erneut versuchen.');
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    const valid = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !valid) {
      recordFailure(body.email);
      throw new HttpError(401, 'invalid_credentials', 'E-Mail oder Passwort ist falsch.');
    }
    failures.delete(body.email);
    // Older accounts move to Argon2id with the password they just typed.
    if (needsRehash(user.passwordHash)) await db.update(users).set({ passwordHash: await hashPassword(body.password) }).where(eq(users.id, user.id));

    if (user.mfaEnabledAt && user.mfaSecret) {
      // The password was right; the session only starts after the second factor.
      const challenge = newToken();
      await db.delete(authTokens).where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, 'mfa_login')));
      await db.insert(authTokens).values({ id: sha256(challenge), userId: user.id, purpose: 'mfa_login', expiresAt: new Date(Date.now() + MFA_CHALLENGE_MS) });
      return { mfaRequired: true, challenge };
    }
    return finishLogin(reply, user, '');
  });

  app.post('/auth/mfa/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = parse(z.object({ challenge: z.string().min(10).max(200), code: z.string().trim().min(6).max(20) }), req.body);
    const [token] = await db
      .select()
      .from(authTokens)
      .where(and(eq(authTokens.id, sha256(body.challenge)), eq(authTokens.purpose, 'mfa_login'), gt(authTokens.expiresAt, new Date())));
    if (!token) throw new HttpError(401, 'challenge_expired', 'Die Anmeldung ist abgelaufen. Bitte erneut mit E-Mail und Passwort anmelden.');
    const [user] = await db.select().from(users).where(eq(users.id, token.userId));
    if (!user?.mfaSecret) throw new HttpError(401, 'challenge_expired', 'Die Anmeldung ist abgelaufen. Bitte erneut mit E-Mail und Passwort anmelden.');
    // Each challenge allows only a few tries, but someone with the password could fetch new ones:
    // wrong codes therefore also count per account, across all challenges.
    const mfaKey = `mfa:${user.id}`;
    if (lockedOut(mfaKey)) throw new HttpError(429, 'locked', 'Zu viele falsche Versuche. Bitte in 15 Minuten erneut versuchen.');

    const step = await verifyTotp(user.mfaSecret, body.code, user.mfaLastStep);
    let how = ' (mit Zwei-Faktor-Code)';
    if (step !== null) {
      // Only one request can use a time step, even when two arrive at the same moment.
      const [won] = await db
        .update(users)
        .set({ mfaLastStep: step })
        .where(and(eq(users.id, user.id), or(isNull(users.mfaLastStep), lt(users.mfaLastStep, step))))
        .returning({ id: users.id });
      if (!won) throw new HttpError(401, 'invalid_code', 'Der Code ist falsch oder wurde schon benutzt.');
    } else {
      const remaining = useRecoveryCode(user.mfaRecoveryCodes, body.code);
      if (!remaining) {
        recordFailure(mfaKey);
        const attempts = token.attempts + 1;
        if (attempts >= MFA_MAX_ATTEMPTS) await db.delete(authTokens).where(eq(authTokens.id, token.id));
        else await db.update(authTokens).set({ attempts }).where(eq(authTokens.id, token.id));
        throw new HttpError(401, 'invalid_code', 'Der Code ist falsch oder wurde schon benutzt.');
      }
      await db.update(users).set({ mfaRecoveryCodes: remaining }).where(eq(users.id, user.id));
      how = ` (mit Wiederherstellungscode, noch ${remaining.length} übrig)`;
    }
    failures.delete(mfaKey);
    await db.delete(authTokens).where(eq(authTokens.id, token.id));
    return finishLogin(reply, user, how);
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Ends every session of this person, on all devices. */
  app.post('/auth/logout-all', async (req, reply) => {
    const a = auth(req);
    await db.delete(sessions).where(eq(sessions.userId, a.userId));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    await recordEvent(db, { tenantId: a.tenantId, type: 'user.logout_all', actor: userActor(a), summary: `${a.userName} hat sich auf allen Geräten abgemeldet` });
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const a = auth(req);
    return me(app, a.userId, a.tenantId);
  });

  /** Switch the session to another business: one the user belongs to, or any for a platform admin. */
  app.post('/auth/tenant', async (req, reply) => {
    const a = auth(req);
    const { tenantId } = parse(z.object({ tenantId: z.string().min(1) }), req.body);
    const [tenant] = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw notFound('Betrieb');
    const [membership] = await db.select().from(memberships).where(and(eq(memberships.userId, a.userId), eq(memberships.tenantId, tenantId)));
    if (!membership && !a.isPlatformAdmin) throw forbidden();
    // Other rights, new token.
    await db.delete(sessions).where(eq(sessions.id, sha256(currentToken(req))));
    await startSession(reply, a.userId, tenantId);
    if (!membership) {
      // Support access is visible to the business in its activity log.
      await recordEvent(db, {
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
    const body = parse(z.object({ current: z.string().min(1).max(MAX_PASSWORD_LENGTH), next: z.string().min(1).max(MAX_PASSWORD_LENGTH) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, a.userId));
    if (!(await verifyPassword(body.current, user.passwordHash))) throw new HttpError(400, 'wrong_password', 'Das aktuelle Passwort stimmt nicht.');
    if (body.next === body.current) throw badRequest('Das neue Passwort muss sich vom bisherigen unterscheiden.', 'weak_password');
    await assertAcceptablePassword(body.next, { email: user.email, name: user.name });
    await db.update(users).set({ passwordHash: await hashPassword(body.next), mustChangePassword: false }).where(eq(users.id, a.userId));
    // Other devices have to sign in again with the new password.
    await dropSessions(a.userId, currentToken(req));
    await recordEvent(db, { tenantId: a.tenantId, type: 'user.password_changed', actor: userActor(a), summary: `${a.userName} hat das Passwort geändert` });
    return me(app, a.userId, a.tenantId);
  });

  // Password reset ("Passwort vergessen"). The answer is the same whether the address exists or
  // not, so nobody can find out who has an account.
  app.post('/auth/password-reset/request', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ email: z.string().trim().toLowerCase().email().max(200) }), req.body);
    const done = { ok: true, message: 'Wenn ein Konto mit dieser Adresse besteht, haben wir eine E-Mail mit einem Link geschickt.' };
    const [user] = await db.select().from(users).where(eq(users.email, body.email));
    if (!user) return done;
    const [recent] = await db
      .select({ id: authTokens.id })
      .from(authTokens)
      .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, 'password_reset'), gt(authTokens.createdAt, new Date(Date.now() - RESET_COOLDOWN_MS))));
    if (recent) return done;
    const token = newToken();
    // Only the newest link works.
    await db.delete(authTokens).where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, 'password_reset')));
    await db.insert(authTokens).values({ id: sha256(token), userId: user.id, purpose: 'password_reset', expiresAt: new Date(Date.now() + RESET_VALID_MS) });
    const url = `${app.publicUrl}/passwort-zuruecksetzen#${token}`;
    const mailer = await systemMailer(db, user.id);
    const res = await mailer.send({
      to: user.email,
      fromName: 'BusinessPilot',
      subject: 'Passwort zurücksetzen',
      text:
        `Hallo ${user.name},\n\nfür Ihr BusinessPilot-Konto wurde ein neues Passwort angefordert. Mit diesem Link legen Sie es fest:\n${url}\n\n` +
        `Der Link ist 30 Minuten gültig und funktioniert nur einmal. Wenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt dann unverändert.\n\nIhr BusinessPilot-Team`,
    });
    if (!res.ok) req.log.error({ reason: res.error }, 'Passwort-Reset-Mail konnte nicht gesendet werden');
    await tenantEvent(user.id, 'user.password_reset_requested', `Passwort-Zurücksetzen für ${user.name} angefordert`);
    return done;
  });

  app.post('/auth/password-reset/confirm', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const body = parse(z.object({ token: z.string().min(10).max(200), password: z.string().min(1).max(MAX_PASSWORD_LENGTH) }), req.body);
    const id = sha256(body.token);
    const [token] = await db.select().from(authTokens).where(and(eq(authTokens.id, id), eq(authTokens.purpose, 'password_reset'), gt(authTokens.expiresAt, new Date())));
    if (!token) throw badRequest('Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.', 'invalid_token');
    const [user] = await db.select().from(users).where(eq(users.id, token.userId));
    await assertAcceptablePassword(body.password, { email: user.email, name: user.name });
    // Single use: whoever deletes the token first may set the password.
    const [used] = await db.delete(authTokens).where(eq(authTokens.id, id)).returning({ id: authTokens.id });
    if (!used) throw badRequest('Der Link ist ungültig oder abgelaufen. Bitte fordern Sie einen neuen an.', 'invalid_token');
    await db.update(users).set({ passwordHash: await hashPassword(body.password), mustChangePassword: false }).where(eq(users.id, user.id));
    await dropSessions(user.id);
    failures.delete(user.email);
    await tenantEvent(user.id, 'user.password_reset', `Passwort von ${user.name} über den E-Mail-Link neu gesetzt`);
    return { ok: true };
  });

  // Two-factor login: set up, switch on, new recovery codes, switch off.
  app.post('/auth/mfa/setup', async (req) => {
    const a = auth(req);
    if (!canEncrypt()) throw badRequest('Auf dem Server fehlt APP_SECRET, deshalb kann die Zwei-Faktor-Anmeldung nicht eingerichtet werden.');
    const [user] = await db.select().from(users).where(eq(users.id, a.userId));
    if (user.mfaEnabledAt) throw conflict('mfa_enabled', 'Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet.');
    const setup = await newMfaSetup(user.email);
    await db.update(users).set({ mfaPendingSecret: setup.encrypted }).where(eq(users.id, a.userId));
    return { secret: setup.secret, uri: setup.uri, qrSvg: setup.qrSvg };
  });

  app.post('/auth/mfa/enable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const a = auth(req);
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, a.userId));
    if (user.mfaEnabledAt) throw conflict('mfa_enabled', 'Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet.');
    if (!user.mfaPendingSecret) throw badRequest('Bitte zuerst den QR-Code anzeigen lassen.', 'mfa_not_started');
    const step = await verifyTotp(user.mfaPendingSecret, code, null);
    if (step === null) throw badRequest('Der Code passt nicht. Bitte den aktuellen Code aus der App eingeben.', 'invalid_code');
    const recovery = newRecoveryCodes();
    await db
      .update(users)
      .set({ mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryCodes: recovery.hashes })
      .where(eq(users.id, a.userId));
    // Sessions from before were opened with the password alone.
    await dropSessions(a.userId);
    await startSession(reply, a.userId, a.tenantId);
    await recordEvent(db, { tenantId: a.tenantId, type: 'user.mfa_enabled', actor: userActor(a), summary: `${a.userName} hat die Zwei-Faktor-Anmeldung eingeschaltet` });
    return { recoveryCodes: recovery.codes, me: await me(app, a.userId, a.tenantId) };
  });

  const requireCurrentCode = async (user: UserRow, code: string) => {
    const step = user.mfaSecret ? await verifyTotp(user.mfaSecret, code, user.mfaLastStep) : null;
    if (step === null) throw badRequest('Der Code passt nicht. Bitte den aktuellen Code aus der App eingeben.', 'invalid_code');
    await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
  };

  app.post('/auth/mfa/recovery-codes', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const a = auth(req);
    const { code } = parse(z.object({ code: z.string().trim().min(6).max(10) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, a.userId));
    if (!user.mfaEnabledAt) throw badRequest('Die Zwei-Faktor-Anmeldung ist nicht eingeschaltet.');
    await requireCurrentCode(user, code);
    const recovery = newRecoveryCodes();
    await db.update(users).set({ mfaRecoveryCodes: recovery.hashes }).where(eq(users.id, a.userId));
    await recordEvent(db, { tenantId: a.tenantId, type: 'user.mfa_recovery_renewed', actor: userActor(a), summary: `${a.userName} hat neue Wiederherstellungscodes erzeugt` });
    return { recoveryCodes: recovery.codes };
  });

  app.post('/auth/mfa/disable', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const a = auth(req);
    const body = parse(z.object({ password: z.string().min(1).max(MAX_PASSWORD_LENGTH), code: z.string().trim().min(6).max(10) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, a.userId));
    if (!user.mfaEnabledAt) throw badRequest('Die Zwei-Faktor-Anmeldung ist nicht eingeschaltet.');
    if (mfaRequiredFor(user, a.support ? null : a.role)) throw forbidden();
    if (!(await verifyPassword(body.password, user.passwordHash))) throw new HttpError(400, 'wrong_password', 'Das Passwort stimmt nicht.');
    await requireCurrentCode(user, body.code);
    await db.update(users).set({ mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryCodes: [] }).where(eq(users.id, a.userId));
    await recordEvent(db, { tenantId: a.tenantId, type: 'user.mfa_disabled', actor: userActor(a), summary: `${a.userName} hat die Zwei-Faktor-Anmeldung ausgeschaltet` });
    return me(app, a.userId, a.tenantId);
  });
}
