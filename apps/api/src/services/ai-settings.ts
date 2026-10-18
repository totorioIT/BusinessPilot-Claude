import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { platformSettings } from '../db/schema.js';
import { decrypt, encrypt } from '../lib/secretbox.js';
import { IONOS_BASE_URL, openAiCompatibleLlm } from '../providers/openai-compatible.js';
import type { LlmProvider } from '../providers/types.js';

// The LLM account is one platform-wide setting (the operator's IONOS token), entered by a
// platform admin in the dashboard. Every tenant uses it; without it the sandbox answers.

const KEY = 'llm';

type Stored = { baseUrl: string; model: string; token: string; tokenHint: string };

export type AiSettings = { configured: boolean; baseUrl: string; model: string | null; tokenHint: string | null; updatedAt: Date | null };

async function load(db: DbOrTx) {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, KEY));
  return row ? { value: row.value as Stored, updatedAt: row.updatedAt } : null;
}

export async function getAiSettings(db: DbOrTx): Promise<AiSettings> {
  const row = await load(db);
  if (!row) return { configured: false, baseUrl: IONOS_BASE_URL, model: null, tokenHint: null, updatedAt: null };
  return { configured: true, baseUrl: row.value.baseUrl, model: row.value.model, tokenHint: row.value.tokenHint, updatedAt: row.updatedAt };
}

/** The stored token in plain text, for calls the admin makes without re-entering it. */
export async function storedToken(db: DbOrTx): Promise<string | null> {
  const row = await load(db);
  return row ? decrypt(row.value.token) : null;
}

export async function saveAiSettings(db: DbOrTx, input: { baseUrl: string; model: string; token: string }) {
  const value: Stored = { baseUrl: input.baseUrl, model: input.model, token: encrypt(input.token), tokenHint: `…${input.token.slice(-4)}` };
  await db
    .insert(platformSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}

export async function clearAiSettings(db: DbOrTx) {
  await db.delete(platformSettings).where(eq(platformSettings.key, KEY));
}

/** The live model, or null when none is set up (or the token can't be decrypted). */
export async function liveLlm(db: DbOrTx): Promise<LlmProvider | null> {
  const row = await load(db);
  if (!row) return null;
  try {
    return openAiCompatibleLlm({ baseUrl: row.value.baseUrl, model: row.value.model, token: decrypt(row.value.token) });
  } catch (err) {
    console.error('KI-Token kann nicht entschlüsselt werden (APP_SECRET geändert?)', err);
    return null;
  }
}
