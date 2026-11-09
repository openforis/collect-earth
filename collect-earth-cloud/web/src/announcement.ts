import type { Announcement } from "./api";

/** What a dismissal remembers: the message and its end, so a new message (or a new end) shows again. */
export function announcementKey(a: Announcement): string {
  return `${a.until ?? ""}|${a.text}`;
}

/** The announcement to show now, or null: none, dismissed by this person, or over (the page may stay open past its end). */
export function shownAnnouncement(a: Announcement | null, dismissed: string | null, now: number): Announcement | null {
  if (!a || dismissed === announcementKey(a) || (a.until !== null && a.until <= now)) return null;
  return a;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A time as a datetime-local box shows it (the browser's time zone); "" for none. */
export function toLocalInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local box's value as a time (it is read in the browser's time zone); null when empty or not a time. */
export function fromLocalInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}
