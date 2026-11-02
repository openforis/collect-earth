import { describe, expect, it } from "vitest";
import type { CsvColumns, Member } from "./api";
import { toDistribution, toDistributionState, toNearbyInfo } from "./api";
import {
  collectors,
  columnLabel,
  formProblem,
  giveInTurn,
  initialForm,
  nearbyNote,
  sortPeople,
  toRequest,
  withSeed,
  type DivisionForm,
} from "./division";
import { translator } from "./i18n";

const t = translator("en");

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
  nearby: { available: true, reason: null, withPlace: 120, withoutPlace: 0, srid: null },
};

const base: DivisionForm = initialForm(null, [], members);

describe("order nearby (plots close on the map together)", () => {
  const even: DivisionForm = { ...base, mode: "even", order: "nearby" };
  const otherSrs: CsvColumns = { ...columns, nearby: { available: false, reason: "other_srs", withPlace: 0, withoutPlace: 120, srid: "EPSG:32633" } };

  it("is sent as it is chosen, round-trips, and needs no seed", () => {
    expect(formProblem(even, columns)).toBeNull();
    expect(toRequest(even, columns)).toEqual({ mode: "even", people: ["u1", "u2"], order: "nearby" });
    const back = initialForm(toDistribution(JSON.parse(JSON.stringify(toRequest(even, columns)))), [], members);
    expect(back).toEqual(even);
    const request = toRequest(even, columns);
    expect(withSeed(request, { ...request, seed: 4 } as never)).toEqual(request);
  });

  it("a move after it keeps the order: the form starts on evenly, nearby", () => {
    expect(toDistribution({ mode: "manual", order: "nearby" })).toEqual({ mode: "manual", order: "nearby" });
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
    expect(nearbyNote(otherSrs.nearby, t, n)).toBe("Not available: the survey’s coordinates are in EPSG:32633, not in latitude and longitude.");
    expect(nearbyNote({ available: false, reason: "no_places", withPlace: 0, withoutPlace: 3, srid: null }, t, n)).toBe(
      "Not available: no plot of this file has a latitude and longitude (the two columns after the plot id).",
    );
    expect(nearbyNote({ available: true, reason: null, withPlace: 100, withoutPlace: 20, srid: null }, t, n)).toBe(
      "20 plots of this file have no latitude and longitude: they are shared out last, in the order of the file.",
    );
  });

  it("reads the server's answer; a server that does not say does not offer it", () => {
    expect(toNearbyInfo({ available: true, reason: null, withPlace: "9", withoutPlace: 1 }, 10)).toEqual({ available: true, reason: null, withPlace: 9, withoutPlace: 1, srid: null });
    expect(toNearbyInfo({ available: false, reason: "other_srs", withPlace: 0, withoutPlace: 10, srid: "EPSG:3857" }, 10)).toEqual({
      available: false,
      reason: "other_srs",
      withPlace: 0,
      withoutPlace: 10,
      srid: "EPSG:3857",
    });
    expect(toNearbyInfo(undefined, 10)).toEqual({ available: false, reason: "no_places", withPlace: 0, withoutPlace: 10, srid: null });
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
      { mode: "column", column: 4, groups: [{ value: "La Paz", people: ["u1"] }, { value: "Oruro", people: ["gone"] }], order: "file" },
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
    const back = initialForm(toDistribution(JSON.parse(JSON.stringify(toRequest(form, columns)))), [], members);
    expect(back).toEqual(form);
  });
});

describe("withSeed", () => {
  const mixed = { mode: "even" as const, people: ["u1"], order: "mixed" as const };
  it("sends back the seed of the preview for mixed plots", () => {
    expect(withSeed(mixed, { ...mixed, seed: 42 })).toEqual({ ...mixed, seed: 42 });
  });
  it("otherwise the request as it is", () => {
    expect(withSeed(mixed, null)).toEqual(mixed);
    expect(withSeed(mixed, { ...mixed })).toEqual(mixed);
    expect(withSeed({ ...mixed, order: "file" }, { ...mixed, seed: 42 })).toEqual({ ...mixed, order: "file" });
    expect(withSeed(mixed, { mode: "column", column: 1, groups: [], order: "mixed", seed: 1 })).toEqual(mixed);
  });
});

describe("server answers", () => {
  it("reads a distribution state, whatever is missing", () => {
    expect(toDistributionState(null)).toEqual({ distribution: null, plotCount: 0, unassigned: 0, people: [] });
    expect(
      toDistributionState({
        distribution: { mode: "even", people: ["u1"], order: "mixed", seed: 3 },
        plotCount: "120",
        unassigned: 2,
        people: [{ userId: "u1", username: "ana", plots: 40, overlap: 4 }],
      }),
    ).toEqual({
      distribution: { mode: "even", people: ["u1"], order: "mixed", seed: 3 },
      plotCount: 120,
      unassigned: 2,
      people: [{ userId: "u1", username: "ana", plots: 40, overlap: 4, sampled: 0, reference: 0, submitted: 0 }],
    });
  });
  it("unknown or whole modes are a whole file", () => {
    expect(toDistribution({ mode: "whole" })).toBeNull();
    expect(toDistribution({ mode: "map" })).toBeNull();
    expect(toDistribution({ mode: "manual", extra: 1 })).toEqual({ mode: "manual" });
  });
});
