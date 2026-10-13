import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Prefixed random ids like `cus_7H2K9Q4M1XTZ` (prefix makes ids readable in logs). */
export function newId(prefix: string, length = 14): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function randomCode(length: number): string {
  return newId('x', length).slice(2);
}
