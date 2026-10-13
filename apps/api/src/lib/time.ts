// Small timezone helpers so business hours ("08:00" in Europe/Berlin) map to correct UTC instants,
// including across daylight-saving changes. No dependency needed for this.

function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** "2026-08-25" + "14:00" in `timeZone` → UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60000;
  // Second pass fixes the guess when the offset differs at the target instant (DST switch days).
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess);
}

/** ISO weekday 1 (Mon) … 7 (Sun) of a calendar date. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function localTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', minute: '2-digit' }).format(instant);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function isoWeek(instant: Date, timeZone: string): number {
  const [y, m, d] = localDate(instant, timeZone).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const dayNames = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** "Dienstag, 25. August um 14:00 Uhr", for spoken summaries and messages. */
export function spokenDateTime(instant: Date, timeZone: string): string {
  const date = localDate(instant, timeZone);
  const day = dayNames[isoWeekday(date)];
  const dm = new Intl.DateTimeFormat('de-DE', { timeZone, day: 'numeric', month: 'long' }).format(instant);
  return `${day}, ${dm} um ${localTime(instant, timeZone)} Uhr`;
}
