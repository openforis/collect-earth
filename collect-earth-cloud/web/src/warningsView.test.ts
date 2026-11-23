import { describe, expect, it } from "vitest";
import type { AttentionItem, JudgedPerson, ReferenceAnswer, ReferenceFiguresAnswer, Verdict } from "./api";
import { translator } from "./i18n";
import { earlyWarning, marginText, rangeText, tallyText } from "./warningsView";

const t = translator("en");

const judged = (compared: number, agreeing: number, verdict: Verdict | null) => ({ compared, agreeing, low: compared ? 0.1 : null, high: compared ? 0.9 : null, verdict });
const rate = (compared: number, agreeing: number) => ({ compared, agreeing, rate: null });

function person(username: string, verdict: Verdict | null, landUse: [number, number, Verdict | null], canopy: [number, number, Verdict | null] = [0, 0, null], trend: JudgedPerson["trend"] = null): JudgedPerson {
  const questions = [
    { key: "land_use", label: "Land use", ...rate(landUse[0], landUse[1]), ...judged(...landUse) },
    ...(canopy[0] > 0 ? [{ key: "canopy", label: "Canopy", ...rate(canopy[0], canopy[1]), ...judged(...canopy) }] : []),
  ];
  const compared = landUse[0] + canopy[0];
  const agreeing = landUse[1] + canopy[1];
  return { username, plots: rate(landUse[0], landUse[1]), answers: judged(compared, agreeing, verdict), recent: { compared, agreeing }, earlier: null, questions, verdict, trend };
}

function figures(over: Partial<ReferenceFiguresAnswer> = {}): ReferenceFiguresAnswer {
  return { plots: 10, assessed: 10, checks: 30, target: 80, questions: [], among: [], doubtfulTotal: 0, doubtful: [], byPlot: [], people: [], computedAt: 1, stale: false, ...over };
}

function coordinator(f: ReferenceFiguresAnswer, people: { username: string; copies: number; checked: number }[] = []): ReferenceAnswer {
  return {
    coordinator: true,
    figures: f,
    max: 500,
    count: f.plots,
    plots: [],
    files: [],
    wholeFiles: [],
    assessors: [],
    collectors: people.length,
    people: people.map((p) => ({ userId: `u-${p.username}`, ...p })),
    external: { count: 0, uploadedAt: null },
    asOf: null,
  };
}

const question = (key: string, label: string, kind: "choice" | "number", compared: number, agreeing: number, verdict: Verdict | null) => ({ key, label, kind, ...rate(compared, agreeing), ...judged(compared, agreeing, verdict) });

describe("earlyWarning: the layers and where to start", () => {
  it("says nothing is in use without reference plots, and still shows what Progress says of the data coming in", () => {
    const attention: AttentionItem[] = [
      { kind: "neverDownloaded", count: 2, people: [{ username: "ana" }, { username: "ben" }] },
      { kind: "differencesWaiting", count: 4 },
      { kind: "worthALook", count: 7 },
    ];
    const w = earlyWarning(coordinator(figures({ plots: 0, assessed: 0, checks: 0 })), attention);
    expect(w.inUse).toBe(false);
    expect(w.arriving?.map((i) => i.kind)).toEqual(["neverDownloaded"]);
    expect(w.levels).toEqual({ arriving: "look", reference: "none", questions: "none", people: "none", plots: "look" });
    expect(w.plots?.worthALook).toBe(7);
    expect(w.first).toBe("arriving");
  });

  it("a reviewer gets the questions and the number in doubt: no people, no plots, no Progress cards", () => {
    const answer: ReferenceAnswer = {
      coordinator: false,
      count: 10,
      max: 500,
      figures: { plots: 10, assessed: 10, checks: 30, target: 80, questions: [question("land_use", "Land use", "choice", 30, 12, "below")], among: [], doubtfulTotal: 2, computedAt: 1, stale: false },
    };
    const w = earlyWarning(answer, null);
    expect(w.arriving).toBeNull();
    expect(w.people).toBeNull();
    expect(w.plots).toBeNull();
    expect(w.reference).toMatchObject({ doubtful: [], doubtfulTotal: 2 });
    expect(w.levels).toEqual({ arriving: "none", reference: "problem", questions: "problem", people: "none", plots: "none" });
    // The reference comes before the questions: it explains them.
    expect(w.first).toBe("reference");
  });

  it("the reference: in doubt is a problem; checks waiting for the assessor is something to look at; nothing assessed is early", () => {
    const doubt = { plot: "7", assessor: "elena", key: "land_use", label: "Land use", reference: "Forest", majority: "Grassland", count: 4, of: 5 };
    expect(earlyWarning(coordinator(figures({ doubtful: [doubt], doubtfulTotal: 1 })), []).levels.reference).toBe("problem");
    const waiting = earlyWarning(coordinator(figures({ assessed: 8, byPlot: [{ plot: "1", assessor: "elena", assessed: false, checks: 3, agreeing: 0 }, { plot: "2", assessor: "elena", assessed: false, checks: 0, agreeing: 0 }] })), []);
    expect(waiting.reference).toMatchObject({ unassessed: 2, waiting: 1 });
    expect(waiting.levels.reference).toBe("look");
    // Not assessed, and nobody has checked those plots yet: nothing waits on the assessor.
    expect(earlyWarning(coordinator(figures({ assessed: 8, byPlot: [{ plot: "2", assessor: "elena", assessed: false, checks: 0, agreeing: 0 }] })), []).levels.reference).toBe("ok");
    expect(earlyWarning(coordinator(figures({ assessed: 0, checks: 0 })), []).levels.reference).toBe("early");
  });

  it("the people: the most worrying first, with their weak questions, what they have done, and who has not begun", () => {
    const f = figures({
      people: [
        person("ana", "ok", [8, 8, "ok"]),
        person("ben", "below", [10, 2, "below"], [10, 9, "ok"], "worse"),
        person("cleo", "watch", [6, 4, "watch"]),
        person("dan", "early", [2, 2, "early"]),
      ],
    });
    const w = earlyWarning(
      coordinator(f, [
        { username: "ana", copies: 10, checked: 8 },
        { username: "ben", copies: 10, checked: 10 },
        { username: "cleo", copies: 10, checked: 6 },
        { username: "dan", copies: 10, checked: 2 },
        { username: "eva", copies: 10, checked: 0 },
        { username: "fay", copies: 0, checked: 0 },
      ]),
      [],
    );
    expect(w.people!.rows.map((r) => r.username)).toEqual(["ben", "cleo", "dan", "ana"]);
    expect(w.people!.rows[0]).toMatchObject({ userId: "u-ben", trend: "worse", done: { checked: 10, copies: 10 }, weak: [{ key: "land_use", compared: 10, agreeing: 2, verdict: "below" }] });
    expect(w.people!.counts).toEqual({ below: 1, watch: 1, ok: 1, early: 1 });
    // eva holds copies and has submitted none; fay holds none (nothing to begin).
    expect(w.people!.notStarted).toEqual(["eva"]);
    expect(w.levels.people).toBe("problem");
    expect(w.so).toMatchObject({ collectors: 4, judged: 3 });
    expect(w.first).toBe("people");
  });

  it("the people are something to look at when all are on target but someone has not begun", () => {
    const w = earlyWarning(coordinator(figures({ people: [person("ana", "ok", [8, 8, "ok"])] }), [{ username: "ana", copies: 10, checked: 8 }, { username: "eva", copies: 10, checked: 0 }]), []);
    expect(w.levels.people).toBe("look");
  });

  it("the plots: those fewer than half of at least three collectors get right, the worst first, marked when their reference is in doubt", () => {
    const row = (plot: string, checks: number, agreeing: number, assessed = true) => ({ plot, assessor: "elena", assessed, checks, agreeing });
    const f = figures({
      byPlot: [row("1", 4, 4), row("2", 4, 1), row("3", 5, 0), row("4", 2, 0), row("5", 4, 2), row("6", 6, 0, false)],
      doubtful: [{ plot: "3", assessor: "elena", key: "land_use", label: "Land use", reference: "Forest", majority: "Grassland", count: 5, of: 5 }],
      doubtfulTotal: 1,
    });
    const w = earlyWarning(coordinator(f), []);
    // 4: two collectors only. 5: half get it right. 6: no reference yet.
    expect(w.plots!.rows).toEqual([
      { plot: "3", assessor: "elena", checks: 5, agreeing: 0, doubt: true },
      { plot: "2", assessor: "elena", checks: 4, agreeing: 1, doubt: false },
    ]);
    expect(w.levels.plots).toBe("look");
    expect(earlyWarning(coordinator(figures({ byPlot: [row("1", 4, 4)] })), []).levels.plots).toBe("ok");
    expect(earlyWarning(coordinator(figures({ byPlot: [row("1", 2, 0)] })), []).levels.plots).toBe("early");
  });
});

describe("earlyWarning: where a question's wrong answers come from", () => {
  const among = (compared: number, agreeing: number) => [{ key: "land_use", label: "Land use", plots: 10, compared, agreeing, kappa: 0.5 }];

  it("a few people's: the people layer, not the question", () => {
    const f = figures({
      questions: [question("land_use", "Land use", "choice", 40, 28, "watch")],
      among: among(60, 30),
      // 12 wrong answers, 10 of them ben's
      people: [person("ana", "ok", [10, 9, "ok"]), person("ben", "below", [10, 0, "below"]), person("cleo", "ok", [10, 9, "ok"]), person("dan", "ok", [10, 10, "ok"])],
    });
    expect(earlyWarning(coordinator(f), []).questions[0]).toMatchObject({ reading: "few", who: ["ben"] });
  });

  it("shared: the collectors agree with each other, not with the reference", () => {
    const people = ["ana", "ben", "cleo", "dan"].map((n) => person(n, "below", [10, 4, "below"]));
    const f = figures({ questions: [question("land_use", "Land use", "choice", 40, 16, "below")], among: among(60, 54), people });
    expect(earlyWarning(coordinator(f), []).questions[0]).toMatchObject({ reading: "shared", who: [] });
  });

  it("unclear: they disagree with each other too", () => {
    const people = ["ana", "ben", "cleo", "dan"].map((n) => person(n, "below", [10, 4, "below"]));
    const f = figures({ questions: [question("land_use", "Land use", "choice", 40, 16, "below")], among: among(60, 24), people });
    expect(earlyWarning(coordinator(f), []).questions[0].reading).toBe("unclear");
  });

  it("a number question says its margin; a question on target says nothing; the most worrying question comes first", () => {
    const f = figures({
      questions: [question("land_use", "Land use", "choice", 40, 38, "ok"), question("canopy", "Canopy", "number", 40, 10, "below")],
      among: among(60, 58),
    });
    const w = earlyWarning(coordinator(f), []);
    expect(w.questions.map((q) => [q.key, q.reading])).toEqual([
      ["canopy", "number"],
      ["land_use", null],
    ]);
    expect(w.questions[1].among).toMatchObject({ compared: 60, agreeing: 58 });
    expect(w.levels.questions).toBe("problem");
  });
});

describe("the words of a share", () => {
  it("says the count, the margin and the target", () => {
    expect(tallyText(t, { compared: 8, agreeing: 3 })).toBe("3 of 8");
    expect(marginText(t, { compared: 8, agreeing: 3, low: 0.137, high: 0.694 }, 80, "en")).toBe("38% (3 of 8). With this many, the true share is likely between 14% and 69%. Target: 80%.");
    expect(marginText(t, { compared: 0, agreeing: 0, low: null, high: null }, 80, "en")).toBe("Nothing compared yet.");
    expect(rangeText({ low: 0.137, high: 0.694 }, "en")).toBe("14–69%");
    expect(rangeText({ low: 0.996, high: 1 }, "en")).toBe("100%");
    expect(rangeText({ low: null, high: null }, "en")).toBe("");
  });
});
