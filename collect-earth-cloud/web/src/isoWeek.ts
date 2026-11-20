// ISO weeks (YYYY-Www), with no imports: the router checks a week address with them, and the activity pages compute
// with them (activityView.ts).

const pad = (n: number) => String(n).padStart(2, "0");

/** The ISO week (YYYY-Www) of a calendar day: the week's Thursday gives the year. */
export function isoWeekOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = Date.UTC(y, m - 1, d);
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  const thursday = new Date(day + (3 - weekday) * 86_400_000);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * 86_400_000));
  return `${year}-W${pad(week)}`;
}

/** The Monday of an ISO week. */
export function weekMonday(week: string): string {
  const year = Number(week.slice(0, 4));
  const n = Number(week.slice(6, 8));
  const jan4 = Date.UTC(year, 0, 4);
  const weekday = (new Date(jan4).getUTCDay() + 6) % 7;
  return new Date(jan4 + (-weekday + (n - 1) * 7) * 86_400_000).toISOString().slice(0, 10);
}

/** A week that exists: YYYY-Www, and its number one the year has (W53 only in a year of 53 weeks, never W00). */
export function isIsoWeek(text: string | null | undefined): text is string {
  if (!text || !/^\d{4}-W\d{2}$/.test(text)) return false;
  const n = Number(text.slice(6, 8));
  return n >= 1 && n <= 53 && isoWeekOf(weekMonday(text)) === text;
}
