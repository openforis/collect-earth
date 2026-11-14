import { describe, expect, it } from "vitest";
import type { SamplingRule, SamplingView } from "./api";
import { formOf, formWarnings, ruleOf, wholeNumber } from "./checksView";

/** The Checks section as the server sends it, with these divided files and this rule. */
export const samplingView = (rule: SamplingRule | null, files = [{ csvFileId: "f1", filename: "north.csv" }], extra: Partial<SamplingView> = {}): SamplingView => ({
  rule,
  active: rule !== null,
  intervalMinutes: 10,
  due: false,
  dueSince: null,
  nextAutomaticAt: null,
  lastDraw: null,
  lastCheckedAt: null,
  pending: { drawn: 0, firstN: 0, percent: 0, noChecker: 0 },
  files: files.map((f) => ({ ...f, use: "project", own: null, plots: 0, submitted: 0, sampledCopies: 0, divisionCopies: 0, referenceCopies: 0, pending: 0 })),
  wholeFiles: [],
  checkers: [],
  members: [],
  noCheckers: false,
  warning: null,
  asOf: 0,
  ...extra,
});
const view = samplingView;

describe("the Checks section's form", () => {
  it("suggests 10 and 10 % for a new rule, both off, every collector", () => {
    expect(formOf(view(null))).toEqual({
      firstNOn: false,
      firstN: "10",
      percentOn: false,
      percent: "10",
      checkersAll: true,
      checkers: [],
      files: { f1: { use: "project", firstN: "", percent: "" } },
    });
  });

  it("round-trips a saved rule, with a file of its own and one off", () => {
    const rule: SamplingRule = { checkers: ["u1"], firstN: 5, percent: null, seed: 3, files: { f1: { use: "own", checkers: ["u1"], firstN: null, percent: 20 }, f2: { use: "off" } } };
    const form = formOf(view(rule, [{ csvFileId: "f1", filename: "a" }, { csvFileId: "f2", filename: "b" }]));
    expect(form).toMatchObject({ firstNOn: true, firstN: "5", percentOn: false, checkersAll: false, checkers: ["u1"] });
    expect(ruleOf(form)).toEqual({
      rule: { checkers: ["u1"], firstN: 5, percent: null, files: { f1: { use: "own", checkers: ["u1"], firstN: null, percent: 20 }, f2: { use: "off" } } },
    });
  });

  it("says which field cannot be saved", () => {
    const form = formOf(view(null));
    expect(ruleOf({ ...form, firstNOn: true, firstN: "0" })).toEqual({ error: { field: "firstN" } });
    expect(ruleOf({ ...form, percentOn: true, percent: "12.5" })).toEqual({ error: { field: "percent" } });
    // Off fields are not read.
    expect(ruleOf({ ...form, firstN: "x" })).toEqual({ rule: { checkers: null, firstN: null, percent: null, files: {} } });
    expect(ruleOf({ ...form, files: { f1: { use: "own", firstN: "", percent: "101" } } })).toEqual({ error: { field: "percent", file: "f1" } });
  });

  it("whole numbers only, within the limits", () => {
    expect(wholeNumber(" 12 ", 1, 100)).toBe(12);
    for (const s of ["", "1e2", "-1", "1,5", "101", "0"]) expect(wholeNumber(s, 1, 100), s).toBeNull();
  });
});

describe("the Checks section's warnings, as typed", () => {
  const members = [
    { userId: "u1", username: "kofi", role: "operator" as const, disabled: false },
    { userId: "u2", username: "rita", role: "reviewer" as const, disabled: false },
    { userId: "u3", username: "ana", role: "admin" as const, disabled: false },
    { userId: "u4", username: "old", role: "operator" as const, disabled: true },
  ];
  const on = { ...formOf(view(null)), firstNOn: true };

  it("warns when nobody is ticked and a part of the rule is on", () => {
    expect(formWarnings({ ...on, checkersAll: false, checkers: [] }, members)).toEqual({ noCheckers: true, notBlind: [] });
    expect(formWarnings({ ...on, checkersAll: false, checkers: ["u4"] }, members).noCheckers).toBe(true);
    expect(formWarnings({ ...on, firstNOn: false, checkersAll: false, checkers: [] }, members).noCheckers).toBe(false);
    expect(formWarnings({ ...on, firstNOn: false, checkersAll: false, checkers: [], files: { f1: { use: "own", firstN: "", percent: "5" } } }, members).noCheckers).toBe(true);
  });

  it("every collector: no warning unless there is no active collector", () => {
    expect(formWarnings(on, members)).toEqual({ noCheckers: false, notBlind: [] });
    expect(formWarnings(on, members.filter((m) => m.userId !== "u1")).noCheckers).toBe(true);
  });

  it("names the reviewers and coordinators ticked", () => {
    expect(formWarnings({ ...on, checkersAll: false, checkers: ["u2", "u1", "u3"] }, members)).toEqual({ noCheckers: false, notBlind: ["ana", "rita"] });
  });
});
