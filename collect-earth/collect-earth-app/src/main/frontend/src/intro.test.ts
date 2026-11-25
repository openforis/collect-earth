import { describe, expect, it } from "vitest";
import { CATALOGUES } from "./i18n";
import {
  DASHBOARD_AFTER_SAVED, FORM_MAP, KEYS_AFTER_PLOTS, LIST_MAP, TIPS, TIP_GAP_MILLIS, badgeAt, cardFor, legendBand, offset, spot, tipFor, union,
  withSeen, withTips, type IntroContext, type IntroInfo,
} from "./intro";

const fresh: IntroInfo = { seen: [], tips: true, earlierUser: false };
const ctx = (over: Partial<IntroContext> = {}): IntroContext => ({
  intro: fresh, ready: true, pane: "list", plots: 50, saved: 0, cloud: false, toCorrect: 0, training: false, opened: 0, ...over,
});
const seen = (...ids: string[]): IntroInfo => ({ ...fresh, seen: ids });

describe("cardFor: the card due", () => {
  it("shows a new user the map of the list, then of the first form opened, each once", () => {
    expect(cardFor(ctx())).toBe("map.list");
    expect(cardFor(ctx({ intro: seen("map.list") }))).toBeNull();
    expect(cardFor(ctx({ intro: seen("map.list"), pane: "form" }))).toBe("map.form");
    expect(cardFor(ctx({ intro: seen("map.list", "map.form"), pane: "form" }))).toBeNull();
  });

  it("shows someone who knew Collect Earth 1 what changed first", () => {
    const earlier = { ...fresh, earlierUser: true };
    expect(cardFor(ctx({ intro: earlier }))).toBe("changes");
    expect(cardFor(ctx({ intro: earlier, pane: "form" }))).toBe("changes");
    expect(cardFor(ctx({ intro: { ...earlier, seen: ["changes"] } }))).toBe("map.list");
    // never to a new user
    expect(cardFor(ctx({ intro: fresh }))).not.toBe("changes");
  });

  it("shows nothing until the page is the user's, without plots to point at, or without the server's answer", () => {
    expect(cardFor(ctx({ ready: false }))).toBeNull();
    expect(cardFor(ctx({ plots: 0 }))).toBeNull();
    expect(cardFor(ctx({ intro: null }))).toBeNull();
    expect(cardFor(ctx({ intro: undefined, pane: "form" }))).toBeNull();
  });
});

describe("tipFor: one tip, when its control matters", () => {
  const done = seen("map.list", "map.form");
  const now = 1_000_000;

  it("waits for the maps, and for the tips to be on", () => {
    expect(tipFor(ctx({ cloud: true }), now, null)).toBeNull();
    expect(tipFor(ctx({ intro: done, cloud: true }), now, null)?.id).toBe("tip.cloud");
    expect(tipFor(ctx({ intro: { ...done, tips: false }, cloud: true }), now, null)).toBeNull();
    expect(tipFor(ctx({ intro: done, cloud: true, ready: false }), now, null)).toBeNull();
  });

  it("offers them in order, each once, and not in a row", () => {
    const busy = ctx({ intro: done, cloud: true, toCorrect: 2, saved: 12 });
    expect(tipFor(busy, now, null)?.id).toBe("tip.corrections");
    const afterOne = { ...busy, intro: withSeen(done, ["tip.corrections"]) };
    expect(tipFor(afterOne, now, now - TIP_GAP_MILLIS + 1)).toBeNull();
    expect(tipFor(afterOne, now, now - TIP_GAP_MILLIS)?.id).toBe("tip.cloud");
    const afterTwo = { ...busy, intro: withSeen(done, ["tip.corrections", "tip.cloud"]) };
    expect(tipFor(afterTwo, now, null)?.id).toBe("tip.filter");
  });

  it("keeps a tip for the pane its control is in", () => {
    const form = ctx({ intro: done, pane: "form", opened: KEYS_AFTER_PLOTS, saved: 5 });
    expect(tipFor(form, now, null)?.id).toBe("tip.keys");
    expect(tipFor({ ...form, opened: KEYS_AFTER_PLOTS - 1 }, now, null)).toBeNull();
    // the filter is the list's: not over a form
    expect(tipFor(ctx({ intro: done, pane: "list", saved: 5 }), now, null)?.id).toBe("tip.filter");
    // nothing left to do: no filter to suggest
    expect(tipFor(ctx({ intro: done, pane: "list", saved: 50, plots: 50 }), now, null)?.id).toBe("tip.dashboard");
    expect(tipFor(ctx({ intro: withSeen(done, ["tip.filter"]), saved: DASHBOARD_AFTER_SAVED - 1 }), now, null)).toBeNull();
    expect(tipFor(ctx({ intro: withSeen(done, ["tip.filter"]), saved: DASHBOARD_AFTER_SAVED }), now, null)?.id).toBe("tip.dashboard");
  });

  it("says a list is a training's, and nothing once everything was shown", () => {
    expect(tipFor(ctx({ intro: done, training: true }), now, null)?.id).toBe("tip.training");
    const all = withSeen(done, TIPS.map((t) => t.id));
    expect(tipFor(ctx({ intro: all, cloud: true, toCorrect: 3, training: true, saved: 40, opened: 9 }), now, null)).toBeNull();
  });
});

describe("what was shown", () => {
  it("is added once", () => {
    expect(withSeen(seen("a"), ["a", "b"]).seen).toEqual(["a", "b"]);
    const same = seen("a");
    expect(withSeen(same, ["a"])).toBe(same);
  });

  it("the tips switched on again start over; switched off they keep what was shown", () => {
    const some = { ...fresh, tips: false, seen: ["map.list", "tip.cloud", "tip.keys"] };
    expect(withTips(some, true)).toEqual({ ...fresh, tips: true, seen: ["map.list"] });
    expect(withTips({ ...some, tips: true }, false).seen).toEqual(some.seen);
    expect(withTips({ ...some, tips: true }, true).seen).toEqual(some.seen);
  });
});

describe("the map of the screen", () => {
  const viewport = { width: 400, height: 800 };

  it("has a text in every language for each control, and for each tip", () => {
    for (const key of [...LIST_MAP, ...FORM_MAP, ...TIPS].map((x) => x.text)) {
      for (const language of Object.keys(CATALOGUES)) expect(CATALOGUES[language][key], `${language} ${key}`).toBeTruthy();
    }
    expect(new Set(LIST_MAP.map((x) => x.id)).size).toBe(LIST_MAP.length);
    expect(new Set(FORM_MAP.map((x) => x.id)).size).toBe(FORM_MAP.length);
  });

  it("boxes several elements as one control, and moves a box of the form's frame into the page", () => {
    expect(union([])).toBeNull();
    expect(union([{ left: 10, top: 20, width: 30, height: 10 }, { left: 100, top: 25, width: 20, height: 20 }])).toEqual({ left: 10, top: 20, width: 110, height: 25 });
    expect(offset({ left: 5, top: 6, width: 7, height: 8 }, { left: 100, top: 200 })).toEqual({ left: 105, top: 206, width: 7, height: 8 });
  });

  it("draws the box a little larger, never beyond the page", () => {
    expect(spot({ left: 50, top: 60, width: 100, height: 30 }, viewport)).toEqual({ left: 46, top: 56, width: 108, height: 38 });
    expect(spot({ left: 0, top: 0, width: 400, height: 30 }, viewport)).toEqual({ left: 2, top: 2, width: 396, height: 32 });
  });

  it("puts each number on its control's corner, inside the page", () => {
    expect(badgeAt({ left: 100, top: 100, width: 40, height: 40 }, viewport)).toEqual({ left: 89, top: 89 });
    expect(badgeAt({ left: 2, top: 2, width: 40, height: 40 }, viewport)).toEqual({ left: 2, top: 2 });
    expect(badgeAt({ left: 395, top: 795, width: 3, height: 3 }, viewport)).toEqual({ left: 376, top: 776 });
  });

  it("puts the legend in the tallest band no control is in", () => {
    // the list: its controls at the top, the legend under them
    const list = [{ left: 0, top: 0, width: 400, height: 48 }, { left: 16, top: 120, width: 368, height: 90 }, { left: 16, top: 230, width: 368, height: 40 }];
    expect(legendBand(list, viewport)).toEqual({ top: 282, height: 506 });
    // a form: controls at the top and at the bottom, the legend between them
    const form = [{ left: 0, top: 0, width: 400, height: 150 }, { left: 200, top: 740, width: 180, height: 50 }];
    expect(legendBand(form, viewport)).toEqual({ top: 162, height: 566 });
    // boxes that overlap do not make a band between them
    const overlap = [{ left: 0, top: 0, width: 400, height: 300 }, { left: 0, top: 100, width: 400, height: 100 }];
    expect(legendBand(overlap, viewport)).toEqual({ top: 312, height: 476 });
    expect(legendBand([], viewport)).toEqual({ top: 12, height: 776 });
  });
});
