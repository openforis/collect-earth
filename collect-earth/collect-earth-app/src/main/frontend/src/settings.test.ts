import { describe, expect, it } from "vitest";
import {
  changes, choiceLabel, defaultsOf, fieldLabel, holds, isVisible, matches, monthLabel, proposeReferenceDistance,
  restartNeeded, sectionsMatching, type Field, type Section,
} from "./settings";

const field = (key: string, extra: Partial<Field> = {}): Field =>
  ({ key, type: "text", label: "L." + key, tooltip: "T." + key, default: "", restart: false, required: false, ...extra });

const texts = {
  "L.csv": "Path to ced/csv file with plot data", "T.csv": "The CSV or CED file with the plots",
  "L.port": "Collect Earth Server port:", "T.port": "The port of Collect Earth's own server",
  "L.radius": "Radius", "OptionWizard.36": "Distance between control points", "L.engine": "Map imagery engine",
  "T.engine": "The imagery under the plots map", "SettingsPage.mapEngine.leaflet": "Leaflet (ESRI imagery)",
  "Section.plot": "Plot layout", "Section.advanced": "Advanced",
};

describe("conditions", () => {
  // The cases of ConditionTest.java
  it("in holds for one of the values", () => {
    const shape = { key: "sample_shape", in: ["SQUARE", "CIRCLE"] };
    expect(holds(shape, { sample_shape: "SQUARE" })).toBe(true);
    expect(holds(shape, { sample_shape: "HEXAGON" })).toBe(false);
    expect(holds(shape, {})).toBe(false);
  });
  it("min holds for a whole number of at least the minimum", () => {
    const points = { key: "n", min: 2 };
    expect(holds(points, { n: "4" })).toBe(true);
    expect(holds(points, { n: " 2 " })).toBe(true);
    expect(holds(points, { n: "1" })).toBe(false);
    expect(holds(points, { n: "" })).toBe(false);
    expect(holds(points, { n: "x" })).toBe(false);
    expect(holds(points, {})).toBe(false);
  });
  it("notBlank holds for a value with something in it", () => {
    expect(holds({ key: "k", notBlank: true }, { k: "abc" })).toBe(true);
    expect(holds({ key: "k", notBlank: true }, { k: " " })).toBe(false);
    expect(holds({ key: "k", notBlank: true }, {})).toBe(false);
  });
  it("all, any and not combine them, and none always holds", () => {
    const square = { key: "s", in: ["SQUARE"] };
    const many = { key: "n", min: 2 };
    expect(holds({ all: [square, many] }, { s: "SQUARE", n: "4" })).toBe(true);
    expect(holds({ all: [square, many] }, { s: "SQUARE", n: "1" })).toBe(false);
    expect(holds({ any: [square, many] }, { s: "CIRCLE", n: "4" })).toBe(true);
    expect(holds({ any: [square, many] }, { s: "CIRCLE", n: "1" })).toBe(false);
    expect(holds({ not: square }, { s: "CIRCLE" })).toBe(true);
    expect(holds({ all: [] }, {})).toBe(true);
    expect(holds({ any: [] }, {})).toBe(false);
    expect(holds(undefined, {})).toBe(true);
    expect(isVisible(field("k"), {})).toBe(true);
    expect(isVisible(field("k", { visible: square }), { s: "CIRCLE" })).toBe(false);
  });
});

describe("labels", () => {
  it("takes the first conditional label that holds, else the plain one", () => {
    const distance = field("d", { label: "OptionWizard.36", labels: [
      { when: { key: "s", in: ["CIRCLE"] }, label: "L.radius" }, { when: { key: "s", in: ["NFI"] }, label: "L.cluster" }] });
    expect(fieldLabel(distance, { s: "CIRCLE" })).toBe("L.radius");
    expect(fieldLabel(distance, { s: "NFI" })).toBe("L.cluster");
    expect(fieldLabel(distance, { s: "SQUARE" })).toBe("OptionWizard.36");
  });
  it("labels a choice from the server texts or its own text", () => {
    expect(choiceLabel({ value: "leaflet", label: "SettingsPage.mapEngine.leaflet" }, texts)).toBe("Leaflet (ESRI imagery)");
    expect(choiceLabel({ value: "2021-03", text: "2021/03" }, texts)).toBe("2021/03");
    expect(choiceLabel({ value: "x" }, texts)).toBe("x");
  });
  it("writes a Planet month as its label", () => {
    expect(monthLabel("2021-03")).toBe("2021/03");
    expect(monthLabel("2015-12_2016-05")).toBe("2015/12 - 2016/05");
  });
});

describe("changes", () => {
  const fields = [field("csv"), field("port", { restart: true }), field("db_host", { restart: true, visible: { key: "db_driver", in: ["POSTGRESQL"] } })];
  it("are the visible values that differ from the stored ones", () => {
    const stored = { csv: "a.csv", port: "8028", db_host: "", db_driver: "SQLITE" };
    expect(changes(stored, { ...stored, csv: "b.csv" }, fields)).toEqual({ csv: "b.csv" });
    expect(changes(stored, { ...stored }, fields)).toEqual({});
    // A hidden field is left out, whatever it holds
    expect(changes(stored, { ...stored, db_host: "db" }, fields)).toEqual({});
    expect(changes(stored, { ...stored, db_host: "db", db_driver: "POSTGRESQL" }, [...fields, field("db_driver")]))
      .toEqual({ db_host: "db", db_driver: "POSTGRESQL" });
  });
  it("need a restart when a restart field is among them", () => {
    expect(restartNeeded(fields, { csv: "b.csv" })).toBe(false);
    expect(restartNeeded(fields, { csv: "b.csv", port: "8029" })).toBe(true);
  });
  it("restore the defaults of the visible fields of a section", () => {
    const section: Section = { id: "s", label: "Section.plot", hint: null, fields: [field("csv", { default: "" }), field("port", { default: "8028" }),
      field("db_host", { default: "localhost", visible: { key: "db_driver", in: ["POSTGRESQL"] } })] };
    expect(defaultsOf(section, { db_driver: "SQLITE" })).toEqual({ csv: "", port: "8028" });
  });
});

describe("search", () => {
  const sections: Section[] = [
    { id: "plot", label: "Section.plot", hint: null, fields: [field("csv"), field("radius", { labels: [{ when: { key: "s", in: ["CIRCLE"] }, label: "L.radius" }] })] },
    { id: "advanced", label: "Section.advanced", hint: null, fields: [field("port"), field("engine", { type: "choice", choices: [{ value: "leaflet", label: "SettingsPage.mapEngine.leaflet" }] })] },
  ];
  it("finds a field by its label, tooltip, other labels or choices, ignoring case and accents", () => {
    expect(matches(field("csv"), texts, "PLOT DATA")).toBe(true);
    expect(matches(field("csv"), texts, "ced file")).toBe(true);
    expect(matches(field("port"), texts, "ówn sérver")).toBe(true);
    expect(matches(field("port"), texts, "plots")).toBe(false);
    expect(matches(sections[0].fields[1], texts, "radius")).toBe(true);
    expect(matches(sections[1].fields[1], texts, "esri")).toBe(true);
    expect(matches(field("csv"), texts, "  ")).toBe(true);
  });
  it("keeps only the sections with a field that matches", () => {
    expect(sectionsMatching(sections, texts, "port").map((s) => [s.id, s.fields.map((f) => f.key)])).toEqual([["advanced", ["port"]]]);
    expect(sectionsMatching(sections, texts, "")).toBe(sections);
    expect(sectionsMatching(sections, texts, "nothing like it")).toEqual([]);
  });
});

describe("reference area proposal", () => {
  const plot = { plotAreaHa: 0.16, referenceAreaHa: 1, minReferenceDistance: 21, recommendedReferenceDistance: 64 };
  it("proposes the recommended distance while none is set or it would not enclose the plot", () => {
    expect(proposeReferenceDistance({ distance_to_buffers: "" }, plot)).toBe(64);
    expect(proposeReferenceDistance({}, plot)).toBe(64);
    expect(proposeReferenceDistance({ distance_to_buffers: "20" }, plot)).toBe(64);
    expect(proposeReferenceDistance({ distance_to_buffers: "x" }, plot)).toBe(64);
    expect(proposeReferenceDistance({ distance_to_buffers: "21" }, plot)).toBeNull();
    expect(proposeReferenceDistance({ distance_to_buffers: "100" }, plot)).toBeNull();
    // Nothing to propose without a reference area
    expect(proposeReferenceDistance({ distance_to_buffers: "" }, { ...plot, minReferenceDistance: null, recommendedReferenceDistance: null })).toBeNull();
    expect(proposeReferenceDistance({ distance_to_buffers: "" }, null)).toBeNull();
  });
});
