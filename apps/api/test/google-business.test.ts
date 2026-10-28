import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { originalText } from '../src/providers/google-business.js';
import { setup } from './helpers.js';

// A stand-in for Google's OAuth and Business Profile APIs.
const calls: { url: string; method: string; body: string }[] = [];
let locations = [{ name: 'locations/1', title: 'Kfz-Werkstatt Muster', storefrontAddress: { addressLines: ['Musterstr. 1'], locality: 'München' } }];
let reviewsDisabled = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  const method = init?.method ?? 'GET';
  const body = String(init?.body ?? '');
  calls.push({ url, method, body });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (url.endsWith('/token')) {
    const p = new URLSearchParams(body);
    return p.get('grant_type') === 'authorization_code' ? json(200, { access_token: 'at', expires_in: 3600, refresh_token: 'rt-biz' }) : json(200, { access_token: 'at', expires_in: 3600 });
  }
  if (url.includes('/revoke')) return new Response('', { status: 200 });
  if (url === 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts') return json(200, { accounts: [{ name: 'accounts/9' }] });
  if (url.startsWith('https://mybusinessbusinessinformation.googleapis.com/v1/accounts/9/locations')) {
    assert.match(url, /readMask=/);
    return json(200, { locations });
  }
  if (url.startsWith('https://mybusiness.googleapis.com/v4/accounts/9/locations/1/reviews')) {
    if (reviewsDisabled) return json(403, { error: { message: 'Google My Business API has not been used in project 567 before or it is disabled.' } });
    if (url.endsWith('/reply')) return method === 'DELETE' ? json(200, {}) : json(200, { comment: JSON.parse(body).comment });
    return json(200, {
      averageRating: 4.5,
      totalReviewCount: 2,
      reviews: [
        { reviewId: 'r1', reviewer: { displayName: 'Anna B.' }, starRating: 'FIVE', comment: 'Super schnell!', createTime: '2026-10-20T10:00:00Z' },
        {
          reviewId: 'r2',
          reviewer: { isAnonymous: true },
          starRating: 'TWO',
          comment: '(Translated by Google) Too expensive\n\n(Original)\nZu teuer',
          createTime: '2026-10-19T10:00:00Z',
          reviewReply: { comment: 'Danke für Ihr Feedback.', updateTime: '2026-10-19T12:00:00Z' },
        },
      ],
    });
  }
  return json(404, {});
}) as typeof fetch;

let t: Awaited<ReturnType<typeof setup>>;
before(async () => {
  process.env.APP_SECRET = 'test-secret-with-at-least-32-characters!';
  t = await setup();
  await t.api('PUT', '/admin/google', { clientId: '1-x.apps.googleusercontent.com', clientSecret: 'geheim-secret-123' });
});
after(async () => {
  globalThis.fetch = realFetch;
  await t.close();
});

const connect = async () => {
  const start = await t.api('POST', '/integrations/google_business/start');
  const url = new URL(start.body.url);
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/business.manage');
  return t.app.inject({ method: 'GET', url: `/api/integrations/google/callback?code=c&state=${url.searchParams.get('state')}`, headers: { cookie: t.cookie } });
};

test('before connecting, the reviews page knows Google is not connected', async () => {
  assert.deepEqual((await t.api('GET', '/reviews/google')).body, { connected: false });
});

test('with one location, connecting picks it and lists its reviews in the original language', async () => {
  const res = await connect();
  assert.equal(res.headers.location, '/integrations?google=connected&provider=google_business');
  const item = (await t.api('GET', '/integrations')).body.find((i: any) => i.provider === 'google_business');
  assert.equal(item.detail, 'Standort: Kfz-Werkstatt Muster');

  const list = await t.api('GET', '/reviews/google');
  assert.equal(list.body.location, 'Kfz-Werkstatt Muster');
  assert.equal(list.body.averageRating, 4.5);
  assert.deepEqual(
    list.body.reviews.map((r: any) => [r.author, r.rating, r.text, r.reply?.text ?? null]),
    [
      ['Anna B.', 5, 'Super schnell!', null],
      ['Anonym', 2, 'Zu teuer', 'Danke für Ihr Feedback.'],
    ],
  );
});

test('replies are posted to Google and can be deleted', async () => {
  calls.length = 0;
  const res = await t.api('PUT', '/reviews/google/r1/reply', { text: 'Vielen Dank, Anna!' });
  assert.equal(res.status, 200);
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.url, 'https://mybusiness.googleapis.com/v4/accounts/9/locations/1/reviews/r1/reply');
  assert.deepEqual(JSON.parse(put.body), { comment: 'Vielen Dank, Anna!' });
  assert.equal((await t.api('DELETE', '/reviews/google/r1/reply')).status, 200);
});

test('the AI drafts a reply but never posts it', async () => {
  calls.length = 0;
  const res = await t.api('POST', '/reviews/google/suggest', { author: 'Anonym', rating: 2, text: 'Zu teuer' });
  assert.equal(res.status, 200);
  assert.ok(res.body.text.length > 0);
  assert.ok(!calls.some((c) => c.method === 'PUT'));
});

test('a disabled API is explained in plain words', async () => {
  reviewsDisabled = true;
  const res = await t.api('GET', '/reviews/google');
  assert.equal(res.status, 400);
  assert.match(res.body.message, /„Google My Business API“ ist im Google-Cloud-Projekt noch nicht aktiviert/);
  reviewsDisabled = false;
});

test('with several locations the business picks one first', async () => {
  locations = [...locations, { name: 'locations/2', title: 'Filiale Nord', storefrontAddress: { addressLines: [], locality: 'Freising' } }];
  await connect();
  assert.deepEqual((await t.api('GET', '/reviews/google')).body, { connected: true, location: null });
  const reply = await t.api('PUT', '/reviews/google/r1/reply', { text: 'Danke' });
  assert.equal(reply.body.error, 'google_location_missing');
  const locs = await t.api('GET', '/integrations/google_business/locations');
  assert.deepEqual(locs.body.locations.map((l: any) => [l.id, l.address]), [
    ['accounts/9/locations/1', 'Musterstr. 1, München'],
    ['accounts/9/locations/2', 'Freising'],
  ]);
  assert.equal((await t.api('PUT', '/integrations/google_business/location', { locationId: 'accounts/9/locations/7' })).status, 400);
  const ok = await t.api('PUT', '/integrations/google_business/location', { locationId: 'accounts/9/locations/1' });
  assert.equal(ok.body.locationTitle, 'Kfz-Werkstatt Muster');
  assert.equal((await t.api('GET', '/reviews/google')).body.reviews.length, 2);
});

test('Google translations are stripped to what the customer wrote', () => {
  assert.equal(originalText('Sehr gut\n\n(Translated by Google)\nVery good'), 'Sehr gut');
  assert.equal(originalText('(Translated by Google) Very good\n\n(Original)\nSehr gut'), 'Sehr gut');
  assert.equal(originalText('Einfach gut'), 'Einfach gut');
});
