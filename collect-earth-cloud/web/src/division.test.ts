import { describe, expect, it } from "vitest";
import type { CsvColumns, DivisionBody, Member, StoredDistribution } from "./api";
import {
  collectors,
  columnLabel,
  formProblem,
  giveInTurn,
  initialForm,
  movedText,
  nearbyNote,
  sortPeople,
  toRequest,
  withSeed,
  type DivisionForm,
} from "./division";
import { translator } from "./i18n";

const t = translator("en");

/** What the server stores of a division request (src/division.ts parseDivisionRequest): the order and the copies' percent filled in. */
function stored(request: DivisionBody): StoredDistribution | null {
  const { dryRun: _dryRun, ...body } = JSON.parse(JSON.stringify(request)) as DivisionBody;
  if (body.mode === "whole") return null;
  return { ...body, order: body.order ?? "file", overlapPercent: body.overlapPercent ?? 0 };
}

const members: Member[] = [
  { userId: "u0", username: "zoe", role: "admin" },
  { userId: "u2", username: "jose", role: "operator" },
  { userId: "u1", username: "ana", role: "reviewer" },
];

const columns: CsvColumns = {
  plotCount: 120,
  hasHeader: true,
  separator: ",",
  columns: [
    { index: 0, name: "id", distinctCount: 120, values: null },
    {
      index: 4,
      name: "province",
      distinctCount: 3,
      values: [
        { value: "", count: 30 },
        { value: "La Paz", count: 50 },
        { value: "Oruro", count: 40 },
      ],
    },
  ],
  nearby: { available: true, reason: null, withPlace: 120, withoutPlace: 0 },
};

const base: DivisionForm = initialForm(null, [], members);

describe("order nearby (plots close on the map together)", () => {
  const even: DivisionForm = { ...base, mode: "even", order: "nearby" };
  const otherSrs: CsvColumns = { ...columns, nearby: { available: false, reason: "other_srs", withPlace: 0, withoutPlace: 120, srid: "EPSG:32633" } };

  it("is sent as it is chosen, round-trips, and needs no seed", () => {
    expect(formProblem(even, columns)).toBeNull();
    expect(toRequest(even, columns)).toEqual({ mode: "even", people: ["u1", "u2"], order: "nearby" });
    const back = initialForm(stored(toRequest(even, columns)), [], members);
    expect(back).toEqual(even);
    const request = toRequest(even, columns);
    expect(withSeed(request, { ...stored(request)!, seed: 4 } as StoredDistribution)).toEqual(request);
  });

  it("a move after it keeps the order: the form starts on evenly, nearby", () => {
    expect(initialForm({ mode: "manual", order: "nearby" }, ["u2"], members)).toMatchObject({ mode: "even", order: "nearby", people: ["u2"] });
  });

  it("cannot be sent when the file's places do not allow it", () => {
    expect(formProblem(even, otherSrs)).toBe("divide.problemNearby");
    expect(formProblem({ ...even, order: "file" }, otherSrs)).toBeNull();
    expect(formProblem({ ...even, mode: "whole" }, otherSrs)).toBeNull();
  });

  it("says why it is not available, or how many plots go last", () => {
    const n = (value: number) => String(value);
    expect(nearbyNote(columns.nearby, t, n)).toBeNull();
    expect(nearbyNote(otherSrs.nearby, t, n)).toBe("Not available: the survey's coordinates are in EPSG:32633, not in latitude and longitude.");
    expect(nearbyNote({ available: false, reason: "no_places", withPlace: 0, withoutPlace: 3 }, t, n)).toBe(
      "Not available: no plot of this file has a latitude and longitude (the two columns after the plot id).",
    );
    expect(nearbyNote({ available: true, reason: null, withPlace: 100, withoutPlace: 20 }, t, n)).toBe(
      "20 plots of this file have no latitude and longitude: they are shared out last, in the order of the file.",
    );
    expect(nearbyNote({ available: true, reason: null, withPlace: 100, withoutPlace: 1 }, t, n)).toBe(
      "1 plot of this file has no latitude and longitude: it is shared out last, in the order of the file.",
    );
  });
});

describe("people", () => {
  it("collectors and reviewers first, then by name", () => {
    expect(sortPeople(members).map((m) => m.username)).toEqual(["ana", "jose", "zoe"]);
    expect(collectors(members).map((m) => m.username)).toEqual(["ana", "jose"]);
  });
  it("only coordinators: everyone", () => {
    expect(collectors([members[0]]).map((m) => m.userId)).toEqual(["u0"]);
  });
  it("a coordinator can take plots: offered with everyone (last), and alone in the project ticked and sent", () => {
    expect(sortPeople(members).map((m) => m.userId)).toContain("u0");
    const alone: DivisionForm = { ...initialForm(null, [], [members[0]]), mode: "even" };
    expect(alone.people).toEqual(["u0"]);
    expect(formProblem(alone, columns)).toBeNull();
    expect(toRequest(alone, columns)).toMatchObject({ mode: "even", people: ["u0"] });
  });
});

describe("initialForm", () => {
  it("a whole file starts on whole, with the collectors ticked for evenly", () => {
    expect(base).toMatchObject({ mode: "whole", people: ["u1", "u2"], order: "file", overlap: false, overlapPercent: "10" });
  });

  it("ticks the people who hold the file now, if any", () => {
    expect(initialForm(null, ["u0", "gone"], members).people).toEqual(["u0"]);
  });

  it("an even division, dropping people no longer in the project", () => {
    const form = initialForm({ mode: "even", people: ["u2", "gone"], order: "mixed", overlapPercent: 20, seed: 7 }, [], members);
    expect(form).toMatchObject({ mode: "even", people: ["u2"], order: "mixed", overlap: true, overlapPercent: "20" });
  });

  it("a division by column", () => {
    const form = initialForm(
      { mode: "column", column: 4, groups: [{ value: "La Paz", people: ["u1"] }, { value: "Oruro", people: ["gone"] }], order: "file", overlapPercent: 0 },
      [],
      members,
    );
    expect(form).toMatchObject({ mode: "column", column: 4, groups: { "La Paz": ["u1"] }, overlap: false, overlapPercent: "10" });
  });

  it("plots moved by hand start from evenly between the people holding them", () => {
    expect(initialForm({ mode: "manual" }, ["u2"], members)).toMatchObject({ mode: "even", people: ["u2"] });
  });
});

describe("columnLabel", () => {
  it("header name plus up to three examples, skipping empty values", () => {
    expect(columnLabel(columns.columns[1], t)).toBe("province (e.g. La Paz, Oruro)");
    const many = { index: 2, name: "x", distinctCount: 5, values: ["a", "b", "c", "d"].map((value) => ({ value, count: 1 })) };
    expect(columnLabel(many, t)).toBe("x (e.g. a, b, c)");
  });
  it("without a header: the column number, counting from 1", () => {
    expect(columnLabel({ ...columns.columns[1], name: null }, t)).toBe("Column 5 (e.g. La Paz, Oruro)");
    expect(columnLabel({ index: 0, name: "  ", distinctCount: 120, values: null }, t)).toBe("Column 1");
  });
});

describe("giveInTurn", () => {
  it("one person per value, in turn", () => {
    expect(giveInTurn(["a", "b", "c"], ["u1", "u2"])).toEqual({ a: ["u1"], b: ["u2"], c: ["u1"] });
  });
  it("nobody to give to: nothing", () => {
    expect(giveInTurn(["a"], [])).toEqual({});
  });
});

describe("formProblem and toRequest", () => {
  it("whole file", () => {
    expect(formProblem(base, columns)).toBeNull();
    expect(toRequest({ ...base, overlap: true }, columns)).toEqual({ mode: "whole" });
  });

  it("evenly", () => {
    const form: DivisionForm = { ...base, mode: "even", order: "mixed" };
    expect(formProblem({ ...form, people: [] }, columns)).toBe("divide.problemNoPeople");
    expect(formProblem(form, columns)).toBeNull();
    expect(toRequest(form, columns)).toEqual({ mode: "even", people: ["u1", "u2"], order: "mixed" });
  });

  it("by a column: only usable columns, only values someone collects, in the column's order", () => {
    const form: DivisionForm = { ...base, mode: "column" };
    expect(formProblem(form, columns)).toBe("divide.problemNoColumn");
    expect(formProblem({ ...form, column: 0 }, columns)).toBe("divide.problemNoColumn");
    expect(formProblem({ ...form, column: 4 }, columns)).toBe("divide.problemNoGroups");
    const filled = { ...form, column: 4, groups: { Oruro: ["u2"], "": ["u1", "u2"], "La Paz": [], gone: ["u1"] } };
    expect(formProblem(filled, columns)).toBeNull();
    expect(toRequest(filled, columns)).toEqual({
      mode: "column",
      column: 4,
      groups: [
        { value: "", people: ["u1", "u2"] },
        { value: "Oruro", people: ["u2"] },
      ],
      order: "file",
    });
  });

  it("quality check: a whole number from 5 to 50, and two people", () => {
    const form: DivisionForm = { ...base, mode: "even", overlap: true };
    for (const bad of ["", "4", "51", "10.5", "abc"]) {
      expect(formProblem({ ...form, overlapPercent: bad }, columns), bad).toBe("divide.problemPercent");
    }
    expect(formProblem({ ...form, people: ["u1"] }, columns)).toBe("divide.problemOverlapOnePerson");
    expect(formProblem({ ...form, overlapPercent: " 50 " }, columns)).toBeNull();
    expect(toRequest({ ...form, overlapPercent: "5" }, columns)).toEqual({ mode: "even", people: ["u1", "u2"], order: "file", overlapPercent: 5 });
    const oneEach = { ...form, mode: "column" as const, column: 4, groups: { Oruro: ["u1"], "La Paz": ["u2"] } };
    expect(formProblem(oneEach, columns)).toBeNull();
    expect(formProblem({ ...oneEach, groups: { Oruro: ["u1"], "La Paz": ["u1"] } }, columns)).toBe("divide.problemOverlapOnePerson");
  });

  it("round-trips through what the server stores", () => {
    const form: DivisionForm = { ...base, mode: "column", column: 4, groups: { Oruro: ["u2"] }, order: "mixed", overlap: true, overlapPercent: "15" };
    const back = initialForm(stored(toRequest(form, columns)), [], members);
    expect(back).toEqual(form);
  });
});

describe("withSeed", () => {
  const mixed = { mode: "even" as const, people: ["u1"], order: "mixed" as const };
  const previewed = { ...mixed, overlapPercent: 0 };
  it("sends back the seed of the preview for mixed plots", () => {
    expect(withSeed(mixed, { ...previewed, seed: 42 })).toEqual({ ...mixed, seed: 42 });
  });
  it("otherwise the request as it is", () => {
    expect(withSeed(mixed, null)).toEqual(mixed);
    expect(withSeed(mixed, previewed)).toEqual(mixed);
    expect(withSeed({ ...mixed, order: "file" }, { ...previewed, seed: 42 })).toEqual({ ...mixed, order: "file" });
    expect(withSeed(mixed, { mode: "column", column: 1, groups: [], order: "mixed", overlapPercent: 0, seed: 1 })).toEqual(mixed);
  });
});

describe("what moving the unfinished plots did", () => {
  it("says the plots kept back and the copies dropped, only when there are some", () => {
    const plain = movedText(t, { moved: 4, notMoved: 0, droppedChecks: 0 }, "ana", "maria", "en");
    expect(plain).toMatch(/^Plots moved to maria: 4\./);
    expect(plain).not.toContain("Kept with");
    const all = movedText(t, { moved: 4, notMoved: 1, droppedChecks: 2 }, "ana", "maria", "en");
    expect(all).toContain("Kept with ana: 1 (plots that maria already assessed or checked");
    expect(all).toContain("Copies to compare dropped: 2");
    for (const lang of ["es", "fr", "pt", "tr"]) expect(movedText(translator(lang), { moved: 1, notMoved: 1, droppedChecks: 1 }, "ana", "maria", lang), lang).not.toMatch(/divide\.|\{/);
    expect(t("divide.moveText", { from: "ana", to: "maria" })).not.toContain("every plot");
  });
});

describe("evenly by percent", () => {
  const even: DivisionForm = { ...base, mode: "even", people: ["u1", "u2"], byPercent: true, percents: { u1: "70", u2: "30", u0: "99" } };

  it("sends one percent per person ticked, and round-trips", () => {
    expect(formProblem(even, columns)).toBeNull();
    expect(toRequest(even, columns)).toEqual({ mode: "even", people: ["u1", "u2"], percents: [70, 30], order: "file" });
    const back = initialForm(stored(toRequest(even, columns)), [], members);
    expect(back).toMatchObject({ mode: "even", byPercent: true, percents: { u1: "70", u2: "30" } });
    // Not by percent: no percents sent.
    expect(toRequest({ ...even, byPercent: false }, columns)).not.toHaveProperty("percents");
  });

  it("needs whole numbers adding up to more than 0 and at most 100", () => {
    // Under 100: the rest of the plots is given to nobody until the file is divided again
    expect(formProblem({ ...even, percents: { u1: "10", u2: "0" } }, columns)).toBeNull();
    expect(toRequest({ ...even, percents: { u1: "10", u2: "0" } }, columns)).toMatchObject({ percents: [10, 0] });
    expect(formProblem({ ...even, percents: { u1: "70", u2: "40" } }, columns)).toBe("divide.problemPercents");
    expect(formProblem({ ...even, percents: { u1: "0", u2: "0" } }, columns)).toBe("divide.problemPercents");
    expect(formProblem({ ...even, percents: { u1: "70.5", u2: "29.5" } }, columns)).toBe("divide.problemPercents");
    expect(formProblem({ ...even, percents: { u1: "100" } }, columns)).toBe("divide.problemPercents");
    expect(t("divide.percentsTotal", { total: "90" })).toContain("90");
    expect(t("divide.percentsRest", { rest: "90" })).toContain("90");
  });
});
