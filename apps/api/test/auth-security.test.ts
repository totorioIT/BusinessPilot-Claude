import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { generate } from 'otplib';
import * as s from '../src/db/schema.js';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../src/db/seed.js';
import { sandboxLog } from '../src/providers/sandbox.js';
import { setup } from './helpers.js';

// Two-factor login is enforced here, as in production.
process.env.MFA_ENFORCE = 'true';
process.env.APP_SECRET = 'test-secret-with-at-least-32-characters!';

let t: Awaited<ReturnType<typeof setup>>;
before(async () => {
  t = await setup();
});
after(async () => {
  await t.close();
});

type Res = Awaited<ReturnType<typeof t.app.inject>>;
const cookieOf = (res: Res) => {
  const c = res.cookies.find((x) => x.name === 'bp_session');
  return c?.value ? `bp_session=${c.value}` : '';
};
// Each request from its own address, so the per-IP rate limits (tested elsewhere) stay out of the way.
let ip = 0;
const nextIp = () => `10.9.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`;
const post = (url: string, payload: object, cookie = '') =>
  t.app.inject({ method: 'POST', url: `/api${url}`, payload, headers: cookie ? { cookie } : {}, remoteAddress: nextIp() });
const get = (url: string, cookie: string) => t.app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie }, remoteAddress: nextIp() });
const mailsTo = (from: number, to: string) =>
  sandboxLog.slice(from).filter((e) => e.provider === 'email' && (e.payload as { to: string }).to === to) as { payload: { subject: string; text: string } }[];

const userByEmail = async (email: string) => (await t.db.select().from(s.users).where(eq(s.users.email, email)))[0];

describe('passwords', () => {
  it('are stored with Argon2id, and old scrypt hashes are replaced at the next login', async () => {
    const demo = await userByEmail(DEMO_EMAIL);
    assert.match(demo.passwordHash, /^\$argon2id\$/);

    // A hash in the format used before Argon2id (scrypt, password "Altes-Passwort-2025").
    const legacy = 'scrypt$c2FsdHNhbHRzYWx0c2FsdA==$';
    const { scryptSync } = await import('node:crypto');
    const hash = scryptSync('Altes-Passwort-2025', Buffer.from('c2FsdHNhbHRzYWx0c2FsdA==', 'base64'), 64).toString('base64');
    await t.db.insert(s.users).values({ id: 'usr_legacy', email: 'alt@example.de', name: 'Alt Konto', passwordHash: legacy + hash });
    await t.db.insert(s.memberships).values({ userId: 'usr_legacy', tenantId: t.tenantId, role: 'staff' });
    const res = await post('/auth/login', { email: 'alt@example.de', password: 'Altes-Passwort-2025' });
    assert.equal(res.statusCode, 200);
    assert.match((await userByEmail('alt@example.de')).passwordHash, /^\$argon2id\$/);
    assert.equal((await post('/auth/login', { email: 'alt@example.de', password: 'Altes-Passwort-2025' })).statusCode, 200);
  });

  it('refuses short and leaked passwords', async () => {
    const cookie = cookieOf(await post('/auth/login', { email: 'alt@example.de', password: 'Altes-Passwort-2025' }));
    const short = await post('/auth/password', { current: 'Altes-Passwort-2025', next: 'kurz12345' }, cookie);
    assert.equal(short.statusCode, 400);
    assert.equal(short.json().error, 'weak_password');
    const leaked = await post('/auth/password', { current: 'Altes-Passwort-2025', next: 'Passwort123456!' }, cookie);
    assert.equal(leaked.statusCode, 400);
    assert.equal(leaked.json().error, 'breached_password');
    const withEmail = await post('/auth/password', { current: 'Altes-Passwort-2025', next: 'alt@example.de' }, cookie);
    assert.equal(withEmail.statusCode, 400);
  });
});

describe('password reset', () => {
  it('answers the same for unknown addresses and sends nothing', async () => {
    const before = sandboxLog.length;
    const res = await post('/auth/password-reset/request', { email: 'niemand@example.de' });
    assert.equal(res.statusCode, 200);
    const known = await post('/auth/password-reset/request', { email: 'alt@example.de' });
    assert.equal(known.json().message, res.json().message);
    assert.equal(mailsTo(before, 'niemand@example.de').length, 0);
  });

  it('sets a new password once with the link, ends all sessions, and the link cannot be reused', async () => {
    const session = cookieOf(await post('/auth/login', { email: 'alt@example.de', password: 'Altes-Passwort-2025' }));
    // The request in the previous test already sent a mail; a second one within minutes sends none.
    const before = sandboxLog.length;
    await post('/auth/password-reset/request', { email: 'alt@example.de' });
    assert.equal(mailsTo(before, 'alt@example.de').length, 0, 'no second mail within the cooldown');

    const [mail] = mailsTo(0, 'alt@example.de').filter((m) => /Passwort zurücksetzen/.test(m.payload.subject));
    const token = mail.payload.text.match(/passwort-zuruecksetzen#([\w-]+)/)?.[1];
    assert.ok(token, 'link in the mail');

    const weak = await post('/auth/password-reset/confirm', { token, password: 'Sommer2026Sommer' });
    assert.equal(weak.json().error, 'breached_password');
    const ok = await post('/auth/password-reset/confirm', { token, password: 'Neu-Nach-Reset-2026' });
    assert.equal(ok.statusCode, 200);
    assert.equal((await get('/auth/me', session)).statusCode, 401, 'old sessions are signed out');
    const again = await post('/auth/password-reset/confirm', { token, password: 'Noch-Einmal-Neu-2026' });
    assert.equal(again.json().error, 'invalid_token');
    assert.equal((await post('/auth/login', { email: 'alt@example.de', password: 'Neu-Nach-Reset-2026' })).statusCode, 200);
    assert.equal((await post('/auth/login', { email: 'alt@example.de', password: 'Altes-Passwort-2025' })).statusCode, 401);
  });

  it('expired links do not work', async () => {
    await t.db.delete(s.authTokens);
    await post('/auth/password-reset/request', { email: 'alt@example.de' });
    await t.db.update(s.authTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.authTokens.purpose, 'password_reset'));
    const [mail] = mailsTo(0, 'alt@example.de').filter((m) => /Passwort zurücksetzen/.test(m.payload.subject)).slice(-1);
    const token = mail.payload.text.match(/passwort-zuruecksetzen#([\w-]+)/)![1];
    assert.equal((await post('/auth/password-reset/confirm', { token, password: 'Abgelaufen-Neu-2026' })).json().error, 'invalid_token');
  });
});

let secret = '';
let recoveryCodes: string[] = [];

describe('two-factor login', () => {
  it('is required for the platform admin before anything else works', async () => {
    const login = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().security.restriction, 'mfa_setup');
    const cookie = cookieOf(login);
    const blocked = await get('/customers', cookie);
    assert.equal(blocked.statusCode, 403);
    assert.equal(blocked.json().error, 'mfa_setup_required');

    const setupRes = await post('/auth/mfa/setup', {}, cookie);
    assert.equal(setupRes.statusCode, 200);
    secret = setupRes.json().secret;
    assert.match(setupRes.json().qrSvg, /^<svg/);
    assert.match(setupRes.json().uri, /^otpauth:\/\/totp\/BusinessPilot/);

    assert.equal((await post('/auth/mfa/enable', { code: '000000' }, cookie)).statusCode, 400);
    const enabled = await post('/auth/mfa/enable', { code: await generate({ secret }) }, cookie);
    assert.equal(enabled.statusCode, 200);
    recoveryCodes = enabled.json().recoveryCodes;
    assert.equal(recoveryCodes.length, 10);
    assert.equal(enabled.json().me.security.restriction, null);
    const fresh = cookieOf(enabled);
    assert.notEqual(fresh, cookie);
    assert.equal((await get('/auth/me', cookie)).statusCode, 401, 'the session from before is ended');
    assert.equal((await get('/customers', fresh)).statusCode, 200);

    const stored = await userByEmail(DEMO_EMAIL);
    assert.ok(stored.mfaSecret && !stored.mfaSecret.includes(secret), 'secret stored encrypted');
  });

  it('asks for the code after the password and only then starts a session', async () => {
    const login = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    assert.equal(login.json().mfaRequired, true);
    assert.equal(cookieOf(login), '', 'no session before the second factor');
    const { challenge } = login.json();

    const wrong = await post('/auth/mfa/verify', { challenge, code: '123456' });
    assert.equal(wrong.statusCode, 401);
    // The code used to switch MFA on was already used; the next period's code works.
    const next = await generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    const ok = await post('/auth/mfa/verify', { challenge, code: next });
    assert.equal(ok.statusCode, 200);
    assert.ok(cookieOf(ok));
    assert.equal((await post('/auth/mfa/verify', { challenge, code: next })).statusCode, 401, 'the challenge is single use');

    const replay = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const reused = await post('/auth/mfa/verify', { challenge: replay.json().challenge, code: next });
    assert.equal(reused.statusCode, 401, 'a code works only once');
  });

  it('accepts each recovery code once', async () => {
    const login = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const ok = await post('/auth/mfa/verify', { challenge: login.json().challenge, code: recoveryCodes[0].toUpperCase() });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.json().security.recoveryCodesLeft, 9);
    const again = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    assert.equal((await post('/auth/mfa/verify', { challenge: again.json().challenge, code: recoveryCodes[0] })).statusCode, 401);
  });

  it('drops the login attempt after five wrong codes', async () => {
    const login = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const { challenge } = login.json();
    for (let i = 0; i < 5; i++) assert.equal((await post('/auth/mfa/verify', { challenge, code: `11111${i}` })).statusCode, 401);
    const late = await post('/auth/mfa/verify', { challenge, code: recoveryCodes[1] });
    assert.equal(late.json().error, 'challenge_expired');
  });

  it('owners cannot switch it off; staff can choose', async () => {
    const login = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const ok = await post('/auth/mfa/verify', { challenge: login.json().challenge, code: recoveryCodes[2] });
    const res = await post('/auth/mfa/disable', { password: DEMO_PASSWORD, code: '000000' }, cookieOf(ok));
    assert.equal(res.statusCode, 403);
    const staff = await post('/auth/login', { email: 'alt@example.de', password: 'Neu-Nach-Reset-2026' });
    assert.equal(staff.json().security.restriction, null, 'staff are not forced');
  });
});

describe('sessions', () => {
  const staffLogin = async () => cookieOf(await post('/auth/login', { email: 'alt@example.de', password: 'Neu-Nach-Reset-2026' }));

  it('end after eight hours without activity', async () => {
    const cookie = await staffLogin();
    assert.equal((await get('/auth/me', cookie)).statusCode, 200);
    await t.db.update(s.sessions).set({ lastSeenAt: new Date(Date.now() - 9 * 3600_000) });
    assert.equal((await get('/auth/me', cookie)).statusCode, 401);
  });

  it('a forged or unknown session cookie is rejected', async () => {
    assert.equal((await get('/auth/me', 'bp_session=erfunden-und-falsch')).statusCode, 401);
  });

  it('signing out everywhere ends every session of the person', async () => {
    const a = await staffLogin();
    const b = await staffLogin();
    assert.equal((await post('/auth/logout-all', {}, a)).statusCode, 200);
    assert.equal((await get('/auth/me', a)).statusCode, 401);
    assert.equal((await get('/auth/me', b)).statusCode, 401);
  });
});

describe('roles', () => {
  it('staff cannot change roles; the owner change is written to the activity log', async () => {
    const staff = cookieOf(await post('/auth/login', { email: 'alt@example.de', password: 'Neu-Nach-Reset-2026' }));
    const patch = (cookie: string, role: string) =>
      t.app.inject({ method: 'PATCH', url: '/api/settings/team/users/usr_legacy', payload: { role }, headers: { cookie } });
    assert.equal((await patch(staff, 'owner')).statusCode, 403, 'staff cannot make themselves owner');

    const login = await post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const owner = cookieOf(await post('/auth/mfa/verify', { challenge: login.json().challenge, code: recoveryCodes[3] }));
    assert.equal((await patch(owner, 'admin')).statusCode, 200);
    const [ev] = await t.db.select().from(s.events).where(eq(s.events.type, 'user.role_changed'));
    assert.match(ev.summary, /Mitarbeiter → Admin/);
    const [m] = await t.db.select().from(s.memberships).where(and(eq(s.memberships.userId, 'usr_legacy'), eq(s.memberships.tenantId, t.tenantId)));
    assert.equal(m.role, 'admin');
  });
});

describe('rate limits', () => {
  it('more than ten logins a minute from one address are refused', async () => {
    const attempt = () => t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'x@example.de', password: 'irgendwas' }, remoteAddress: '10.99.0.1' });
    for (let i = 0; i < 10; i++) assert.equal((await attempt()).statusCode, 401);
    assert.equal((await attempt()).statusCode, 429);
  });

  it('password reset requests are limited per address', async () => {
    const attempt = () => t.app.inject({ method: 'POST', url: '/api/auth/password-reset/request', payload: { email: 'x@example.de' }, remoteAddress: '10.99.0.2' });
    for (let i = 0; i < 5; i++) assert.equal((await attempt()).statusCode, 200);
    assert.equal((await attempt()).statusCode, 429);
  });
});
