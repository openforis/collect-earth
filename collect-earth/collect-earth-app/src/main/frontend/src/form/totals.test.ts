import { describe, expect, it } from "vitest";
import { type TableTotal, type TotalRule, columnTotal, ruleMet, totalGap } from "./model";

const total: TableTotal = {
  label: "%", hidden: true, calculated: true,
  fields: ["collect_entity_cover[trees].integer_pct", "collect_entity_cover[grass].integer_pct", "collect_entity_cover[bare].integer_pct"],
  rules: [{ op: ">=", value: 90, flag: "error" }],
};
const rule = (op: TotalRule["op"], value: number): TotalRule => ({ op, value, flag: "error" });

describe("columnTotal", () => {
  it("adds up the rows that hold a number", () => {
    const values: Record<string, string> = { "collect_entity_cover[trees].integer_pct": "40", "collect_entity_cover[grass].integer_pct": "35" };
    expect(columnTotal(total, (n) => values[n] ?? "")).toEqual({ sum: 75, any: true });
  });

  it("reads a decimal comma and leaves out what is no number yet", () => {
    const values: Record<string, string> = {
      "collect_entity_cover[trees].integer_pct": "0,1", "collect_entity_cover[grass].integer_pct": "0.2",
      "collect_entity_cover[bare].integer_pct": "12x",
    };
    expect(columnTotal(total, (n) => values[n] ?? "")).toEqual({ sum: 0.3, any: true });
  });

  it("says when no row holds anything", () => {
    expect(columnTotal(total, () => "")).toEqual({ sum: 0, any: false });
  });
});

describe("ruleMet and totalGap", () => {
  it("at least: met at the value, else what is still to add", () => {
    expect(ruleMet(rule(">=", 90), 90)).toBe(true);
    expect(totalGap(rule(">=", 90), 90)).toBeNull();
    expect(ruleMet(rule(">=", 90), 75)).toBe(false);
    expect(totalGap(rule(">=", 90), 75)).toBe(15);
  });

  it("at most and exactly: what to take away when over", () => {
    expect(totalGap(rule("<=", 100), 105)).toBe(-5);
    expect(totalGap(rule("=", 100), 105)).toBe(-5);
    expect(totalGap(rule("=", 100), 80)).toBe(20);
    expect(ruleMet(rule("=", 0.3), 0.1 + 0.2)).toBe(true);
  });

  it("more than, less than, not: met or not, with no amount", () => {
    expect(ruleMet(rule(">", 0), 0)).toBe(false);
    expect(totalGap(rule(">", 0), 0)).toBeNull();
    expect(ruleMet(rule("<", 100), 99)).toBe(true);
    expect(ruleMet(rule("!=", 0), 0)).toBe(false);
    expect(ruleMet(rule("!=", 0), 5)).toBe(true);
  });
});
