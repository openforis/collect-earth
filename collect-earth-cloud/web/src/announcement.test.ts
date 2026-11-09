import { describe, expect, it } from "vitest";
import { announcementKey, fromLocalInput, shownAnnouncement, toLocalInput } from "./announcement";

describe("the announcement banner", () => {
  const a = { text: "Maintenance on Sunday", until: 2_000 };

  it("shows a message until it is dismissed or expires", () => {
    expect(shownAnnouncement(null, null, 1_000)).toBeNull();
    expect(shownAnnouncement(a, null, 1_000)).toBe(a);
    expect(shownAnnouncement(a, announcementKey(a), 1_000)).toBeNull();
    expect(shownAnnouncement(a, null, 2_000)).toBeNull();
    expect(shownAnnouncement({ ...a, until: null }, null, 9e12)).not.toBeNull();
  });

  it("a new message (or a new end) shows again after an older one was dismissed", () => {
    const dismissed = announcementKey(a);
    expect(shownAnnouncement({ ...a, text: "Maintenance on Monday" }, dismissed, 1_000)).not.toBeNull();
    expect(shownAnnouncement({ ...a, until: 3_000 }, dismissed, 1_000)).not.toBeNull();
  });

  it("reads and writes the end time as the browser's local date and time", () => {
    const ms = new Date(2026, 10, 9, 14, 30).getTime();
    expect(toLocalInput(ms)).toBe("2026-11-09T14:30");
    expect(fromLocalInput("2026-11-09T14:30")).toBe(ms);
    expect(toLocalInput(null)).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("nonsense")).toBeNull();
  });
});
