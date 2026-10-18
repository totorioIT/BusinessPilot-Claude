import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Third-party API tokens (e.g. the LLM account) are stored encrypted with APP_SECRET, which
// lives only in the server's .env, so a database dump alone doesn't reveal them.

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error('APP_SECRET fehlt oder ist zu kurz.');
  return createHash('sha256').update(secret).digest();
}

export function canEncrypt(): boolean {
  return (process.env.APP_SECRET?.length ?? 0) >= 32;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decrypt(stored: string): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unbekanntes Format für verschlüsselten Wert.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
