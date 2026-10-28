import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { integrations, staffMembers } from '../db/schema.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { recordEvent } from '../lib/events.js';
import { auth, parse, requireRole, userActor } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { canEncrypt, decrypt, encrypt } from '../lib/secretbox.js';
import { exchangeGoogleCode, googleAuthUrl, listGoogleCalendars } from '../providers/google-calendar.js';
import {
  BUSINESS_SCOPES,
  deleteGoogleReviewReply,
  listBusinessLocations,
  listGoogleReviews,
  replyToGoogleReview,
} from '../providers/google-business.js';
import { providersFor } from '../providers/registry.js';
import { tenants } from '../db/schema.js';
import {
  clearGoogleSettings,
  getGoogleSettings,
  googleClient,
  oauthState,
  readOauthState,
  type GoogleProvider,
  saveGoogleSettings,
  storedGoogleSecret,
} from '../services/google-settings.js';

// Google Calendar: the platform admin enters the OAuth client once, then each business clicks
// "Mit Google verbinden", grants access in Google's own window and picks which calendar belongs
// to which staff member.

export async function googleRoutes(app: FastifyInstance) {
  const db = app.db;

  const platformAdmin = (req: Parameters<typeof auth>[0]) => {
    const a = auth(req);
    if (!a.isPlatformAdmin) throw forbidden();
    return a;
  };
  const adminView = async () => ({ ...(await getGoogleSettings(db, app.publicUrl)), canStoreSecrets: canEncrypt() });

  app.get('/admin/google', async (req) => {
    platformAdmin(req);
    return adminView();
  });

  app.put('/admin/google', async (req) => {
    const a = platformAdmin(req);
    if (!canEncrypt()) throw badRequest('Auf dem Server fehlt APP_SECRET. Das Update-Skript legt ihn beim nächsten Durchlauf an.', 'no_secret');
    const body = parse(
      z.object({
        clientId: z.string().trim().regex(/\.apps\.googleusercontent\.com$/, 'Die Client-ID endet auf .apps.googleusercontent.com.'),
        clientSecret: z.string().trim().min(10).max(500).optional(),
      }),
      req.body,
    );
    const clientSecret = body.clientSecret ?? (await storedGoogleSecret(db));
    if (!clientSecret) throw badRequest('Bitte das Client-Secret eintragen.');
    await saveGoogleSettings(db, { clientId: body.clientId, clientSecret });
    await recordEvent(db, { tenantId: a.tenantId, type: 'integration.connected', actor: userActor(a), summary: 'Google-Zugang für die Plattform gespeichert' });
    return adminView();
  });

  app.delete('/admin/google', async (req) => {
    platformAdmin(req);
    await clearGoogleSettings(db);
    return adminView();
  });

  /** Where the dashboard sends the browser to start Google's consent screen. */
  app.post('/integrations/:provider/start', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const provider = (req.params as { provider: string }).provider;
    if (provider !== 'google_calendar' && provider !== 'google_business') throw badRequest('Diese Integration verbindet sich nicht über Google.');
    const client = await googleClient(db, app.publicUrl);
    if (!client) throw badRequest('Der Google-Zugang ist noch nicht eingerichtet. Ein Plattform-Admin trägt ihn unter Admin ein.', 'google_not_configured');
    const state = oauthState({ tenantId: a.tenantId, userId: a.userId, provider });
    return { url: provider === 'google_business' ? googleAuthUrl(client, state, BUSINESS_SCOPES) : googleAuthUrl(client, state) };
  });

  const saveConnection = async (tenantId: string, provider: GoogleProvider, config: Record<string, string>) => {
    await db
      .insert(integrations)
      .values({ id: newId('int'), tenantId, provider, mode: 'live', status: 'connected', config })
      .onConflictDoUpdate({
        target: [integrations.tenantId, integrations.provider],
        set: { mode: 'live', status: 'connected', config, lastError: null, updatedAt: new Date() },
      });
  };

  // Google sends the browser back here. Every outcome redirects to the Integrations page, which
  // shows the result, because the person is looking at a browser tab, not at an API response.
  app.get('/integrations/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const back = (params: Record<string, string>) => reply.redirect(`/integrations?${new URLSearchParams(params)}`);
    const state = q.state ? readOauthState(q.state) : null;
    if (!state) return back({ google_error: 'Die Anmeldung bei Google ist abgelaufen. Bitte noch einmal auf „Mit Google verbinden“ klicken.' });
    // Only the person who started the connection may finish it, in the same browser: otherwise a
    // link with someone else's state could attach the clicker's Google account to that business.
    if (!req.auth) return back({ google_error: 'Bitte zuerst im Dashboard anmelden und dann noch einmal „Mit Google verbinden“ klicken.' });
    if (req.auth.tenantId !== state.tenantId || req.auth.userId !== state.userId) {
      return back({ google_error: 'Die Anmeldung gehört zu einem anderen Konto.' });
    }
    if (q.error || !q.code) return back({ google_error: q.error === 'access_denied' ? 'Der Zugriff wurde bei Google abgelehnt.' : `Google meldet: ${q.error ?? 'kein Code'}` });
    const client = await googleClient(db, app.publicUrl);
    if (!client) return back({ google_error: 'Der Google-Zugang ist noch nicht eingerichtet.' });
    const name = state.provider === 'google_business' ? 'Google Unternehmensprofil' : 'Google Kalender';
    try {
      const { refreshToken } = await exchangeGoogleCode(client, q.code);
      let summary: string;
      if (state.provider === 'google_business') {
        const locations = await listBusinessLocations(client, refreshToken);
        if (locations.length === 0) throw new Error('Dieses Google-Konto verwaltet kein Unternehmensprofil.');
        // One location is the usual case; with several the business picks one on the card.
        const only = locations.length === 1 ? locations[0] : null;
        await saveConnection(state.tenantId, 'google_business', {
          refreshToken: encrypt(refreshToken),
          locationId: only?.id ?? '',
          locationTitle: only?.title ?? '',
        });
        summary = only ? `${name} verbunden (${only.title})` : `${name} verbunden, Standort noch auswählen`;
      } else {
        const calendars = await listGoogleCalendars(client, refreshToken);
        const account = calendars.find((c) => c.primary)?.id ?? 'Google-Konto';
        await saveConnection(state.tenantId, 'google_calendar', { refreshToken: encrypt(refreshToken), account, staffCalendars: '{}' });
        summary = `${name} verbunden (${account})`;
      }
      await recordEvent(db, {
        tenantId: state.tenantId,
        type: 'integration.connected',
        actor: { type: 'user', id: state.userId, name: req.auth.userName },
        summary,
      });
      return back({ google: 'connected', provider: state.provider });
    } catch (err) {
      return back({ google_error: `${name}: ${err instanceof Error ? err.message : 'Verbindung zu Google fehlgeschlagen.'}` });
    }
  });

  const findLive = async (tenantId: string, provider: GoogleProvider) => {
    const [row] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, provider), eq(integrations.mode, 'live'), eq(integrations.status, 'connected')));
    const client = await googleClient(db, app.publicUrl);
    return row && client ? { row, client, refreshToken: decrypt(row.config.refreshToken) } : null;
  };
  const liveGoogle = async (tenantId: string, provider: GoogleProvider = 'google_calendar') => {
    const found = await findLive(tenantId, provider);
    if (!found) throw badRequest(`${provider === 'google_business' ? 'Google Unternehmensprofil' : 'Google Kalender'} ist nicht verbunden.`, 'google_not_connected');
    return found;
  };
  const googleError = (err: unknown) => badRequest(err instanceof Error ? err.message : 'Google ist nicht erreichbar.', 'google_error');
  const viaGoogle = async <T>(fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (err) {
      throw googleError(err);
    }
  };

  app.get('/integrations/google_calendar/calendars', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { row, client, refreshToken } = await liveGoogle(a.tenantId);
    let calendars;
    try {
      calendars = await listGoogleCalendars(client, refreshToken);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Google ist nicht erreichbar.', 'google_error');
    }
    const mapping = JSON.parse(row.config.staffCalendars ?? '{}') as Record<string, string>;
    const staff = await db.select().from(staffMembers).where(and(eq(staffMembers.tenantId, a.tenantId), eq(staffMembers.active, true)));
    return {
      account: row.config.account,
      calendars,
      staff: staff.map((s) => ({ id: s.id, name: s.name, calendarId: mapping[s.id] ?? null })),
    };
  });

  app.put('/integrations/google_calendar/calendars', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { row, client, refreshToken } = await liveGoogle(a.tenantId);
    const body = parse(z.object({ staffCalendars: z.record(z.string(), z.string().nullable()) }), req.body);
    const staff = await db.select({ id: staffMembers.id }).from(staffMembers).where(eq(staffMembers.tenantId, a.tenantId));
    const calendars = await listGoogleCalendars(client, refreshToken);
    const mapping: Record<string, string> = {};
    for (const [staffId, calendarId] of Object.entries(body.staffCalendars)) {
      if (!calendarId) continue;
      if (!staff.some((s) => s.id === staffId)) throw badRequest('Unbekannter Mitarbeiter.');
      if (!calendars.some((c) => c.id === calendarId)) throw badRequest('Diesen Kalender gibt es im verbundenen Google-Konto nicht.');
      mapping[staffId] = calendarId;
    }
    await db
      .update(integrations)
      .set({ config: { ...row.config, staffCalendars: JSON.stringify(mapping) }, updatedAt: new Date() })
      .where(eq(integrations.id, row.id));
    await recordEvent(db, { tenantId: a.tenantId, type: 'integration.updated', actor: userActor(a), summary: 'Kalender-Zuordnung der Mitarbeiter geändert' });
    return { ok: true, staffCalendars: mapping };
  });

  // Google Business Profile: which location, its reviews, replies.
  app.get('/integrations/google_business/locations', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { row, client, refreshToken } = await liveGoogle(a.tenantId, 'google_business');
    const locations = await viaGoogle(() => listBusinessLocations(client, refreshToken));
    return { locations, selected: row.config.locationId || null };
  });

  app.put('/integrations/google_business/location', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { row, client, refreshToken } = await liveGoogle(a.tenantId, 'google_business');
    const { locationId } = parse(z.object({ locationId: z.string().min(1) }), req.body);
    const locations = await viaGoogle(() => listBusinessLocations(client, refreshToken));
    const loc = locations.find((l) => l.id === locationId);
    if (!loc) throw badRequest('Diesen Standort verwaltet das verbundene Google-Konto nicht.');
    await db
      .update(integrations)
      .set({ config: { ...row.config, locationId: loc.id, locationTitle: loc.title }, updatedAt: new Date() })
      .where(eq(integrations.id, row.id));
    await recordEvent(db, { tenantId: a.tenantId, type: 'integration.updated', actor: userActor(a), summary: `Google-Standort gewählt: ${loc.title}` });
    return { ok: true, locationId: loc.id, locationTitle: loc.title };
  });

  const liveLocation = async (tenantId: string) => {
    const found = await liveGoogle(tenantId, 'google_business');
    if (!found.row.config.locationId) throw badRequest('Bitte unter Integrationen zuerst den Google-Standort auswählen.', 'google_location_missing');
    return { ...found, locationId: found.row.config.locationId };
  };

  app.get('/reviews/google', async (req) => {
    const a = auth(req);
    const q = parse(z.object({ pageToken: z.string().optional() }), req.query);
    const found = await findLive(a.tenantId, 'google_business');
    if (!found) return { connected: false };
    if (!found.row.config.locationId) return { connected: true, location: null };
    const page = await viaGoogle(() => listGoogleReviews(found.client, found.refreshToken, found.row.config.locationId, q.pageToken));
    return { connected: true, location: found.row.config.locationTitle, ...page };
  });

  app.put('/reviews/google/:reviewId/reply', async (req) => {
    const a = requireRole(req, ['owner', 'admin', 'staff']);
    const { reviewId } = req.params as { reviewId: string };
    // Google allows 4096 bytes; umlauts take two.
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
    const { client, refreshToken, locationId } = await liveLocation(a.tenantId);
    await viaGoogle(() => replyToGoogleReview(client, refreshToken, locationId, reviewId, text));
    await recordEvent(db, { tenantId: a.tenantId, type: 'review.replied', actor: userActor(a), summary: 'Antwort auf eine Google-Bewertung veröffentlicht' });
    return { ok: true };
  });

  app.delete('/reviews/google/:reviewId/reply', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const { reviewId } = req.params as { reviewId: string };
    const { client, refreshToken, locationId } = await liveLocation(a.tenantId);
    await viaGoogle(() => deleteGoogleReviewReply(client, refreshToken, locationId, reviewId));
    await recordEvent(db, { tenantId: a.tenantId, type: 'review.reply_deleted', actor: userActor(a), summary: 'Antwort auf eine Google-Bewertung gelöscht' });
    return { ok: true };
  });

  /** A draft the owner edits before posting; the AI never posts on its own. */
  app.post('/reviews/google/suggest', async (req) => {
    const a = auth(req);
    const body = parse(z.object({ author: z.string().max(200), rating: z.number().int().min(1).max(5), text: z.string().max(4000) }), req.body);
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, a.tenantId));
    const providers = await providersFor(db, a.tenantId);
    const system =
      `Du schreibst im Namen von ${tenant.name} eine öffentliche Antwort auf eine Google-Bewertung. ` +
      'Deutsch, freundlich, persönlich, höchstens 4 Sätze. Bedanke dich. Nenne keine Preise, Rabatte oder Zusagen und erfinde keine Details. ' +
      'Bei Kritik: entschuldige dich ohne Schuldzuweisung, zeige Verständnis und lade zu einem Gespräch ein' +
      (tenant.phone ? ` (Telefon ${tenant.phone}).` : '.') +
      ' Keine Anrede mit vollem Nachnamen, kein Hinweis auf eine KI. Antworte nur mit dem Antworttext.';
    const review = `${body.rating} von 5 Sternen von ${body.author}:\n${body.text || '(ohne Text)'}`;
    try {
      const text = await providers.llm.complete({ messages: [{ role: 'system', content: system }, { role: 'user', content: review }], maxTokens: 250 });
      return { text: text.replace(/^"|"$/g, '').trim() };
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Die KI ist gerade nicht erreichbar.', 'llm_error');
    }
  });
}
