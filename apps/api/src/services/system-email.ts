import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { integrations, memberships, platformSettings } from '../db/schema.js';
import { decrypt, encrypt } from '../lib/secretbox.js';
import { brevoEmail } from '../providers/brevo.js';
import { providersFor } from '../providers/registry.js';
import { sandboxEmail } from '../providers/sandbox.js';
import type { EmailProvider } from '../providers/types.js';

// Mails from the platform itself (password reset, security notices), not from a business.
// A platform admin can enter a Brevo key for this under Admin. Until then the Brevo account of
// a business the person belongs to is used, so a reset already works where email is set up.

const KEY = 'system_email';
type Stored = { apiKey: string; keyHint: string; senderEmail: string; account: string };

export async function getSystemEmailSettings(db: DbOrTx) {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY));
  if (!row) return { configured: false as const, senderEmail: null, keyHint: null, account: null };
  const v = row.value as Stored;
  return { configured: true as const, senderEmail: v.senderEmail, keyHint: v.keyHint, account: v.account };
}

export async function saveSystemEmailSettings(db: DbOrTx, input: { apiKey: string; senderEmail: string; account: string }) {
  const value: Stored = { apiKey: encrypt(input.apiKey), keyHint: `…${input.apiKey.slice(-4)}`, senderEmail: input.senderEmail, account: input.account };
  await db
    .insert(platformSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}

export async function clearSystemEmailSettings(db: DbOrTx) {
  await db.delete(platformSettings).where(eq(platformSettings.key, KEY));
}

/** The mailer for platform mails to this user. */
export async function systemMailer(db: DbOrTx, userId: string): Promise<EmailProvider> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY));
  if (row) {
    const v = row.value as Stored;
    try {
      return brevoEmail({ apiKey: decrypt(v.apiKey), senderEmail: v.senderEmail, senderName: 'BusinessPilot' });
    } catch (err) {
      console.error('System-E-Mail: Schlüssel kann nicht entschlüsselt werden (APP_SECRET geändert?)', err);
    }
  }
  const own = await db.select({ tenantId: memberships.tenantId }).from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.tenantId));
  if (own.length) {
    const [withBrevo] = await db
      .select({ tenantId: integrations.tenantId })
      .from(integrations)
      .where(
        and(
          inArray(
            integrations.tenantId,
            own.map((m) => m.tenantId),
          ),
          eq(integrations.provider, 'brevo'),
          eq(integrations.mode, 'live'),
          eq(integrations.status, 'connected'),
        ),
      )
      .limit(1);
    return (await providersFor(db, withBrevo?.tenantId ?? own[0].tenantId)).email;
  }
  return sandboxEmail;
}
