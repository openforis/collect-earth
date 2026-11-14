import { describe, expect, it } from "vitest";
import { answersToCopy, type Field, type FormModel } from "./model";
import { PERIOD_STATUS_FIELD, answerText, earlierToCopy, toPlotPeriods, withoutPeriodStatus } from "./period";

const LAND = "collect_code_land_use";
const options = { [LAND]: [{ code: "F", label: "Forest" }, { code: "C", label: "Cropland" }] };

describe("a repeat survey's plot header", () => {
  it("reads the plot's latest earlier period and its main characteristics, named", () => {
    const period = toPlotPeriods({
      periods: [
        { label: "2015", savedAt: 1, answers: { [LAND]: "C" } },
        { label: "2020", savedAt: 2, answers: { [LAND]: "F", collect_integer_canopy: "60", collect_text_note: "" } },
      ],
      labels: { [LAND]: "Land use" },
      options,
      label: "2025",
      header: [LAND, "collect_text_note", "collect_code_gone"],
    });
    expect(period).toEqual({
      label: "2025",
      earlier: { label: "2020", answers: { [LAND]: "F", collect_integer_canopy: "60", collect_text_note: "" } },
      // the questions answered then only
      header: [{ key: LAND, label: "Land use", answer: "Forest" }],
    });
  });

  it("has none for a plot without an earlier period, or an answer it cannot read", () => {
    expect(toPlotPeriods({ periods: [] })).toBeNull();
    expect(toPlotPeriods(null)).toBeNull();
    expect(toPlotPeriods({ periods: [{ label: 2020 }] })).toBeNull();
  });

  it("names answers: several, a qualifier, a code it does not know", () => {
    expect(answerText(LAND, "F===C", options)).toBe("Forest, Cropland");
    expect(answerText(LAND, "F::pine", options)).toBe("Forest (pine)");
    expect(answerText(LAND, "X", options)).toBe("X");
  });

  it("takes the period status out of the questions, as the header asks it", () => {
    const status = { kind: "field" as const, name: PERIOD_STATUS_FIELD, type: "code" as const, label: "Since the earlier period" };
    const land = { kind: "field" as const, name: LAND, type: "code" as const, label: "Land use", code: { layout: "buttons" as const, items: [] } };
    const model: FormModel = {
      survey: "s", language: "en", keys: ["collect_text_id"], csvFields: [], unsupported: [],
      tabs: [{ id: "t1", label: "Plot", items: [status, land, { kind: "group", label: "More", fields: [status] }] }],
    };
    const { model: without, had } = withoutPeriodStatus(model);
    expect(had).toBe(true);
    expect(without.tabs[0].items).toEqual([land]);
    expect(withoutPeriodStatus(without)).toEqual({ model: without, had: false });

    // "Still the same": the earlier choices into the questions left empty, never a key nor a text
    const earlier = { [LAND]: "F::old note", collect_text_id: "17" };
    expect(earlierToCopy(without, {}, earlier, () => "")).toEqual([[LAND, "F"]]);
    expect(earlierToCopy(without, {}, earlier, (n) => (n === LAND ? "C" : ""))).toEqual([]);
  });

  it("\"Still the same\" copies the numbers too: the same plot's, its land unchanged; never a calculated one, a text or a date", () => {
    const f = (name: string, type: Field["type"], extra: Partial<Field> = {}): Field => ({ kind: "field", name, type, label: name, ...extra } as Field);
    const fields = [
      f("collect_integer_canopy", "integer"),
      f("collect_real_height", "real"),
      f("collect_integer_trees", "integer"),
      f("collect_integer_total", "integer", { calculated: true }),
      f("collect_text_note", "text"),
      f("collect_date_seen", "date"),
      f("collect_real_bad", "real"),
      f("collect_integer_id", "integer"),
    ];
    const model: FormModel = {
      survey: "s", language: "en", keys: ["collect_integer_id"], csvFields: [], unsupported: [],
      tabs: [{ id: "t1", label: "Plot", items: fields }],
    };
    const earlier = {
      collect_integer_canopy: " 60 ", collect_real_height: "12.5", collect_integer_trees: "7", collect_integer_total: "67",
      collect_text_note: "pines", collect_date_seen: "2020-06-01", collect_real_bad: "n/a", collect_integer_id: "17",
    };
    // the trees counted again now are kept
    const value = (n: string) => (n === "collect_integer_trees" ? "9" : "");
    expect(earlierToCopy(model, {}, earlier, value)).toEqual([["collect_integer_canopy", "60"], ["collect_real_height", "12.5"]]);
    // "Same as previous plot" (another plot) never copies a number
    expect(answersToCopy(fields, model.keys, earlier, value)).toEqual([]);
  });
});
