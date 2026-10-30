import { describe, expect, it } from "vitest";
import type { RoundInfo } from "./api";
import { CATALOGUES, LANGUAGES } from "./i18n";
import { originalFileName, REFUSAL_CODES, refusalMessageKey, roundCodeLabel, roundMessage } from "./roundText";

const info = (over: Partial<RoundInfo>): RoundInfo => ({
  state: "none",
  refusal: null,
  keyCount: 1,
  roundIndex: null,
  roundCodes: [],
  reassessmentCode: null,
  ...over,
});

describe("why the server did not add round", () => {
  it("has one sentence per refusal code of the server", () => {
    // The server's RefusalCode (src/cep.ts): its read errors and the reasons addRound gives.
    expect([...REFUSAL_CODES].sort()).toEqual(
      [
        "not_a_zip",
        "too_large",
        "no_survey",
        "survey_unreadable",
        "several_entities",
        "several_keys",
        "round_not_key",
        "balloon_missing",
        "balloon_marker_missing",
        "balloon_ids_missing",
        "template_missing",
        "template_marker_missing",
      ].sort(),
    );
    const keys = REFUSAL_CODES.map(refusalMessageKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("file.round.refusal.unknown");
    for (const language of LANGUAGES) for (const key of keys) expect(CATALOGUES[language][key]).toBeTruthy();
  });

  it("a code it does not know gets a general sentence", () => {
    expect(refusalMessageKey("something_new")).toBe("file.round.refusal.unknown");
    expect(refusalMessageKey("toString")).toBe("file.round.refusal.unknown");
    expect(refusalMessageKey(null)).toBe("file.round.refusal.unknown");
  });
});

describe("what the page says", () => {
  it("added: the hidden round, with the uploaded file to download", () => {
    expect(roundMessage(info({ state: "added", keyCount: 2, roundIndex: 1, reassessmentCode: "2" }))).toEqual({
      severity: "success",
      keys: ["file.round.added"],
      download: true,
      choose: false,
    });
  });

  it("own: asks which code marks a re-assessment", () => {
    expect(roundMessage(info({ state: "own", roundCodes: [{ code: "2020", label: "" }] }))).toEqual({
      severity: "success",
      keys: ["file.round.own"],
      download: false,
      choose: true,
    });
  });

  it("none with a refusal: why, then what the coordinator can do", () => {
    expect(roundMessage(info({ refusal: "several_keys", keyCount: 2 })).keys).toEqual([
      "file.round.refusal.severalKeys",
      "file.round.carryOn",
    ]);
  });

  it("none because the file itself looks wrong: check the file", () => {
    for (const refusal of ["not_a_zip", "too_large", "no_survey", "survey_unreadable"]) {
      expect(roundMessage(info({ refusal, keyCount: 0 }))).toMatchObject({
        severity: "warning",
        keys: [refusalMessageKey(refusal), "file.round.checkFile"],
      });
    }
    expect(roundMessage(info({ refusal: "balloon_missing" })).severity).toBe("info");
  });

  it("none without a refusal: uploaded once data was collected", () => {
    expect(roundMessage(info({})).keys).toEqual(["file.round.noneLate"]);
  });
});

describe("helpers", () => {
  it("shows a code with its label", () => {
    expect(roundCodeLabel({ code: "2", label: "Re-assessment" })).toBe("2 – Re-assessment");
    expect(roundCodeLabel({ code: "2020", label: "" })).toBe("2020");
    expect(roundCodeLabel({ code: "2020", label: "2020" })).toBe("2020");
  });

  it("names the downloaded file after the project", () => {
    expect(originalFileName("Bolivia 2026")).toBe("Bolivia 2026.cep");
    expect(originalFileName('a/b:c*"d"')).toBe("a b c d.cep");
    expect(originalFileName("  ")).toBe("project.cep");
  });
});
