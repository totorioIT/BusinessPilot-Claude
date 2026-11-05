import { createHash } from 'node:crypto';
import { badRequest } from '../lib/errors.js';

// Rules for every password a person chooses (change, reset, first login). Length counts more
// than character classes (NIST SP 800-63B); known leaked passwords are refused.

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/**
 * How often the password appears in known data breaches, via the Pwned Passwords range API.
 * Only the first 5 characters of the SHA-1 hash leave the server (k-anonymity), and the answer
 * is padded so its size gives nothing away. Returns null when the service can't be reached.
 */
export async function breachCount(password: string): Promise<number | null> {
  const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'BusinessPilot' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    for (const line of (await res.text()).split('\n')) {
      const [s, count] = line.trim().split(':');
      if (s === suffix) return Number(count) || 0;
    }
    return 0;
  } catch {
    return null;
  }
}

/** Throws a readable 400 when the new password is not acceptable. */
export async function assertAcceptablePassword(password: string, ctx: { email: string; name?: string }) {
  if (password.length < MIN_PASSWORD_LENGTH) throw badRequest(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`, 'weak_password');
  if (password.length > MAX_PASSWORD_LENGTH) throw badRequest(`Das Passwort darf höchstens ${MAX_PASSWORD_LENGTH} Zeichen haben.`, 'weak_password');
  const lower = password.toLowerCase();
  const local = ctx.email.split('@')[0]?.toLowerCase() ?? '';
  if (lower === ctx.email.toLowerCase() || (local.length >= 4 && lower.includes(local))) {
    throw badRequest('Das Passwort darf nicht die E-Mail-Adresse enthalten.', 'weak_password');
  }
  if (/^(.)\1+$/.test(password)) throw badRequest('Das Passwort ist zu einfach.', 'weak_password');
  const count = await breachCount(password);
  // When the check service is down we don't block the person; length rules still apply.
  if (count === null) console.warn('Pwned-Passwords-Prüfung nicht erreichbar, Passwort ohne Abgleich akzeptiert.');
  if (count && count > 0) {
    throw badRequest('Dieses Passwort ist aus Datenlecks bekannt und wird von Angreifern ausprobiert. Bitte ein anderes wählen.', 'breached_password');
  }
}
