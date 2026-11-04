import { describe, expect, it } from "vitest";
import type { PersonRow } from "./api";
import { translator } from "./i18n";
import {
  agoText,
  bucketLabel,
  calendarWeeks,
  csvCell,
  durationText,
  filterPeople,
  heatLevel,
  inviteRowText,
  invitesShown,
  peopleCsv,
  removalText,
  sortPeople,
  statusChip,
  statusSyncLevel,
} from "./peopleView";

const t = translator("en");
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-01T12:00:00Z");

function row(username: string, over: Partial<PersonRow> = {}): PersonRow {
  return {
    userId: `u-${username}`,
    username,
    role: "operator",
    plots: { assigned: 10, submitted: 4, started: 1, remaining: 6, done: 0.4 },
    checks: { assigned: 0, submitted: 0, remaining: 0 },
    submittedLast7: 2,
    medianPerDay: 2,
    lastSyncAt: NOW - DAY,
    lastPlotsDownloadAt: null,
    lastSubmittedAt: NOW - DAY,
    agreement: null,
    status: { kind: "working", days: null, level: null },
    ...over,
  };
}

describe("status chips and the last sync", () => {
  it("words and colours, quiet amber then red", () => {
    expect(statusChip(t, { kind: "working", days: null, level: null })).toEqual({ label: "Working", color: "primary" });
    expect(statusChip(t, { kind: "quiet", days: 4, level: "amber" })).toEqual({ label: "Quiet for 4 days", color: "warning" });
    expect(statusChip(t, { kind: "quiet", days: 1, level: "amber" }).label).toBe("Quiet for 1 day");
    expect(statusChip(t, { kind: "quiet", days: 9, level: "red" }).color).toBe("error");
    expect(statusChip(t, { kind: "finished", days: null, level: null }).color).toBe("success");
  });

  it("a disabled account says so, with no sync warning", () => {
    expect(statusChip(t, { kind: "disabled", days: null, level: null })).toEqual({ label: "Account disabled", color: "default" });
    expect(statusSyncLevel({ kind: "disabled", days: null, level: null })).toBeNull();
  });

  it("the last sync's warning follows the status: quiet amber, then red; never for finished people", () => {
    expect(statusSyncLevel({ kind: "quiet", days: 4, level: "amber" })).toBe("amber");
    expect(statusSyncLevel({ kind: "quiet", days: 7, level: "red" })).toBe("red");
    expect(statusSyncLevel({ kind: "finished", days: null, level: null })).toBeNull();
    expect(statusSyncLevel({ kind: "working", days: null, level: null })).toBeNull();
  });

  it("how long ago", () => {
    expect(agoText(t, null, NOW)).toBe("Never");
    expect(agoText(t, NOW - 20_000, NOW)).toBe("Just now");
    expect(agoText(t, NOW - 2 * 3_600_000, NOW)).toBe("2 hours ago");
    expect(agoText(t, NOW - DAY, NOW)).toBe("1 day ago");
  });
});

describe("sorting and filtering", () => {
  const rows = [
    row("bea", { submittedLast7: 5, lastSyncAt: null }),
    row("Ana", { submittedLast7: 1, status: { kind: "quiet", days: 7, level: "red" } }),
    row("carl", { submittedLast7: 5, status: { kind: "quiet", days: 4, level: "amber" } }),
  ];
  it("by a column either way, empty values last, ties by name", () => {
    expect(sortPeople(rows, "username", "asc").map((r) => r.username)).toEqual(["Ana", "bea", "carl"]);
    expect(sortPeople(rows, "last7", "desc").map((r) => r.username)).toEqual(["bea", "carl", "Ana"]);
    expect(sortPeople(rows, "lastSync", "asc").at(-1)!.username).toBe("bea");
    expect(sortPeople(rows, "lastSync", "desc").at(-1)!.username).toBe("bea");
    // The most worrying first: quiet the longest.
    expect(sortPeople(rows, "status", "asc").map((r) => r.username)).toEqual(["Ana", "carl", "bea"]);
  });
  it("by name and status", () => {
    expect(filterPeople(rows, " AN", "all").map((r) => r.username)).toEqual(["Ana"]);
    expect(filterPeople(rows, "", "quiet").map((r) => r.username)).toEqual(["Ana", "carl"]);
    expect(filterPeople(rows, "", "invited")).toEqual([]);
  });
  it("by agreement under the minimum of checks: by how many checks so far, then by name", () => {
    const few = [
      row("dan", { agreement: { compared: 3, agreeing: 2, rate: null } }),
      row("bea", { agreement: null }),
      row("Ana", { agreement: { compared: 12, agreeing: 9, rate: null } }),
      row("carl", { agreement: { compared: 3, agreeing: 3, rate: null } }),
    ];
    expect(sortPeople(few, "agreement", "asc").map((r) => r.username)).toEqual(["bea", "carl", "dan", "Ana"]);
    expect(sortPeople(few, "agreement", "desc").map((r) => r.username)).toEqual(["Ana", "carl", "dan", "bea"]);
    // A rate, when someone has one, still comes first.
    const mixed = [...few, row("eve", { agreement: { compared: 25, agreeing: 20, rate: 0.8 } })];
    expect(sortPeople(mixed, "agreement", "asc")[0].username).toBe("eve");
  });
  it("the open links under the table: all of them, or with \"Invited, not joined\" only the invitations", () => {
    const invites = [{ id: "i1", forUsername: null }, { id: "i2", forUsername: "rita" }];
    expect(invitesShown(invites, "", "all").map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(invitesShown(invites, "", "invited").map((i) => i.id)).toEqual(["i1"]);
    expect(invitesShown(invites, "", "quiet")).toEqual([]);
    expect(invitesShown(invites, "ana", "all")).toEqual([]);
  });
});

describe("the list of open links", () => {
  it("a link made on a person's page says whom it is for", () => {
    expect(inviteRowText(t, { role: "operator", usedCount: 0, maxUses: 1, forUsername: "rita" })).toBe("Link for the new project file: rita · used by 0 of 1");
    expect(inviteRowText(t, { role: "reviewer", usedCount: 1, maxUses: 3, forUsername: null })).toBe("Reviewer · used by 1 of 3");
  });
});

describe("the CSV", () => {
  it("text a spreadsheet would run as a formula gets a ' in front", () => {
    for (const bad of ["=1+1", "+1", "-2", "@SUM(A1)", "\tx", "\rx"]) expect(csvCell(bad).replace(/^"/, "").startsWith("'"), bad).toBe(true);
    expect(csvCell("=HYPERLINK(\"x\",\"y\")")).toBe('"\'=HYPERLINK(""x"",""y"")"');
    expect(csvCell("ana")).toBe("ana");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
  });

  it("a header in the person's language, one row per person", () => {
    const csv = peopleCsv(t, [row("=cmd", { agreement: { compared: 30, agreeing: 27, rate: 0.9 } })], () => "2026-10-31 13:00");
    const lines = csv.trimEnd().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("Name,Role,Status,Plots given")).toBe(true);
    expect(lines[1]).toBe("'=cmd,Collector,Working,10,4,1,6,40,0,0,2,2,2026-10-31 13:00,2026-10-31 13:00,90,30");
  });
});

describe("the CSV in other languages, and the remove dialog", () => {
  it("Spanish, French, Portuguese: a semicolon between cells and a decimal comma; My work rows have no checks", () => {
    const es = translator("es");
    const csv = peopleCsv(es, [row("ana;b", { medianPerDay: 2.5, checks: null, plots: { assigned: 3, submitted: 1, started: 0, remaining: 2, done: 1 / 3 } })], () => "t", "es");
    const [head, line] = csv.trimEnd().split(/\r?\n/);
    expect(head.split(";")[0]).toBe("Nombre");
    expect(line.startsWith('"ana;b";Recolector;')).toBe(true);
    expect(line).toContain(";33,3;;;2;2,5;");
    expect(csvCell("1,5", { separator: ";", decimal: "," })).toBe("1,5");
    expect(csvCell("a;b", { separator: ";", decimal: "," })).toBe('"a;b"');
  });

  it("what removing someone leaves, one or many, numbers in the person's language", () => {
    expect(removalText(t, null, "en")).toEqual([]);
    expect(removalText(t, { plots: 0, copies: 0 }, "en")).toEqual([]);
    const [plots, copies] = removalText(t, { plots: 1200, copies: 1 }, "en");
    expect(plots.startsWith("1,200 plots that only they hold")).toBe(true);
    expect(copies.startsWith("1 copy to compare")).toBe(true);
    expect(removalText(translator("fr"), { plots: 1, copies: 0 }, "fr")[0].startsWith("1 parcelle")).toBe(true);
  });
});

describe("the activity calendar", () => {
  it("week columns, Monday first, from the first day with a submission to today", () => {
    // 2026-10-28 is a Wednesday; 2026-11-01 a Sunday.
    const cal = calendarWeeks([{ date: "2026-10-28", plots: 2, checks: 1 }], "2026-11-01");
    expect(cal.weeks).toHaveLength(1);
    expect(cal.weeks[0][0]).toBeNull();
    expect(cal.weeks[0][2]).toEqual({ date: "2026-10-28", plots: 2, checks: 1, count: 3 });
    expect(cal.weeks[0][6]!.date).toBe("2026-11-01");
    expect(cal.max).toBe(3);
    const empty = calendarWeeks([], "2026-11-01");
    expect(empty.from).toBe("2026-10-05");
    expect(empty.weeks.flat().filter(Boolean)).toHaveLength(28);
    const long = calendarWeeks([{ date: "2020-01-01", plots: 1, checks: 0 }], "2026-11-01", 53);
    expect(long.weeks.length).toBeLessThanOrEqual(54);
  });

  it("shades in even steps of the busiest day", () => {
    expect([0, 1, 3, 5, 8].map((c) => heatLevel(c, 8))).toEqual([0, 1, 2, 3, 4]);
    expect(heatLevel(1, 1)).toBe(4);
  });
});

describe("speed words", () => {
  it("durations and bins", () => {
    expect(durationText(t, 8_000)).toBe("8 s");
    expect(durationText(t, 90_000)).toBe("1 min 30 s");
    expect(durationText(t, 12 * 60_000)).toBe("12 min");
    const buckets = [{ upToMs: 15_000 }, { upToMs: 30_000 }];
    expect(bucketLabel(t, buckets, 0)).toBe("under 15 s");
    expect(bucketLabel(t, buckets, 1)).toBe("15 s to 30 s");
  });
});

describe("reading the server's answers", () => {
  it("people: a status it does not know reads as working; quiet keeps its days and level", async () => {
    const { toPeopleData, toPersonData } = await import("./api");
    const data = toPeopleData({
      today: "2026-11-01",
      people: [
        { userId: "u1", username: "ana", role: "operator", status: { kind: "quiet", days: 7, level: "red" }, agreement: null },
        { userId: "u2", username: "bo", role: "boss", status: { kind: "dancing" }, agreement: { compared: 3, agreeing: 2, rate: null } },
      ],
      invites: [{ id: "i", role: "reviewer", maxUses: 2, usedCount: 1 }],
    });
    expect(data.people[0].status).toEqual({ kind: "quiet", days: 7, level: "red" });
    expect(data.people[1]).toMatchObject({ role: "operator", status: { kind: "working", days: null, level: null }, agreement: { compared: 3, rate: null } });
    expect(data.invites[0]).toMatchObject({ role: "reviewer", maxUses: 2, usedCount: 1 });
    expect(data.week.days).toEqual([]);
    const person = toPersonData({
      hours: [1, 2],
      quality: { available: true, asFirst: null, sentBack: [{ plot: "7", comment: "x", decidedAt: 5 }, { plot: "8", comment: null, decidedAt: 6, submittedAgain: false, file: "To check again – a.csv" }] },
    });
    expect(person.hours).toHaveLength(24);
    expect(person.hours.slice(0, 3)).toEqual([1, 2, 0]);
    expect(person.quality).toMatchObject({
      available: true,
      asFirst: null,
      asChecker: null,
      sentBack: [
        { plot: "7", comment: "x", decidedAt: 5, decidedBy: null, submittedAgain: false, file: null },
        { plot: "8", comment: null, decidedAt: 6, submittedAgain: false, file: "To check again – a.csv" },
      ],
    });
    expect(person.sync.collectEarth).toBeNull();
  });
});
