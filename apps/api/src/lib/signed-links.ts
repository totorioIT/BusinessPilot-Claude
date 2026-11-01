import { createHmac, timingSafeEqual } from 'node:crypto';
import { canEncrypt } from './secretbox.js';

// Links in customer emails (unsubscribe, confirm consent) carry a signed token instead of a
// database id, so nobody can unsubscribe or confirm on behalf of another customer by guessing.
// The signature uses APP_SECRET, which lives only in the server's .env.

export type LinkPurpose = 'unsubscribe' | 'confirm';
export type LinkClaims = { p: LinkPurpose; t: string; c: string; ch: string; exp?: number };

function mac(payload: string): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) throw new Error('APP_SECRET fehlt oder ist zu kurz.');
  return createHmac('sha256', `links:${secret}`).update(payload).digest();
}

export const canSignLinks = canEncrypt;

export function signLink(claims: LinkClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${mac(payload).toString('base64url')}`;
}

/** Returns the claims of a valid, unexpired token for the given purpose, otherwise null. */
export function verifyLink(token: string, purpose: LinkPurpose, now = Date.now()): LinkClaims | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  let expected: Buffer;
  try {
    expected = mac(payload);
  } catch {
    return null;
  }
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LinkClaims;
    if (claims.p !== purpose || typeof claims.t !== 'string' || typeof claims.c !== 'string' || typeof claims.ch !== 'string') return null;
    if (claims.exp !== undefined && claims.exp < now) return null;
    return claims;
  } catch {
    return null;
  }
}
