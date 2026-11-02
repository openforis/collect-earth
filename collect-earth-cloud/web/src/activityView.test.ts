import { describe, expect, it } from "vitest";
import type { ActivityPage, LogItem } from "./api";
import { answerLabel, dailyCsv, dayAfterMs, dayStartMs, decisionsCsv, differencesCsv, isIsoWeek, isoWeekOf, logSentence, shiftWeek, weekMonday } from "./activityView";
import { csvText } from "./csv";
import { translator } from "./i18n";

const t = translator("en");
const fr = translator("fr");
const page: Pick<ActivityPage, "people" | "files"> = {
  people: { u1: { name: "ana", removed: false }, u2: { name: "ben", removed: true }, u3: { name: null, removed: true } },
  files: { f1: "north.csv", f2: null },
};
const record = (change: Extract<LogItem, { type: "record" }>["change"], assessment: "main" | "check" | "other" = "main"): LogItem => ({
  type: "record",
  id: "r1",
  at: 0,
  receivedAt: 0,
  person: "maria",
  change,
  plot: "17",
  name: "17",
  assessment,
  round: "2025",
});
const audit = (action: string, details: Record<string, string | number | boolean | null>, person: string | null = "ana"): LogItem => ({
  type: "audit",
  id: "a1",
  at: 0,
  person,
  action,
  details,
  plotName: typeof details.plot === "string" ? details.plot : null,
});

describe("the log's sentences", () => {
  it("what Collect Earth did, with the id the collector sees; checks named for coordinators", () => {
    expect(logSentence(t, record("submitted"), page, "en")).toBe("maria submitted plot 17");
    expect(logSentence(t, record("resubmitted"), page, "en")).toBe("maria submitted plot 17 again");
    expect(logSentence(t, record("created"), page, "en")).toBe("maria started plot 17 (saved, not submitted)");
    expect(logSentence(t, record("updated"), page, "en")).toBe("maria saved plot 17 again, not submitted");
    expect(logSentence(t, record("unsubmitted"), page, "en")).toBe("maria changed plot 17 after submitting it (not submitted now)");
    expect(logSentence(t, record("deleted"), page, "en")).toBe("maria deleted plot 17");
    expect(logSentence(t, record("submitted", "check"), page, "en")).toBe("maria submitted the quality check of plot 17");
    expect(logSentence(t, record("submitted", "other"), page, "en")).toBe("maria submitted plot 17 (round 2025)");
  });

  it("what coordinators did, ids named as they are now; removed people and files say so", () => {
    expect(logSentence(t, audit("csv.uploaded", { csvFileId: "f1", plots: 1200 }), page, "en")).toBe("ana uploaded the plot file north.csv (1,200 plots)");
    expect(logSentence(t, audit("csv.uploaded", { csvFileId: "f2", plots: 3 }), page, "en")).toBe("ana uploaded the plot file a plot file since removed (3 plots)");
    expect(logSentence(t, audit("division.applied", { csvFileId: "f1", mode: "equal", people: 3, plots: 90 }), page, "en")).toBe("ana divided north.csv between 3 people");
    expect(logSentence(t, audit("member.removed", { userId: "u2" }), page, "en")).toBe("ana removed ben (no longer in the project) from the project");
    expect(logSentence(t, audit("member.role", { userId: "u1", role: "reviewer" }), page, "en")).toBe("ana made ana a Reviewer");
    expect(logSentence(t, audit("plots.moved", { csvFileId: "f1", fromUserId: "u3", toUserId: "u1", moved: 4 }), page, "en")).toBe(
      "ana moved 4 plots of north.csv from someone whose account was deleted to ana",
    );
    expect(logSentence(t, audit("decision.set", { plot: "17", decision: "check" }), page, "en")).toBe("ana decided plot 17: Check is right");
    expect(logSentence(t, audit("decision.bulk", { count: 12, decision: "first" }), page, "en")).toBe("ana decided 12 plots at once: First is right");
    expect(logSentence(t, audit("settings.changed", { setting: "ai", enabled: true }), page, "en")).toBe("ana turned the AI assistant on");
    expect(logSentence(t, audit("export.downloaded", { kind: "daily", rows: 3 }), page, "en")).toBe("ana downloaded the daily activity");
    expect(logSentence(t, audit("export.downloaded", { records: 50 }), page, "en")).toBe("ana downloaded the data (50 records)");
    expect(logSentence(t, audit("cep.replaced", {}, null), page, "en")).toBe("Someone no longer in the project uploaded a new project file");
    expect(logSentence(t, audit("link.created", {}), page, "en")).toBe("ana: link.created");
  });

  it("every language has every sentence (no key shown as is)", () => {
    for (const lang of ["es", "fr", "pt"]) {
      const tr = translator(lang);
      for (const item of [record("submitted", "check"), audit("plots.moved", { csvFileId: "f1", fromUserId: "u2", toUserId: "u1", moved: 4 }), audit("settings.changed", { setting: "progress" })]) {
        const s = logSentence(tr, item, page, lang);
        expect(s, lang).not.toMatch(/activity\.|\{/);
      }
    }
  });
});

describe("weeks in the browser's calendar", () => {
  it("ISO weeks, their Monday, the week before and after across years", () => {
    expect(isoWeekOf("2026-11-02")).toBe("2026-W45");
    expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
    expect(weekMonday("2026-W45")).toBe("2026-11-02");
    expect(weekMonday("2025-W01")).toBe("2024-12-30");
    expect(shiftWeek("2026-W53", 1)).toBe("2027-W01");
    expect(shiftWeek("2027-W01", -1)).toBe("2026-W53");
    expect(isIsoWeek("2026-W53")).toBe(true);
    expect(isIsoWeek("2025-W53")).toBe(false);
    expect(isIsoWeek("2026-W00")).toBe(false);
  });

  it("a day's bounds are local midnights", () => {
    const start = new Date(dayStartMs("2026-03-29"));
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()]).toEqual([2026, 2, 29, 0]);
    const end = new Date(dayAfterMs("2026-03-29"));
    expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([2, 30, 0]);
  });
});

describe("the downloads' CSV: one writer, formulas escaped, the person's separators", () => {
  it("text a spreadsheet would run as a formula gets a quote mark; Spanish uses ; and a decimal comma", () => {
    expect(csvText(["a", "b"], [["=cmd()", 1.5], ["+1", "@x"], ["-2", "a;b"]], "en")).toBe("a,b\r\n'=cmd(),1.5\r\n'+1,'@x\r\n'-2,a;b\r\n");
    expect(csvText(["a", "b"], [["=cmd()", 1.5], ["x,y", "a;b"]], "es")).toBe("a;b\r\n'=cmd();1,5\r\nx,y;\"a;b\"\r\n");
  });

  it("daily activity, decisions and differences", () => {
    expect(dailyCsv(t, [{ date: "2026-10-26", person: "=maria", plots: 2, checks: 0, submittedAgain: 1, drafts: 3, reopened: 0, deleted: 0 }], "en").split("\r\n")[1]).toBe(
      "2026-10-26,'=maria,2,0,1,3,0,0",
    );
    const decisions = decisionsCsv(fr, [{ plot: "17", name: "17", decision: "recheck", comment: "@look", decidedBy: "ana", decidedAt: 0, byAssessor: null, bulk: true }], () => "2026-11-01 10:00", "fr");
    expect(decisions.split("\r\n")[1]).toBe(`17;${fr("quality.decision.recheck")};'@look;ana;2026-11-01 10:00;;${fr("activity.csv.yes")}`);
    const options = { lu: [{ code: "F", label: "Forest" }] };
    expect(answerLabel(options, "lu", "F")).toBe("Forest (F)");
    expect(answerLabel(options, "lu", "X")).toBe("X");
    const diffs = differencesCsv(t, { rows: [{ plot: "1", name: "1", first: "maria", check: "ben", latest: true, decision: null, key: "lu", firstAnswer: "F", checkAnswer: "C" }], labels: { lu: "Land use" }, options }, "en");
    expect(diffs.split("\r\n")[1]).toBe("1,maria,ben,Land use,Forest (F),C,");
  });
});
