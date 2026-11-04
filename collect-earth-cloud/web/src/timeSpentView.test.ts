import { describe, expect, it } from "vitest";
import { translator } from "./i18n";
import { bandLabels, bandShortLabels, quickBands, secondsText } from "./timeSpentView";

const t = translator("en");

describe("time spent", () => {
  it("says a time in seconds, minutes or hours", () => {
    expect(secondsText(t, 45)).toBe("45 s");
    expect(secondsText(t, 200)).toBe("3 min 20 s");
    expect(secondsText(t, 3600)).toBe("1 h");
    expect(secondsText(t, 7500)).toBe("2 h 5 min");
  });
  it("names the bands, the last one open", () => {
    expect(bandLabels(t, [30, 60, 1200])).toEqual(["under 30 s", "30 s to 1 min", "1 min to 20 min", "20 min or more"]);
    expect(bandShortLabels(t, [30, 60, 1200])).toEqual(["<30 s", "30 s", "1 min", "20 min+"]);
  });
  it("marks the bands under the quick limit", () => {
    expect(quickBands([30, 60, 120], 60)).toEqual([true, true, false, false]);
    expect(quickBands([30, 60, 120], 45)).toEqual([true, false, false, false]);
    expect(quickBands([30, 60], null)).toEqual([false, false, false]);
  });
});
