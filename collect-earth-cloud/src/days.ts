// Calendar days in a time zone: the Progress tab counts plots per day as the person
// looking at it lives them (the browser sends its IANA time zone).

const DAY_MS = 86_400_000;
const ZONE_NAME = /^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/;
let supported: Set<string> | null = null;

/**
 * Whether `tz` is a time zone both this server and Postgres read the same way: one of
 * Intl.supportedValuesOf('timeZone'), "UTC", or another IANA name Intl knows (a browser
 * may send an alias such as Asia/Kolkata that the list names Asia/Calcutta). Offsets
 * such as "+05:30" are refused: Postgres reads them with the opposite sign.
 */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) {
    return false;
  }
  if (tz === 'UTC') {
    return true;
  }
  supported ??= new Set(Intl.supportedValuesOf('timeZone'));
  if (supported.has(tz)) {
    return true;
  }
  if (!ZONE_NAME.test(tz)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The calendar day (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(ms: number, timeZone: string): string {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Whether `text` is a real calendar day written YYYY-MM-DD. */
export function isDate(text: unknown): text is string {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

/** The day `n` calendar days after (before, when negative) `date`. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}
