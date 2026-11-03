// The final review's web fixes (Task 22): server answers the web now reads, the texts that follow
// the project's settings, the map's list, the page titles and the plurals.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorMessageKey, getServerOverview, NO_SUCH_PLOT, setQualityDecision, toPersonData, toSamplingView, toWeeklyData } from "./api";
import { logSentence } from "./activityView";
import { notBlindText } from "./checksView";
import { reasonText } from "./healthView";
import { translator } from "./i18n";
import { plotList } from "./mapView";
import { mayMoveFocus, pageHeading, pageTitle } from "./pageFocus";
import { veryFastText } from "./peopleView";
import { personDetail } from "./progressView";
import { setToken } from "./storage";

const t = translator("en");
const es = translator("es");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { origin: "https://ce.example.org" } });
  setToken(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("server answers the web now reads", () => {
  it("a decision on a plot that is not there says so plainly", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: "not_found", reason: "no plot file of this project has this plot" }));
    const error = await setQualityDecision("p1", "99", "first", "").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: NO_SUCH_PLOT });
    expect(t(errorMessageKey(error))).toBe("This plot cannot be found in this project, so it cannot be decided. Load the page again to see the plots as they are now.");
  });

  it("sampling: the checkers whose checks may not be blind", () => {
    expect(toSamplingView({ warning: { code: "checkers_not_blind", usernames: ["rev", "boss"] } }).notBlindCheckers).toEqual(["rev", "boss"]);
    expect(toSamplingView({ warning: null }).notBlindCheckers).toEqual([]);
    expect(toSamplingView({ warning: { code: "other", usernames: ["x"] } }).notBlindCheckers).toEqual([]);
    expect(notBlindText(t, ["rev", "boss"])).toMatch(/^The checks of these people may not be blind: rev, boss\. /);
    expect(notBlindText(t, ["rev"])).toMatch(/^The checks of rev may not be blind\. /);
    expect(t("checks.checkersAll")).toBe("Every collector");
  });

  it("the weekly summary's reference measurements, the person's threshold, the owner's late draws", async () => {
    expect(toWeeklyData({ progress: { checks: 2, referenceMeasurements: 3 } }).progress).toMatchObject({ checks: 2, referenceMeasurements: 3 });
    expect(toWeeklyData({}).progress.referenceMeasurements).toBe(0);
    expect(toPersonData({ speed: { veryFast: 2, veryFastSeconds: 20 } }).speed).toMatchObject({ veryFast: 2, veryFastSeconds: 20 });
    // An older server: the default threshold.
    expect(toPersonData({ speed: { veryFast: 2 } }).speed.veryFastSeconds).toBe(15);
    fetchMock.mockResolvedValue(jsonResponse(200, { security: { lateDraws: 2, lastLateDrawAt: 1_700_000_000_000 } }));
    expect((await getServerOverview()).security).toMatchObject({ lateDraws: 2, lastLateDrawAt: 1_700_000_000_000 });
    fetchMock.mockResolvedValue(jsonResponse(200, { security: {} }));
    expect((await getServerOverview()).security).toMatchObject({ lateDraws: 0, lastLateDrawAt: null });
  });
});

describe("texts that follow what the project and the code do", () => {
  it("very fast submissions name the project's threshold, not 15 s", () => {
    expect(veryFastText(t, { veryFast: 3, veryFastSeconds: 20 }, "en")).toBe("3 submissions came less than 20 s after the one before. That is often a plot answered without looking at it.");
    expect(veryFastText(t, { veryFast: 1, veryFastSeconds: 90 }, "en")).toMatch(/^1 submission came less than 1 min 30 s after/);
    expect(veryFastText(es, { veryFast: 2, veryFastSeconds: 15 }, "es")).toMatch(/^2 envíos llegaron menos de 15 s después/);
  });

  it("one, not '1 plots': the singular keys", () => {
    const page = { people: {}, files: {} };
    const audit = (action: string, details: Record<string, unknown>) =>
      ({ type: "audit", id: "a1", at: 0, person: "ana", action, details, plotName: null }) as unknown as Parameters<typeof logSentence>[1];
    expect(logSentence(t, audit("plots.moved", { moved: 1, csvFileId: "f", fromUserId: "a", toUserId: "b" }), page as never, "en")).toMatch(/^ana moved 1 plot of /);
    expect(logSentence(t, audit("plots.moved", { moved: 2, csvFileId: "f", fromUserId: "a", toUserId: "b" }), page as never, "en")).toMatch(/^ana moved 2 plots of /);
    expect(logSentence(t, audit("decision.bulk", { count: 1, decision: "first" }), page as never, "en")).toMatch(/^ana decided 1 plot with a bulk decision: /);
    const late = (days: number) =>
      personDetail(t, { kind: "oldUnsentWork" } as never, { username: "ana", lastSyncAt: null, lastPlotsDownloadAt: null, medianDelayMs: days * 86_400_000 } as never, "en", String);
    expect(late(1)).toBe("about 1 day late");
    expect(late(2.5)).toBe("about 2.5 days late");
    const row = { agreement: { compared: 1, agreeing: 0, rate: 0 } } as never;
    expect(reasonText(t, "low_agreement", row, { thresholds: { lowAgreement: 0.7 } } as never, "en")).toMatch(/ of 1 plot \(under /);
  });
});

describe("the map's list of plots", () => {
  const map = {
    total: 3,
    plots: ["1", "2", "3"],
    names: null,
    status: new Uint8Array([0, 1, 0]),
    holder: new Int32Array([0, -1, 0]),
    holders: [["ana"]],
  } as never;

  it("lists the plots shown, the first `limit`, each with its page", () => {
    const all = plotList(map, new Set(["notStarted", "started"] as never), "p1", 2);
    expect(all.total).toBeGreaterThanOrEqual(2);
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0]).toMatchObject({ plot: "1", label: "1", people: ["ana"], path: "/projects/p1/quality/plot/1" });
    expect(plotList(map, new Set(), "p1", 100)).toEqual({ rows: [], total: 0 });
  });
});

describe("page titles and focus", () => {
  it("the title names the page, each part once", () => {
    expect(pageTitle(["Plot 17", "Quality", "North survey", "Our server"])).toBe("Plot 17 – Quality – North survey – Our server");
    expect(pageTitle([" North  survey ", null, "", "North survey", "Our server"])).toBe("North survey – Our server");
    expect(pageTitle([])).toBe("");
  });

  it("a page's own heading wins over the project's h1", () => {
    const own = { id: "own" };
    const h1 = { id: "h1" };
    const root = (marked: unknown) => ({ querySelector: (q: string) => (q === "[data-page-heading]" ? marked : h1) }) as unknown as ParentNode;
    expect(pageHeading(root(own))).toBe(own);
    expect(pageHeading(root(null))).toBe(h1);
    expect(pageHeading(root(null), true)).toBeNull();
  });

  it("the focus stays on a tab that was chosen", () => {
    expect(mayMoveFocus(null)).toBe(true);
    expect(mayMoveFocus({ closest: () => ({}) } as unknown as Element)).toBe(false);
    expect(mayMoveFocus({ closest: () => null } as unknown as Element)).toBe(true);
  });
});
