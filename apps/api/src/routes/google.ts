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
  clearGoogleSettings,
  getGoogleSettings,
  googleClient,
  oauthState,
  readOauthState,
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
  app.post('/integrations/google_calendar/start', async (req) => {
    const a = requireRole(req, ['owner', 'admin']);
    const client = await googleClient(db, app.publicUrl);
    if (!client) throw badRequest('Der Google-Zugang ist noch nicht eingerichtet. Ein Plattform-Admin trägt ihn unter Admin ein.', 'google_not_configured');
    return { url: googleAuthUrl(client, oauthState({ tenantId: a.tenantId, userId: a.userId })) };
  });

  // Google sends the browser back here. Every outcome redirects to the Integrations page, which
  // shows the result, because the person is looking at a browser tab, not at an API response.
  app.get('/integrations/google/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const back = (params: Record<string, string>) => reply.redirect(`/integrations?${new URLSearchParams(params)}`);
    const state = q.state ? readOauthState(q.state) : null;
    if (!state) return back({ google_error: 'Die Anmeldung bei Google ist abgelaufen. Bitte noch einmal auf „Mit Google verbinden“ klicken.' });
    if (req.auth && (req.auth.tenantId !== state.tenantId || req.auth.userId !== state.userId)) {
      return back({ google_error: 'Die Anmeldung gehört zu einem anderen Konto.' });
    }
    if (q.error || !q.code) return back({ google_error: q.error === 'access_denied' ? 'Der Zugriff wurde bei Google abgelehnt.' : `Google meldet: ${q.error ?? 'kein Code'}` });
    const client = await googleClient(db, app.publicUrl);
    if (!client) return back({ google_error: 'Der Google-Zugang ist noch nicht eingerichtet.' });
    try {
      const { refreshToken } = await exchangeGoogleCode(client, q.code);
      const calendars = await listGoogleCalendars(client, refreshToken);
      const account = calendars.find((c) => c.primary)?.id ?? 'Google-Konto';
      const config = { refreshToken: encrypt(refreshToken), account, staffCalendars: '{}' };
      await db
        .insert(integrations)
        .values({ id: newId('int'), tenantId: state.tenantId, provider: 'google_calendar', mode: 'live', status: 'connected', config })
        .onConflictDoUpdate({
          target: [integrations.tenantId, integrations.provider],
          set: { mode: 'live', status: 'connected', config, lastError: null, updatedAt: new Date() },
        });
      await recordEvent(db, {
        tenantId: state.tenantId,
        type: 'integration.connected',
        actor: { type: 'user', id: state.userId, name: req.auth?.userName ?? null },
        summary: `Google Kalender verbunden (${account})`,
      });
      return back({ google: 'connected' });
    } catch (err) {
      return back({ google_error: err instanceof Error ? err.message : 'Verbindung zu Google fehlgeschlagen.' });
    }
  });

  const liveGoogle = async (tenantId: string) => {
    const [row] = await db
      .select()
      .from(integrations)
      .where(and(eq(integrations.tenantId, tenantId), eq(integrations.provider, 'google_calendar'), eq(integrations.mode, 'live'), eq(integrations.status, 'connected')));
    const client = await googleClient(db, app.publicUrl);
    if (!row || !client) throw badRequest('Google Kalender ist nicht verbunden.', 'google_not_connected');
    return { row, client, refreshToken: decrypt(row.config.refreshToken) };
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
}
