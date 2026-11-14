import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { ListItem, UncertaintyAnswer, Estimate, UncertaintyQuestion } from "./api";
import { translator } from "./i18n";
import { matchRoute, pathFor } from "./router";
import { codeRows, codesOf, csvOf, guessCategory, uncertaintySheets, xlsxOf } from "./uncertaintyView";

const t = translator("en");

describe("the setup's guesses", () => {
  it("takes the code's first letter, else the label's words, else its first letter", () => {
    expect(guessCategory("FN", "Natural forest")).toBe("forest");
    expect(guessCategory("1", "Bosque")).toBe("forest");
    expect(guessCategory("2", "Pastizal")).toBe("grassland");
    expect(guessCategory("3", "Settlements")).toBe("settlement");
    expect(guessCategory("4", "Other")).toBe("other");
    expect(guessCategory("5", "Water body")).toBe("wetland");
    expect(guessCategory("9", "Unknown")).toBeNull();
  });

  const item = (code: string, label: string, level = 0, parent: string | null = null): ListItem => ({ code, labels: { en: label }, parent, level });
  const lists = { lu: [item("F", "Forest"), item("1", "Primary", 1, "F"), item("C", "Cropland"), item("X", "Unknown")] };
  const q = (name: string, parent: string | null = null): UncertaintyQuestion => ({ name, labels: {}, list: "lu", parent, fromPlotFile: false, calculated: false });
  const questions = [q("lu2000"), q("lu"), q("lu_sub", "lu")];

  it("lists the codes at the questions' level once per list, the saved choice kept, else guessed, else not mapped", () => {
    const rows = codeRows(questions, lists, ["lu2000", "lu"], { lu: { C: null } }, (i) => i.labels.en);
    expect(rows.map((r) => [r.code, r.choice])).toEqual([["F", "forest"], ["C", null], ["X", ""]]);
    expect(codesOf(rows)).toEqual({ lu: { F: "forest", C: null } });
    // a subdivision: its own level, guessed from the item above it
    expect(codeRows(questions, lists, ["lu_sub"], {}, (i) => i.labels.en).map((r) => [r.code, r.choice])).toEqual([["1", "forest"]]);
  });
});

const est = (plots: number, area: number, se: number): Estimate => ({ plots, proportion: area / 1000, area, se, ci: 1.96 * se, uncertainty: area > 0 ? ((1.96 * se) / area) * 100 : null });
const zero = est(0, 0, 0);
const data: UncertaintyAnswer = {
  settings: { initial: "a", final: "b", initialYear: "2000", finalYear: "2024", codes: {}, totalArea: 1000 },
  areas: "total",
  estimator: "simple",
  totalArea: 1000,
  plots: 10,
  strata: [{ key: "", area: 1000, plots: 10 }],
  notEstimable: [],
  skipped: { missing: 0, unmapped: 0, noArea: 0 },
  noData: { initial: zero, final: zero },
  unmapped: [],
  categories: ["forest", "cropland", "grassland", "wetland", "settlement", "other"].map((category, i) => ({
    category: category as "forest",
    initial: i === 0 ? est(6, 600, 163.2993) : i === 1 ? est(4, 400, 163.2993) : zero,
    final: i === 0 ? est(5, 500, 166.6667) : i === 1 ? est(5, 500, 166.6667) : zero,
  })),
  total: est(10, 1000, 0),
  forest: (["forestStable", "nonForestToForest", "forestToNonForest", "nonForestStable", "initiallyForest", "initiallyNonForest", "currentlyForest", "currentlyNonForest"] as const).map((row) => ({ row, estimate: zero })),
  transitions: [],
  matrix: {
    cells: [[500, 100, 0, 0, 0, 0], [0, 400, 0, 0, 0, 0], ...Array.from({ length: 4 }, () => [0, 0, 0, 0, 0, 0])],
    rowTotals: [600, 400, 0, 0, 0, 0],
    columnTotals: [500, 500, 0, 0, 0, 0],
    total: 1000,
    rowPercent: [[500 / 6, 100 / 6, 0, 0, 0, 0], [0, 100, 0, 0, 0, 0], ...Array.from({ length: 4 }, () => [null, null, null, null, null, null])],
  },
};

describe("the tables as sheets", () => {
  const sheets = uncertaintySheets(data, t);

  it("are the four tables, the matrix in hectares and in % of the category at the start", () => {
    expect(sheets.map((s) => s.id)).toEqual(["categories", "forest", "transitions", "matrixHa", "matrixPercent"]);
    const categories = sheets[0];
    expect(categories.header).toEqual(["Category", "Year", "Plots", "Share", "Area (ha)", "SE (ha)", "95% CI (ha)", "Uncertainty (%)"]);
    expect(categories.rows[0].slice(0, 5)).toEqual(["Forest", "2000", 6, 0.6, 600]);
    expect(categories.rows).toHaveLength(14); // 6 categories and the total, for each year
    expect(categories.rows[3]).toEqual(["Wetland", "2000", 0, 0, 0, 0, 0, null]);
    expect(sheets[1].rows.map((r) => r[0])).toContain("Forest to non-forest");
    expect(sheets[3].rows[0]).toEqual(["Forest", 500, 100, 0, 0, 0, 0, 600]);
    expect(sheets[3].rows[6]).toEqual(["Total", 500, 500, 0, 0, 0, 0, 1000]);
    expect(sheets[4].rows[0][7]).toBe(100);
    expect(sheets[4].rows[2][7]).toBeNull();
  });

  it("have a No data line in a year when plots of a code left out keep their area", () => {
    const withNoData = uncertaintySheets({ ...data, noData: { initial: est(1, 100, 30), final: zero } }, t)[0];
    expect(withNoData.rows).toHaveLength(15);
    expect(withNoData.rows[6].slice(0, 5)).toEqual(["No data", "2000", 1, 0.1, 100]);
    expect(withNoData.rows[7][0]).toBe("Total");
  });

  it("download as an .xlsx with the numbers as numbers", () => {
    const files = unzipSync(xlsxOf(sheets));
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/workbook.xml", ...sheets.map((_, i) => `xl/worksheets/sheet${i + 1}.xml`)].sort());
    const workbook = strFromU8(files["xl/workbook.xml"]);
    expect(workbook).toContain('<sheet name="Area of each IPCC category" sheetId="1" r:id="rId1"/>');
    const first = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(first).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Forest</t></is></c>');
    expect(first).toContain('<c r="C2"><v>6</v></c><c r="D2"><v>0.6</v></c><c r="E2"><v>600</v></c><c r="F2"><v>163.2993</v></c>');
    // no uncertainty for an area of 0: an empty cell, not #DIV/0!
    expect(first).toMatch(/<row r="5">.*<c r="G5"><v>0<\/v><\/c><\/row>/);
    const matrix = strFromU8(files["xl/worksheets/sheet4.xml"]);
    expect(matrix).toContain('<c r="H8"><v>1000</v></c>');
    expect(matrix).toContain("Total</t>");
    // the names Excel takes: at most 31 characters, none of []:*?/\
    for (const m of workbook.matchAll(/name="([^"]*)"/g)) expect(m[1]).toMatch(/^[^[\]:*?/\\]{1,31}$/);
  });

  it("download as one CSV in the person's language", () => {
    const csv = csvOf(sheets, "es");
    expect(csv.split("\r\n").slice(0, 3)).toEqual(["Area of each IPCC category", "Category;Year;Plots;Share;Area (ha);SE (ha);95% CI (ha);Uncertainty (%)", "Forest;2000;6;0,6;600;163,2993;320,066628;53,344438"]);
  });
});

describe("the page's address", () => {
  it("is under the analysis page", () => {
    expect(pathFor({ name: "uncertainty", projectId: "p 1" })).toBe("/projects/p%201/analysis/uncertainty");
    expect(matchRoute("/projects/p%201/analysis/uncertainty")).toEqual({ name: "uncertainty", projectId: "p 1" });
  });
});
