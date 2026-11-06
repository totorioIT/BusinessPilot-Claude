import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { customers, tenants } from '../db/schema.js';
import { verifyLink, type LinkClaims, type LinkPurpose } from '../lib/signed-links.js';
import { marketingConsents, setMarketingConsent, type ConsentChannel } from '../services/consents.js';

// Pages customers reach from links in emails, without logging in. The token in the link is
// signed (lib/signed-links.ts). Opening a link only shows a page; the change happens on POST,
// because mail scanners open links automatically. The unsubscribe POST also serves the
// RFC 8058 one-click request that mail apps send for the List-Unsubscribe header.

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function page(reply: FastifyReply, status: number, title: string, body: string) {
  return reply
    .status(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    .send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f4f6fa;color:#0b1b33;display:grid;place-items:center;align-content:center;min-height:100vh;padding:16px}
main{background:#fff;border-radius:16px;padding:32px;max-width:440px;width:100%;box-shadow:0 8px 30px rgba(11,27,51,.08)}h1{font-size:1.4rem;margin:0 0 12px}p{line-height:1.5;color:#3d4b63}
footer{margin-top:16px;font-size:.875rem}footer a{color:#3d4b63}
button{margin-top:12px;background:#19c37d;color:#0b1b33;border:0;border-radius:10px;padding:12px 20px;font-weight:700;font-size:1rem;cursor:pointer}</style></head>
<body><main>${body}</main><footer><a href="/impressum">Impressum</a></footer></body></html>`);
}

const invalid = (reply: FastifyReply) =>
  page(reply, 400, 'Link ungültig', '<h1>Dieser Link ist ungültig oder abgelaufen</h1><p>Bitte wenden Sie sich direkt an das Unternehmen, von dem Sie die E-Mail erhalten haben.</p>');

export async function publicRoutes(app: FastifyInstance) {
  const db = app.db;

  // Form posts from these pages and one-click requests from mail apps; the body is not needed.
  app.addContentTypeParser(['application/x-www-form-urlencoded', 'multipart/form-data'], { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => done(null, body));

  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  const resolve = async (token: unknown, purpose: LinkPurpose) => {
    const claims: LinkClaims | null = typeof token === 'string' ? verifyLink(token, purpose) : null;
    if (!claims || (claims.ch !== 'email' && claims.ch !== 'whatsapp')) return null;
    const [row] = await db
      .select({ customerId: customers.id, tenantName: tenants.name })
      .from(customers)
      .innerJoin(tenants, eq(tenants.id, customers.tenantId))
      .where(and(eq(customers.tenantId, claims.t), eq(customers.id, claims.c)));
    return row ? { ...row, tenantId: claims.t, channel: claims.ch as ConsentChannel } : null;
  };
  const tokenOf = (query: unknown) => (query as { t?: unknown }).t;
  const formFor = (path: string, token: string, label: string) =>
    `<form method="post" action="/api/public/${path}?t=${encodeURIComponent(token)}"><button type="submit">${label}</button></form>`;

  app.get('/unsubscribe', limit, async (req, reply) => {
    const token = tokenOf(req.query);
    const r = await resolve(token, 'unsubscribe');
    if (!r) return invalid(reply);
    return page(
      reply,
      200,
      'Abmelden',
      `<h1>Keine Angebote mehr von ${escapeHtml(r.tenantName)}?</h1><p>Mit einem Klick melden Sie sich von Angeboten, Neuigkeiten und Terminvorschlägen per E-Mail ab.</p>${formFor('unsubscribe', String(token), 'Jetzt abmelden')}`,
    );
  });

  app.post('/unsubscribe', limit, async (req, reply) => {
    const r = await resolve(tokenOf(req.query), 'unsubscribe');
    if (!r) return invalid(reply);
    const current = (await marketingConsents(db, r.tenantId, r.customerId)).find((c) => c.channel === r.channel);
    if (current?.status !== 'revoked') {
      await setMarketingConsent(db, {
        tenantId: r.tenantId,
        customerId: r.customerId,
        channel: r.channel,
        status: 'revoked',
        source: 'Abmeldelink in der E-Mail',
        actor: { type: 'system', name: 'Kunde' },
      });
    }
    return page(reply, 200, 'Abgemeldet', `<h1>Sie sind abgemeldet</h1><p>Sie erhalten von ${escapeHtml(r.tenantName)} keine Angebote und Neuigkeiten mehr per E-Mail. Termin­bestätigungen bekommen Sie weiterhin.</p>`);
  });

  app.get('/consent/confirm', limit, async (req, reply) => {
    const token = tokenOf(req.query);
    const r = await resolve(token, 'confirm');
    if (!r) return invalid(reply);
    return page(
      reply,
      200,
      'Einwilligung bestätigen',
      `<h1>Angebote von ${escapeHtml(r.tenantName)} erhalten?</h1><p>Bitte bestätigen Sie, dass Sie gelegentlich Angebote, Neuigkeiten und Terminvorschläge per E-Mail erhalten möchten. Sie können sich jederzeit mit einem Klick wieder abmelden.</p>${formFor('consent/confirm', String(token), 'Ja, ich möchte das')}`,
    );
  });

  app.post('/consent/confirm', limit, async (req, reply) => {
    const r = await resolve(tokenOf(req.query), 'confirm');
    if (!r) return invalid(reply);
    const current = (await marketingConsents(db, r.tenantId, r.customerId)).find((c) => c.channel === r.channel);
    // A later objection wins over an old confirmation link.
    if (current?.status === 'revoked') {
      return page(reply, 200, 'Abgemeldet', '<h1>Sie hatten sich abgemeldet</h1><p>Bitte wenden Sie sich an das Unternehmen, wenn Sie wieder Angebote erhalten möchten.</p>');
    }
    if (current?.status !== 'granted') {
      await setMarketingConsent(db, {
        tenantId: r.tenantId,
        customerId: r.customerId,
        channel: r.channel,
        status: 'granted',
        source: `Per Bestätigungslink (Double-Opt-in), IP ${req.ip}`,
        actor: { type: 'system', name: 'Kunde' },
      });
    }
    return page(reply, 200, 'Bestätigt', `<h1>Vielen Dank!</h1><p>Sie erhalten ab jetzt gelegentlich Angebote und Neuigkeiten von ${escapeHtml(r.tenantName)}. Abmelden können Sie sich jederzeit über den Link in jeder E-Mail.</p>`);
  });
}
