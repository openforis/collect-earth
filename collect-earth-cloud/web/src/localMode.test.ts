import { describe, expect, it } from "vitest";
import { MAP_STATUSES, type Forecast, type LogItem, type MapPlots, type MapStatus, type PatternFlag, type SurveyHealthData } from "./api";
import { COORDINATOR_LOG_KINDS, logSentence } from "./activityView";
import { flagText } from "./flagsView";
import { orderText } from "./healthView";
import { CATALOGUES, LANGUAGES, translator, type MessageKey } from "./i18n";
import {
  activityDownloads,
  attentionShown,
  dataSections,
  isLocalTab,
  legendStatuses,
  LOCAL_TABS,
  localMapPlots,
  localPage,
  otherLogKinds,
  plotPageParts,
  projectTabs,
  qualitySections,
  settingsCards,
  totalStats,
  weeklyBlocks,
} from "./localMode";
import { plotPopup, statusLabelKey } from "./mapView";
import { choosePage } from "./pageChoice";
import { forecastSentences, forecastTargetKey } from "./progressView";
import { PROJECT_TABS, type Route } from "./router";

// The single-person view (the server's LOCAL_MODE, plan 2026-11-03-desktop-dashboard Task 4):
// what each tab shows with serverInfo.localMode, and that the cloud's view is unchanged without it.

const t = translator("en");
const local = { needsSetup: false, localMode: true };
const cloud = { needsSetup: false, localMode: false };

describe("local mode: pages and tabs", () => {
  it("has the Progress, Map, Data, Quality, Activity and Settings tabs, in the cloud's order", () => {
    expect(projectTabs(true)).toEqual(["progress", "map", "data", "quality", "activity", "settings"]);
    expect(PROJECT_TABS.filter((tab) => isLocalTab(tab))).toEqual([...LOCAL_TABS]);
    for (const hidden of ["people", "plots", "setup", "file"] as const) expect(isLocalTab(hidden)).toBe(false);
    expect(projectTabs(false)).toBe(PROJECT_TABS);
  });

  it("not signed in: no log-in form (there is no password), whatever the address", () => {
    for (const route of [{ name: "home" }, { name: "login" }, { name: "signup" }, { name: "join", token: "x" }, { name: "project", projectId: "p", tab: "progress" }] as Route[]) {
      expect(choosePage(route, local, false, null)).toEqual({ kind: "localSignedOut" });
    }
    // The cloud still logs in.
    expect(choosePage({ name: "home" }, cloud, false)).toEqual({ kind: "login" });
  });

  it("home is the one project's Progress tab (no project switcher)", () => {
    expect(choosePage({ name: "home" }, local, true, "p1")).toEqual({ kind: "redirect", to: "/projects/p1" });
    // Before the account's project is known: the home page itself.
    expect(choosePage({ name: "home" }, local, true, null)).toEqual({ kind: "route", route: { name: "home" } });
    expect(choosePage({ name: "home" }, cloud, true, "p1")).toEqual({ kind: "route", route: { name: "home" } });
  });

  it("opens the local tabs, plot pages and the weekly summary", () => {
    for (const tab of LOCAL_TABS) {
      const route: Route = { name: "project", projectId: "p1", tab };
      expect(choosePage(route, local, true, "p1")).toEqual({ kind: "route", route });
    }
    for (const route of [{ name: "plot", projectId: "p1", plot: "17" }, { name: "weekly", projectId: "p1", week: null }, { name: "notFound", path: "/x" }] as Route[]) {
      expect(choosePage(route, local, true, "p1")).toEqual({ kind: "route", route });
    }
  });

  it("sends pages about other people to Progress, and account, mail and invitation pages home", () => {
    const toProgress = { kind: "redirect", to: "/projects/p1" };
    for (const tab of ["people", "plots", "setup", "file"] as const) {
      expect(choosePage({ name: "project", projectId: "p1", tab }, local, true, "p1")).toEqual(toProgress);
    }
    for (const route of [
      { name: "plotFile", projectId: "p1", fileId: "f" },
      { name: "person", projectId: "p1", userId: "u" },
      { name: "myQuality", projectId: "p1" },
      { name: "myWork", projectId: "p1" },
      { name: "teamReport", projectId: "p1" },
    ] as Route[]) {
      expect(localPage(route, "p1")).toEqual(toProgress);
    }
    for (const route of [
      { name: "account" },
      { name: "server" },
      { name: "setup" },
      { name: "login" },
      { name: "signup" },
      { name: "join", token: "x" },
      { name: "reset", token: "x" },
      { name: "publicProgress", token: "x" },
      { name: "unsubscribe", token: "x" },
      { name: "confirmEmail", token: "x" },
    ] as Route[]) {
      expect(choosePage(route, local, true, "p1")).toEqual({ kind: "redirect", to: "/" });
    }
    // The cloud keeps them.
    expect(choosePage({ name: "join", token: "x" }, cloud, true).kind).toBe("route");
    expect(choosePage({ name: "account" }, cloud, true).kind).toBe("route");
  });
});

describe("local mode: Progress", () => {
  const forecast = (over: Partial<Forecast> = {}): Forecast => ({
    target: 0,
    targetFrom: "assigned",
    remaining: 0,
    pacePerDay: 0,
    paceDays: 14,
    daysLeft: null,
    endDate: null,
    deadline: null,
    daysToDeadline: null,
    daysOver: null,
    neededPerDay: null,
    ...over,
  });

  it("has no plots given to someone among the headline numbers", () => {
    expect(totalStats(true)).toEqual(["plots", "submitted", "started", "notStarted"]);
    expect(totalStats(false)).toEqual(["plots", "assigned", "submitted", "started", "notStarted"]);
  });

  it("has no Needs attention cards (all about other people)", () => {
    const cards = [{ kind: "quiet" }, { kind: "notAssigned" }, { kind: "oldProjectFile" }];
    expect(attentionShown(true, cards)).toBeNull();
    expect(attentionShown(false, cards)).toBe(cards);
    expect(attentionShown(false, null)).toBeNull();
  });

  it("asks for a target in the Settings tab, not for plots given to someone", () => {
    const [sentence] = forecastSentences(t, forecast(), "en", { local: true });
    expect(sentence).toContain("Settings tab");
    expect(sentence).not.toMatch(/given to/);
    expect(forecastSentences(t, forecast(), "en")[0]).toBe(t("progress.forecastNoTarget"));
  });

  it("names the target only when it was set in Settings", () => {
    expect(forecastTargetKey(forecast({ target: 300, targetFrom: "setting" }), { local: true })).toBe("progress.forecastTargetSet");
    expect(forecastTargetKey(forecast({ target: 300, targetFrom: "assigned" }), { local: true })).toBeNull();
    expect(forecastTargetKey(forecast({ target: 0 }), { local: true })).toBeNull();
    // As before in the cloud and on a progress link.
    expect(forecastTargetKey(forecast({ target: 300, targetFrom: "assigned" }))).toBe("progress.forecastTarget");
    expect(forecastTargetKey(forecast({ target: 300, targetFrom: "setting" }), { publicView: true })).toBe("publicProgress.forecastTargetSet");
  });
});

describe("local mode: Map", () => {
  const counts = (over: Partial<Record<MapStatus, number>> = {}) => ({ ...Object.fromEntries(MAP_STATUSES.map((s) => [s, 0])), ...over }) as Record<MapStatus, number>;
  const map = (): MapPlots => ({
    version: "v",
    total: 1,
    lat: new Float64Array([1]),
    lon: new Float64Array([2]),
    status: new Uint8Array([2]),
    holder: new Int32Array([0]),
    plots: ["17"],
    names: null,
    counts: counts({ submitted: 1 }),
    notOnMap: 0,
    files: [],
    people: ["ana"],
    holders: [["ana"]],
    figures: null,
    asOf: null,
    unsupportedSrs: null,
  });

  it("lists the statuses reachable alone (no decisions, no checks), and any other with plots", () => {
    expect(legendStatuses(true, counts())).toEqual(["notStarted", "started", "submitted"]);
    expect(legendStatuses(true, counts({ accepted: 2 }))).toEqual(["notStarted", "started", "submitted", "accepted"]);
    expect(legendStatuses(false, counts())).toEqual(MAP_STATUSES);
  });

  it("says who holds no plot, and Submitted without 'no decision'", () => {
    const plain = localMapPlots(map());
    expect(plain.people).toBeNull();
    expect(plotPopup(plain, 0, "p1").people).toBeNull();
    expect(plotPopup(map(), 0, "p1").people).toEqual(["ana"]);
    expect(t(statusLabelKey("submitted", true))).toBe("Submitted");
    expect(t(statusLabelKey("submitted"))).toBe("Submitted, no decision");
    expect(statusLabelKey("started", true)).toBe("map.status.started");
  });
});

describe("local mode: Data", () => {
  it("has the data download only (no Collect Earth backup, no pointer to checks)", () => {
    expect(dataSections(true)).toEqual(["download"]);
    expect(dataSections(false)).toEqual(["download", "backup", "qualityCheck"]);
    expect(t("data.explainLocal")).not.toMatch(/person/);
  });
});

describe("local mode: Quality", () => {
  it("has the pattern flags, your answers and the survey's health only", () => {
    expect(qualitySections(true)).toEqual(["flags", "answers", "health"]);
    for (const hidden of ["checks", "reference", "reviewQueue", "comparison", "notes", "assistant", "reports"] as const) {
      expect(qualitySections(true)).not.toContain(hidden);
      expect(qualitySections(false)).toContain(hidden);
    }
  });

  const flag = (over: Partial<PatternFlag>): PatternFlag => ({
    kind: "very_fast",
    plot: "17",
    operator: "ana",
    at: null,
    gapMs: 4000,
    previousPlot: "16",
    runLength: null,
    firstPlot: null,
    questions: [],
    decision: null,
    decidedAt: null,
    ...over,
  });

  it("says 'your previous plot' in the flags", () => {
    expect(flagText(t, flag({}), "en", { local: true })).toBe("Submitted 4 s after your previous plot (16).");
    expect(flagText(t, flag({ previousPlot: null }), "en", { local: true })).toBe("Submitted 4 s after your previous plot.");
    expect(flagText(t, flag({ kind: "same_as_before", runLength: 3, firstPlot: "14" }), "en", { local: true })).toBe(
      "Every answer is the same as on your previous plot (16): 3 plots in a row from plot 14.",
    );
    expect(flagText(translator("fr"), flag({}), "fr", { local: true })).toContain("votre parcelle précédente");
    // The cloud's are unchanged.
    expect(flagText(t, flag({}), "en")).toBe("Submitted 4 s after their previous plot (16).");
  });

  it("orders the survey's health without checks or decisions", () => {
    const data = { thresholds: { lowAgreement: 0.7, oftenOther: 0.2, oftenEmpty: 0.1, minPlots: 20, minChanged: 3, oftenChanged: 0.3 } } as unknown as SurveyHealthData;
    const text = orderText(t, data, "en", { local: true });
    expect(text).toContain("20 plots");
    expect(text).not.toMatch(/check|decided/);
    expect(orderText(t, data, "en")).toMatch(/checks agree/);
  });
});

describe("local mode: Activity", () => {
  const record = (change: "submitted" | "created" | "deleted"): LogItem => ({
    type: "record",
    id: "1",
    at: 0,
    receivedAt: null,
    person: "ana",
    change,
    plot: "17",
    name: "17",
    assessment: "main",
    round: "1",
  });
  const audit = (action: string, details: Record<string, string | number | boolean | null> = {}): LogItem => ({
    type: "audit",
    id: "2",
    at: 0,
    person: "ana",
    action,
    details,
    plotName: null,
  });
  const page = { people: {}, files: { f1: "plots.csv" } };

  it("says 'you' for your plots, settings and downloads", () => {
    expect(logSentence(t, record("submitted"), page, "en", { local: true })).toBe("You submitted plot 17");
    expect(logSentence(t, record("created"), page, "en", { local: true })).toBe("You started plot 17 (saved, not submitted)");
    expect(logSentence(t, audit("settings.changed", { setting: "progress" }), page, "en", { local: true })).toBe("You changed the progress (deadline, target, quiet days) settings");
    expect(logSentence(t, audit("export.downloaded", { kind: "daily" }), page, "en", { local: true })).toBe("You downloaded the daily activity");
    expect(logSentence(t, audit("export.downloaded", { records: 12 }), page, "en", { local: true })).toBe("You downloaded the data (12 records)");
    expect(logSentence(translator("fr"), record("submitted"), page, "fr", { local: true })).toBe("Vous avez envoyé la parcelle 17");
    // The cloud's name the person.
    expect(logSentence(t, record("submitted"), page, "en")).toBe("ana submitted plot 17");
  });

  it("says what Collect Earth sent", () => {
    expect(logSentence(t, audit("csv.uploaded", { csvFileId: "f1", plots: 120 }), page, "en", { local: true })).toBe("Collect Earth sent the plot file plots.csv (120 plots)");
    expect(logSentence(t, audit("cep.replaced"), page, "en", { local: true })).toBe("Collect Earth sent the project file");
  });

  it("has no log kinds about people or decisions, and the daily download only", () => {
    expect(otherLogKinds(true, COORDINATOR_LOG_KINDS)).toEqual(["files", "settings", "downloads"]);
    expect(otherLogKinds(false, COORDINATOR_LOG_KINDS)).toBe(COORDINATOR_LOG_KINDS);
    expect(activityDownloads(true)).toEqual(["daily"]);
    expect(activityDownloads(false)).toEqual(["people", "daily", "decisions", "differences"]);
  });

  it("has a weekly summary without anyone else's week", () => {
    expect(weeklyBlocks(true)).toEqual(["progress", "flags"]);
    expect(weeklyBlocks(false)).toEqual(["progress", "people", "quality"]);
  });
});

describe("local mode: Settings", () => {
  it("has the progress settings only (deadline, target, quiet days)", () => {
    expect(settingsCards(true)).toEqual(["progress"]);
    expect(settingsCards(false)).toEqual(["rename", "progress", "shareLinks", "ai", "delete"]);
    expect(t("progressSettings.targetHelpLocal")).not.toMatch(/given to/);
  });
});

describe("local mode: a plot's page", () => {
  it("has no decision, differences, holders or names", () => {
    expect(plotPageParts(true)).toEqual({ decision: false, differences: false, holders: false, names: false, openFiles: false });
    expect(Object.values(plotPageParts(false)).every(Boolean)).toBe(true);
  });
});

describe("local mode: the words", () => {
  const localKeys = (Object.keys(CATALOGUES.en) as MessageKey[]).filter((k) => /Local(\.|$)|^local\.|^answers\.yourPlots$/.test(k));

  it("has its own texts in every language", () => {
    expect(localKeys.length).toBeGreaterThan(30);
    for (const language of LANGUAGES) for (const key of localKeys) expect(CATALOGUES[language][key].trim(), `${language} ${key}`).not.toBe("");
  });

  it("speaks to you, not to a coordinator about each person or the team", () => {
    for (const key of localKeys) expect(CATALOGUES.en[key], key).not.toMatch(/each person|rest of the team|the team's|coordinator|their previous|people submit/i);
  });

  it("keeps the languages' own terms (usted, parcelle, Andamento, pesquisa)", () => {
    for (const key of localKeys) {
      expect(CATALOGUES.es[key], key).not.toMatch(/(^|[^\p{L}])(tu|tus|tú)(?![\p{L}])/u);
      expect(CATALOGUES.fr[key], key).not.toMatch(/placette|e-mail/i);
      expect(CATALOGUES.pt[key], key).not.toMatch(/Progresso|questionário/);
    }
  });
});
