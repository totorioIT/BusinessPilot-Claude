import { randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { sha256 } from '../lib/crypto.js';
import { decrypt, encrypt } from '../lib/secretbox.js';

// Two-factor login with an authenticator app (TOTP, RFC 6238) via otplib. The secret is stored
// encrypted with APP_SECRET; each accepted code's time step is remembered so it can't be reused.
// Ten recovery codes, stored only as hashes, help when the phone is lost.

const ISSUER = 'BusinessPilot';
/** One period (30 s) before and after, for clocks that are slightly off. */
const TOLERANCE_SECONDS = 30;
const RECOVERY_CODE_COUNT = 10;

export async function newMfaSetup(email: string) {
  const secret = generateSecret();
  const uri = generateURI({ issuer: ISSUER, label: email, secret });
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, encrypted: encrypt(secret), uri, qrSvg };
}

const isTotpCode = (code: string) => /^\d{6}$/.test(code);
const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Checks a 6-digit code against the encrypted secret. Returns the time step on success. */
export async function verifyTotp(encryptedSecret: string, code: string, lastStep: number | null): Promise<number | null> {
  const token = code.replace(/\s/g, '');
  if (!isTotpCode(token)) return null;
  const result = await verify({
    secret: decrypt(encryptedSecret),
    token,
    epochTolerance: TOLERANCE_SECONDS,
    ...(lastStep !== null ? { afterTimeStep: lastStep } : {}),
  });
  return result.valid && 'timeStep' in result ? result.timeStep : null;
}

export function newRecoveryCodes() {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = randomBytes(5).toString('hex'); // 10 hex characters, 40 bits
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(normalizeRecovery(c))) };
}

/** Returns the remaining hashes when the code is one of them, otherwise null. */
export function useRecoveryCode(hashes: string[], code: string): string[] | null {
  const h = sha256(normalizeRecovery(code));
  if (normalizeRecovery(code).length !== 10 || !hashes.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}
