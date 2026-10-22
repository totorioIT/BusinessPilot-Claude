import type { BusyInterval, CalendarProvider } from './types.js';

// Google Calendar over its REST API. The platform has one OAuth client (entered by a platform
// admin); each tenant connects its own Google account and BusinessPilot keeps the refresh token.
// Staff members can be linked to one of that account's calendars: their busy times then block
// slots, and their bookings land in that calendar. Unlinked staff book into the main calendar.

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

export type GoogleClient = { clientId: string; clientSecret: string; redirectUri: string };

export function googleAuthUrl(client: GoogleClient, state: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    // Without prompt=consent Google sends no refresh token when the account connected before.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    if (body.error === 'invalid_grant') throw new Error('Google hat den Zugang widerrufen oder er ist abgelaufen. Bitte Google Kalender neu verbinden.');
    if (body.error === 'invalid_client') throw new Error('Google lehnt die Client-ID oder das Client-Secret ab.');
    throw new Error(`Google antwortet mit ${res.status}${body.error ? `: ${body.error_description ?? body.error}` : ''}`);
  }
  return { access_token: body.access_token, expires_in: body.expires_in ?? 3600, refresh_token: body.refresh_token };
}

export async function exchangeGoogleCode(client: GoogleClient, code: string) {
  const t = await tokenRequest({ code, client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: client.redirectUri, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('Google hat keinen dauerhaften Zugang mitgeschickt. Bitte erneut verbinden.');
  return { accessToken: t.access_token, refreshToken: t.refresh_token };
}

export async function revokeGoogleToken(refreshToken: string): Promise<void> {
  accessCache.delete(refreshToken);
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
}

// Access tokens live for an hour; keep them per refresh token so a busy day doesn't refresh on every call.
const accessCache = new Map<string, { token: string; until: number }>();

async function accessToken(client: GoogleClient, refreshToken: string): Promise<string> {
  const hit = accessCache.get(refreshToken);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await tokenRequest({ refresh_token: refreshToken, client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token' });
  accessCache.set(refreshToken, { token: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 });
  return t.access_token;
}

async function api<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Google Kalender antwortet mit ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (res.status === 204 ? {} : await res.json()) as T;
}

export type GoogleCalendarEntry = { id: string; name: string; primary: boolean };

export async function listGoogleCalendars(client: GoogleClient, refreshToken: string): Promise<GoogleCalendarEntry[]> {
  const token = await accessToken(client, refreshToken);
  const body = await api<{ items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; accessRole?: string }[] }>(
    token,
    'GET',
    '/users/me/calendarList?minAccessRole=writer',
  );
  return (body.items ?? []).map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: c.primary === true }));
}

/** Booked events are stored as "<calendarId>::<eventId>" so cancelling works after the staff mapping changes. */
const joinEventId = (calendarId: string, eventId: string) => `${calendarId}::${eventId}`;

export type GoogleCalendarConfig = GoogleClient & {
  refreshToken: string;
  /** staffId → Google calendar id */
  staffCalendars: Record<string, string>;
  timezone: string;
  onError: (message: string) => void;
};

/**
 * Phone and WhatsApp bookings must not fail because Google is slow or the token expired, so
 * errors are reported through onError and the booking goes ahead with BusinessPilot's own calendar.
 */
export function googleCalendar(cfg: GoogleCalendarConfig): CalendarProvider {
  const report = (err: unknown) => cfg.onError(err instanceof Error ? err.message : String(err));
  return {
    async freeBusy({ calendarIds, from, to }) {
      const linked = calendarIds.filter((id) => cfg.staffCalendars[id]);
      const result: Record<string, BusyInterval[]> = Object.fromEntries(calendarIds.map((id) => [id, []]));
      if (linked.length === 0) return result;
      try {
        const token = await accessToken(cfg, cfg.refreshToken);
        const body = await api<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>(token, 'POST', '/freeBusy', {
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          items: [...new Set(linked.map((id) => cfg.staffCalendars[id]))].map((id) => ({ id })),
        });
        for (const staffId of linked) {
          const busy = body.calendars?.[cfg.staffCalendars[staffId]]?.busy ?? [];
          result[staffId] = busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
        }
      } catch (err) {
        report(err);
      }
      return result;
    },
    async createEvent({ calendarId: staffId, title, start, end, description }) {
      const calendarId = cfg.staffCalendars[staffId] ?? 'primary';
      try {
        const token = await accessToken(cfg, cfg.refreshToken);
        const ev = await api<{ id: string }>(token, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events`, {
          summary: title,
          description: description ?? 'Gebucht über BusinessPilot',
          start: { dateTime: start.toISOString(), timeZone: cfg.timezone },
          end: { dateTime: end.toISOString(), timeZone: cfg.timezone },
        });
        return { eventId: joinEventId(calendarId, ev.id) };
      } catch (err) {
        report(err);
        return { eventId: null };
      }
    },
    async cancelEvent({ eventId }) {
      // Events booked before Google was connected only exist in BusinessPilot.
      if (!eventId.includes('::')) return;
      const [calendarId, id] = eventId.split('::');
      try {
        const token = await accessToken(cfg, cfg.refreshToken);
        await api(token, 'DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`);
      } catch (err) {
        report(err);
      }
    },
  };
}
