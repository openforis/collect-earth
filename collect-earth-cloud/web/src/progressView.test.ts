import { describe, expect, it } from "vitest";
import { toProgressData, type AttentionItem, type Forecast } from "./api";
import { translator } from "./i18n";
import {
  attentionAction,
  attentionText,
  barValue,
  dayText,
  forecastSentences,
  niceStep,
  paceText,
  percentText,
  personDetail,
  progressChart,
  progressDraftOf,
  readProgressDraft,
  updatedText,
} from "./progressView";

const t = translator("en");
const forecast = (over: Partial<Forecast> = {}): Forecast => ({
  target: 800,
  targetFrom: "assigned",
  remaining: 700,
  pacePerDay: 85.2,
  paceDays: 14,
  daysLeft: 12,
  endDate: "2026-11-13",
  deadline: null,
  daysToDeadline: null,
  daysOver: null,
  neededPerDay: null,
  ...over,
});
const item = (over: Partial<AttentionItem>): AttentionItem => ({
  kind: "quiet",
  count: 2,
  people: [],
  quietDays: 3,
  unknownVersion: 0,
  level: null,
  usedBytes: null,
  limitBytes: null,
  ...over,
});

describe("updated text", () => {
  it("just now, seconds, minutes", () => {
    expect(updatedText(t, 1000, 3000)).toBe("Updated just now");
    expect(updatedText(t, 0, 20_400)).toBe("Updated 20 s ago");
    expect(updatedText(t, 0, 185_000)).toBe("Updated 3 min ago");
  });
});

describe("numbers and days", () => {
  it("days are calendar days, whatever the browser's zone", () => {
    expect(dayText("2026-11-10", "en")).toBe("Nov 10, 2026");
    expect(dayText("2026-11-10", "en", "short")).toBe("Nov 10");
    expect(dayText("nonsense", "en")).toBe("nonsense");
  });
  it("shares, bars and the pace", () => {
    expect(percentText(1, 4, "en")).toBe("25%");
    expect(percentText(1, 0, "en")).toBe("–");
    expect(barValue(5, 4)).toBe(100);
    expect(barValue(1, 0)).toBe(0);
    expect(paceText(0.43, "en")).toBe("0.4");
    expect(paceText(85.2, "en")).toBe("85");
  });
});

describe("forecast sentences", () => {
  it("the pace, the days left and the end", () => {
    expect(forecastSentences(t, forecast(), "en")).toEqual([
      "At the pace of the last 14 days (about 85 plots a day), the 700 plots left take about 12 days: around Nov 13, 2026.",
    ]);
    expect(forecastSentences(t, forecast({ daysLeft: 1, endDate: "2026-11-02" }), "en")[0]).toContain("take about a day: around Nov 2, 2026");
  });

  it("late for the deadline: how late, and the plots a day needed", () => {
    expect(forecastSentences(t, forecast({ deadline: "2026-11-09", daysToDeadline: 8, daysOver: 4, neededPerDay: 78 }), "en").slice(1)).toEqual([
      "That is 4 days after the deadline, Nov 9, 2026.",
      "To finish by the deadline, about 78 plots a day are needed.",
    ]);
  });

  it("in time; no pace; done; passed; nothing to aim at", () => {
    expect(forecastSentences(t, forecast({ deadline: "2026-12-01", daysToDeadline: 30, daysOver: -18, neededPerDay: 23 }), "en")[1]).toBe(
      "That is in time for the deadline, Dec 1, 2026.",
    );
    expect(forecastSentences(t, forecast({ deadline: "2026-12-01", daysToDeadline: 30, daysOver: -18, neededPerDay: 23 }), "en")).toHaveLength(2);
    const noPace = forecastSentences(t, forecast({ daysLeft: null, endDate: null, deadline: "2026-12-01", daysToDeadline: 30, neededPerDay: 24 }), "en");
    expect(noPace).toEqual([
      "No plots were submitted in the last 14 days, so the end cannot be estimated yet.",
      "To finish by the deadline, about 24 plots a day are needed.",
    ]);
    expect(forecastSentences(t, forecast({ remaining: 0, daysLeft: 0 }), "en")).toEqual(["All 800 plots of the target are submitted."]);
    expect(forecastSentences(t, forecast({ deadline: "2026-10-01", daysToDeadline: -31, daysOver: 43 }), "en")[1]).toBe("The deadline, Oct 1, 2026, has passed.");
    expect(forecastSentences(t, forecast({ target: 0, remaining: 0 }), "en")[0]).toContain("No plot is given to anyone yet");
  });
});

describe("attention cards", () => {
  it("each kind has a title, a sentence and a place to fix it", () => {
    for (const kind of ["quiet", "neverDownloaded", "notAssigned", "oldUnsentWork", "differencesWaiting", "storage", "oldProjectFile", "oldCollectEarth"] as const) {
      const text = attentionText(t, item({ kind, level: "nearlyFull" }), "en");
      expect(text.title, kind).not.toMatch(/^attention\./);
      expect(text.text.length, kind).toBeGreaterThan(0);
      expect(attentionAction(t, kind).label, kind).toMatch(/^Go to /);
    }
    expect(attentionAction(t, "notAssigned").tab).toBe("plots");
    expect(attentionAction(t, "differencesWaiting").tab).toBe("quality");
    expect(attentionAction(t, "storage").tab).toBe("setup");
  });

  it("one and many", () => {
    expect(attentionText(t, item({ count: 1 }), "en").text[0]).toBe("One person with plots left has not sent anything for 3 days or more.");
    expect(attentionText(t, item({ count: 1200, kind: "notAssigned" }), "en").text[0]).toBe("1,200 plots are not given to anyone, so nobody will collect them.");
  });

  it("an old Collect Earth and unknown versions are said apart", () => {
    expect(attentionText(t, item({ kind: "oldCollectEarth", count: 0, unknownVersion: 2 }), "en")).toEqual({
      title: "Collect Earth version unknown",
      text: ["For 2 people, the version of Collect Earth could not be told yet."],
    });
    expect(attentionText(t, item({ kind: "oldCollectEarth", count: 1, unknownVersion: 1 }), "en").text).toHaveLength(2);
  });

  it("what is said by each person", () => {
    const quiet = item({});
    expect(personDetail(t, quiet, { username: "ana", lastSyncAt: 5, medianDelayMs: null }, "en", () => "Oct 28")).toBe("last sent Oct 28");
    const late = item({ kind: "oldUnsentWork" });
    expect(personDetail(t, late, { username: "ana", lastSyncAt: null, medianDelayMs: 3.26 * 86_400_000 }, "en", String)).toBe("about 3.3 days late");
    expect(personDetail(t, item({ kind: "neverDownloaded" }), { username: "ana", lastSyncAt: null, medianDelayMs: null }, "en", String)).toBeNull();
  });
});

describe("the chart", () => {
  const box = { width: 300, height: 200, left: 40, right: 10, top: 10, bottom: 30 };
  const days = [
    { date: "2026-10-30", submitted: 0, cumulative: 10 },
    { date: "2026-10-31", submitted: 5, cumulative: 15 },
    { date: "2026-11-01", submitted: 23, cumulative: 38 },
  ];

  it("round gridlines", () => {
    expect(niceStep(38)).toBe(10);
    expect(niceStep(1200)).toBe(500);
    expect(niceStep(0)).toBe(1);
    expect(niceStep(3)).toBe(1);
  });

  it("days from left to right, the total from the bottom; the scale reaches the target", () => {
    const c = progressChart(days, box, null);
    expect(c.points.map((p) => p.x)).toEqual([40, 165, 290]);
    expect(c.ticks.map((tk) => tk.value)).toEqual([0, 10, 20, 30, 40]);
    expect(c.points[2].y).toBeCloseTo(10 + (1 - 38 / 40) * 160);
    expect(c.path.startsWith("M40,")).toBe(true);
    expect(c.area.endsWith("Z")).toBe(true);
    expect(c.targetY).toBeNull();
    const withTarget = progressChart(days, box, 100);
    expect(withTarget.ticks.at(-1)!.value).toBe(100);
    expect(withTarget.targetY).toBe(10);
  });

  it("no days: nothing to draw", () => {
    const c = progressChart([], box, null);
    expect(c.path).toBe("");
    expect(c.area).toBe("");
  });
});

describe("the settings form", () => {
  it("reads what is typed, as the server checks it", () => {
    expect(readProgressDraft({ deadline: "2026-12-31", targetPlots: "1,200", quietDays: "5" })).toEqual({
      problems: {},
      settings: { deadline: "2026-12-31", targetPlots: 1200, quietDays: 5 },
    });
    expect(readProgressDraft({ deadline: "", targetPlots: "", quietDays: "3" }).settings).toEqual({ deadline: null, targetPlots: null, quietDays: 3 });
    expect(readProgressDraft({ deadline: "2026-02-30", targetPlots: "0", quietDays: "0" }).problems).toEqual({
      deadline: "progressSettings.badDeadline",
      targetPlots: "progressSettings.badTarget",
      quietDays: "progressSettings.badQuiet",
    });
    expect(readProgressDraft({ deadline: "", targetPlots: "12a", quietDays: "400" }).problems).toEqual({
      targetPlots: "progressSettings.badTarget",
      quietDays: "progressSettings.badQuiet",
    });
    expect(progressDraftOf({ deadline: null, targetPlots: 40, quietDays: 3 })).toEqual({ deadline: "", targetPlots: "40", quietDays: "3" });
  });
});

describe("toProgressData", () => {
  it("fills what is missing and keeps only the cards it knows", () => {
    const d = toProgressData({
      totals: { plots: 4, submitted: "2" },
      daily: [{ date: "2026-11-01", submitted: 2, cumulative: 2 }, { date: "bad" }],
      attention: [{ kind: "quiet", count: 1, people: [{ username: "ana", lastSyncAt: 5 }], quietDays: 3 }, { kind: "future" }],
      settings: { deadline: "2026-12-31", targetPlots: 0 },
    });
    expect(d.totals).toEqual({ plots: 4, assigned: 0, notAssigned: 0, submitted: 2, started: 0, notStarted: 0 });
    expect(d.daily).toEqual([{ date: "2026-11-01", submitted: 2, cumulative: 2 }]);
    expect(d.attention).toHaveLength(1);
    expect(d.attention![0].people[0]).toEqual({ username: "ana", lastSyncAt: 5, medianDelayMs: null });
    expect(d.settings).toEqual({ deadline: "2026-12-31", targetPlots: null, quietDays: 3 });
    expect(toProgressData({ attention: null }).attention).toBeNull();
    expect(toProgressData({}).forecast.paceDays).toBe(14);
  });
});
