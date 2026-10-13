// Formatierung: Geld (Cent → EUR), Datum/Zeit in der Mandanten-Zeitzone, relative Zeit, Plural.

const LOCALE = 'de-DE';
let timeZone = 'Europe/Berlin';

export function setTimeZone(tz: string | null | undefined) {
  if (!tz) return;
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz });
    timeZone = tz;
  } catch {
    timeZone = 'Europe/Berlin';
  }
}
export function getTimeZone() {
  return timeZone;
}

const eur = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR' });
export function formatMoney(cents: number | null | undefined): string {
  return eur.format((cents ?? 0) / 100);
}
const eurShort = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export function formatMoneyShort(cents: number | null | undefined): string {
  return eurShort.format(Math.round((cents ?? 0) / 100));
}

/** Euro-Eingabe ("1.234,50" oder "1234.5") → Cent. Ungültig → null. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '');
  if (!s) return 0;
  let normalized = s;
  if (s.includes(',')) normalized = s.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
export function centsToEuroInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

function fmt(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(LOCALE, { timeZone, ...opts }).format(d);
}

/** 22. Aug. 2026 */
export const formatDate = (iso: string | null | undefined) => fmt(iso, { day: 'numeric', month: 'short', year: 'numeric' });
/** 10:30 */
export const formatTime = (iso: string | null | undefined) => fmt(iso, { hour: '2-digit', minute: '2-digit' });
/** 16. Aug., 18:55 */
export const formatDateTime = (iso: string | null | undefined) =>
  fmt(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** Dienstag, 25. August 2026 */
export const formatLongDate = (iso: string | null | undefined) =>
  fmt(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Reines Datum "YYYY-MM-DD" (ohne Zeitzone) → 22. Aug. 2026 */
export function formatDay(day: string | null | undefined): string {
  if (!day) return '–';
  const d = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}
export function formatLongDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE, { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/** Kalendertag (YYYY-MM-DD) eines Zeitpunkts in der Mandanten-Zeitzone. */
export function dayKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function todayKey(): string {
  return dayKey(new Date());
}
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto', style: 'short' });
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '–';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '–';
  const diffSec = Math.round((t - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return 'gerade eben';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  // Tage nach Kalendertagen in der Mandanten-Zeitzone
  const days = Math.round(
    (new Date(`${dayKey(new Date(t))}T00:00:00Z`).getTime() - new Date(`${dayKey(new Date(now))}T00:00:00Z`).getTime()) /
      86400000,
  );
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  return formatDate(iso);
}

export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString(LOCALE)} ${n === 1 ? one : many}`;
}

/** Minuten → "45 Minuten", "1 Stunde", "2,5 Stunden" */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes || 0);
  if (m < 60) return plural(m, 'Minute', 'Minuten');
  const h = Math.round((m / 60) * 10) / 10;
  return `${h.toLocaleString(LOCALE)} ${h === 1 ? 'Stunde' : 'Stunden'}`;
}

/** Sekunden → "3:04" */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '–';
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatNumber(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(LOCALE);
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}
