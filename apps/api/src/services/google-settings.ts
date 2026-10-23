import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { platformSettings } from '../db/schema.js';
import { decrypt, encrypt } from '../lib/secretbox.js';
import type { GoogleClient } from '../providers/google-calendar.js';

// The Google OAuth client is one platform-wide setting (the operator's Google Cloud project),
// entered by a platform admin. Tenants then connect their own Google accounts through it.

const KEY = 'google_oauth';

type Stored = { clientId: string; clientSecret: string; secretHint: string };

export const googleRedirectUri = (publicUrl: string) => `${publicUrl}/api/integrations/google/callback`;

export async function getGoogleSettings(db: DbOrTx, publicUrl: string) {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY));
  const v = row?.value as Stored | undefined;
  return {
    configured: !!v,
    clientId: v?.clientId ?? null,
    secretHint: v?.secretHint ?? null,
    redirectUri: googleRedirectUri(publicUrl),
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function googleClient(db: DbOrTx, publicUrl = ""): Promise<GoogleClient | null> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY));
  if (!row) return null;
  const v = row.value as Stored;
  try {
    return { clientId: v.clientId, clientSecret: decrypt(v.clientSecret), redirectUri: googleRedirectUri(publicUrl) };
  } catch (err) {
    console.error('Google-Client-Secret kann nicht entschlüsselt werden (APP_SECRET geändert?)', err);
    return null;
  }
}

export async function saveGoogleSettings(db: DbOrTx, input: { clientId: string; clientSecret: string }) {
  const value: Stored = { clientId: input.clientId, clientSecret: encrypt(input.clientSecret), secretHint: `…${input.clientSecret.slice(-4)}` };
  await db
    .insert(platformSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}

export async function storedGoogleSecret(db: DbOrTx): Promise<string | null> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY));
  return row ? decrypt((row.value as Stored).clientSecret) : null;
}

export async function clearGoogleSettings(db: DbOrTx) {
  await db.delete(platformSettings).where(eq(platformSettings.key, KEY));
}

// The OAuth state carries tenant and user through Google's redirect, signed so it can't be forged.
const sign = (payload: string) => createHmac('sha256', process.env.APP_SECRET ?? '').update(payload).digest('base64url');

export type GoogleProvider = 'google_calendar' | 'google_business';

export function oauthState(input: { tenantId: string; userId: string; provider: GoogleProvider }): string {
  const payload = Buffer.from(JSON.stringify({ ...input, exp: Date.now() + 15 * 60_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readOauthState(state: string): { tenantId: string; userId: string; provider: GoogleProvider } | null {
  const [payload, mac] = state.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { tenantId: string; userId: string; provider?: GoogleProvider; exp: number };
  return data.exp > Date.now() ? { tenantId: data.tenantId, userId: data.userId, provider: data.provider ?? 'google_calendar' } : null;
}
