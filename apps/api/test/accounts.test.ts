import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import * as s from '../src/db/schema.js';
import { DEMO_EMAIL } from '../src/db/seed.js';
import { setup } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
before(async () => {
  t = await setup();
});
after(async () => {
  await t.close();
});

const newTenant = (name: string, email: string) =>
  t.api('POST', '/admin/tenants', { name, industry: 'Friseur', plan: 'business', owner: { name: 'Sabine Schnitt', email } });

let kundeId = '';
const kundeLogin = { email: 'sabine@salon-schnitt.de', password: '' };

test('a platform admin creates a business with an owner login that works once', async () => {
  const res = await newTenant('Salon Schnitt', kundeLogin.email);
  assert.equal(res.status, 201);
  assert.ok(res.body.owner.startPassword && res.body.owner.startPassword.length >= 12);
  kundeId = res.body.id;
  kundeLogin.password = res.body.owner.startPassword;

  const [tenant] = await t.db.select().from(s.tenants).where(eq(s.tenants.id, kundeId));
  assert.equal(tenant.status, 'trial');
  assert.equal(tenant.plan, 'business');
  assert.equal(tenant.aiSettings.autonomy, 'assist');

  const { res: login } = await t.login(kundeLogin.email, kundeLogin.password);
  assert.equal(login.statusCode, 200);
  const me = login.json();
  assert.equal(me.tenant.name, 'Salon Schnitt');
  assert.equal(me.role, 'owner');
  assert.equal(me.support, false);
  assert.equal(me.user.isPlatformAdmin, false);
});

test('an existing e-mail gets access to the new business instead of a second account', async () => {
  const res = await newTenant('totorio IT', DEMO_EMAIL);
  assert.equal(res.status, 201);
  assert.equal(res.body.owner.startPassword, null);
  const me = await t.api('GET', '/auth/me');
  assert.deepEqual(me.body.tenants.map((x: { name: string }) => x.name).sort(), ['Kfz-Werkstatt Muster GmbH', 'totorio IT'].sort());
  const again = await newTenant('totorio IT', DEMO_EMAIL);
  assert.equal(again.status, 201, 'a second business with the same owner is fine');
});

test('only platform admins can create businesses', async () => {
  const { cookie } = await t.login(kundeLogin.email, kundeLogin.password);
  const res = await t.api('POST', '/admin/tenants', { name: 'Fremd', industry: 'Handel', owner: { name: 'X Y', email: 'x@y.de' } }, cookie);
  assert.equal(res.status, 403);
});

test('a platform admin opens a customer area as support and goes back', async () => {
  const cookie = undefined; // the demo owner's session from setup
  const open = await t.api('POST', '/auth/tenant', { tenantId: kundeId }, cookie);
  assert.equal(open.status, 200);
  assert.equal(open.body.tenant.name, 'Salon Schnitt');
  assert.equal(open.body.support, true);
  assert.equal(open.body.role, 'owner');

  // The session now works inside the customer's data.
  const team = await t.api('GET', '/settings/team', undefined, cookie);
  assert.deepEqual(team.body.users.map((u: { email: string }) => u.email), [kundeLogin.email]);
  const [ev] = await t.db.select().from(s.events).where(eq(s.events.type, 'support.access'));
  assert.equal(ev.tenantId, kundeId);

  const back = await t.api('POST', '/auth/tenant', { tenantId: t.tenantId }, cookie);
  assert.equal(back.body.support, false);
  assert.equal(back.body.tenant.id, t.tenantId);
});

test('a normal owner cannot open another business', async () => {
  const { cookie } = await t.login(kundeLogin.email, kundeLogin.password);
  const res = await t.api('POST', '/auth/tenant', { tenantId: t.tenantId }, cookie);
  assert.equal(res.status, 403);
  const me = await t.api('GET', '/auth/me', undefined, cookie);
  assert.equal(me.body.tenant.id, kundeId);
});

test('the owner invites and removes a staff login', async () => {
  const { cookie } = await t.login(kundeLogin.email, kundeLogin.password);
  const inv = await t.api('POST', '/settings/team/users', { name: 'Lena Locke', email: 'lena@salon-schnitt.de', role: 'staff' }, cookie);
  assert.equal(inv.status, 201);
  const { res: login, cookie: lena } = await t.login('lena@salon-schnitt.de', inv.body.startPassword);
  assert.equal(login.json().role, 'staff');

  // Staff can't manage the team.
  const denied = await t.api('POST', '/settings/team/users', { name: 'Neu Ling', email: 'neu@salon-schnitt.de', role: 'admin' }, lena);
  assert.equal(denied.status, 403);
  const dup = await t.api('POST', '/settings/team/users', { name: 'Lena Locke', email: 'LENA@salon-schnitt.de', role: 'staff' }, cookie);
  assert.equal(dup.status, 400);
  const self = await t.api('DELETE', `/settings/team/users/${login.json().user.id}`, undefined, lena);
  assert.equal(self.status, 403);

  const del = await t.api('DELETE', `/settings/team/users/${inv.body.userId}`, undefined, cookie);
  assert.equal(del.status, 200);
  const gone = await t.api('GET', '/auth/me', undefined, lena);
  assert.equal(gone.status, 401, 'the removed login is signed out right away');
  const owner = await t.api('GET', '/auth/me', undefined, cookie);
  const removeSelf = await t.api('DELETE', `/settings/team/users/${owner.body.user.id}`, undefined, cookie);
  assert.equal(removeSelf.status, 400);
});

test('changing the password signs out other sessions and keeps this one', async () => {
  const first = await t.login(kundeLogin.email, kundeLogin.password);
  const second = await t.login(kundeLogin.email, kundeLogin.password);
  const wrong = await t.api('POST', '/auth/password', { current: 'falsch-falsch', next: 'NeuesPasswort2026' }, second.cookie);
  assert.equal(wrong.status, 400);
  const res = await t.api('POST', '/auth/password', { current: kundeLogin.password, next: 'NeuesPasswort2026' }, second.cookie);
  assert.equal(res.status, 200);
  assert.equal((await t.api('GET', '/auth/me', undefined, first.cookie)).status, 401);
  assert.equal((await t.api('GET', '/auth/me', undefined, second.cookie)).status, 200);
  assert.equal((await t.login(kundeLogin.email, 'NeuesPasswort2026')).res.statusCode, 200);
});
