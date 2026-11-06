import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';

// Passwords are hashed with Argon2id (OWASP parameters: 19 MiB memory, 2 iterations,
// 1 lane), each with its own random salt. Accounts from before this change still carry a
// scrypt hash; it is checked as before and replaced by Argon2id at the next successful login.

const ARGON2 = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2);
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('$argon2')) {
    try {
      return await argon2Verify(stored, password);
    } catch {
      return false;
    }
  }
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(expected, actual);
}

/** True for hashes from before Argon2id, which should be replaced after the next login. */
export const needsRehash = (stored: string) => !stored.startsWith('$argon2id$');

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Tokens are stored only as hashes so a database leak doesn't expose live sessions or keys. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
