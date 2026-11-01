import { describe, expect, it } from "vitest";
import { divideReady, initialIpccState, ipccAnswers, ipccComplete, ipccMissing, kmlCsvName, missingResultOf, type IpccForm } from "./tools";

const form: IpccForm = {
  countries: [{ code: "ES", name: "Spain" }, { code: "KE", name: "Kenya" }],
  attributes: ["id", "province"],
  defaultAttribute: "province",
  categories: [
    { code: "F", label: "Forest", managementTypes: [{ value: "MANAGED", label: "Managed" }, { value: "UNMANAGED", label: "Unmanaged" }],
      extra: { name: "forestType", label: "Forest type", options: [{ value: "PINUS", label: "Pinus" }, { value: "LARCH", label: "Larch" }] },
      subdivisions: [{ guid: "f1", code: "F1", name: "Dense", managementType: null, type: null }, { guid: "f2", code: "F2", name: "Open", managementType: "MANAGED", type: "LARCH" }] },
    { code: "W", label: "Wetland", managementTypes: [{ value: "MANAGED", label: "Managed" }], extra: null,
      subdivisions: [{ guid: "w1", code: "W1", name: "Marsh", managementType: "MANAGED", type: null }] },
    { code: "O", label: "Other land", managementTypes: [{ value: "MANAGED", label: "Managed" }], extra: null, subdivisions: [] },
  ],
};

describe("the LULUCF form", () => {
  it("starts as the wizard did: first country, the preselected attribute, the values of the data", () => {
    const state = initialIpccState(form);
    expect(state.country).toBe("ES");
    expect(state.regionAttribute).toBe("province");
    expect(state.answers.f1).toEqual({ managementType: "", type: "PINUS" });
    expect(state.answers.f2).toEqual({ managementType: "MANAGED", type: "LARCH" });
    expect(state.answers.w1).toEqual({ managementType: "MANAGED", type: "" });
    expect(initialIpccState({ ...form, countries: [], defaultAttribute: null, attributes: [] }).regionAttribute).toBe("");
  });

  it("is complete once every subdivision has a management type and the rest is chosen", () => {
    const state = initialIpccState(form);
    expect(ipccMissing(form, state)).toEqual(["F / F1"]);
    expect(ipccComplete(form, state)).toBe(false);
    const answered = { ...state, answers: { ...state.answers, f1: { managementType: "UNMANAGED", type: "PINUS" } } };
    expect(ipccMissing(form, answered)).toEqual([]);
    expect(ipccComplete(form, answered)).toBe(false);
    expect(ipccComplete(form, { ...answered, path: " /tmp/ghgi.zip " })).toBe(true);
    expect(ipccComplete(form, { ...answered, path: "x", country: "" })).toBe(false);
  });

  it("sends the answers as the server takes them", () => {
    const state = { ...initialIpccState(form), path: " /tmp/ghgi.zip ", answers: { f1: { managementType: "MANAGED", type: "" }, f2: { managementType: "MANAGED", type: "LARCH" }, w1: { managementType: "MANAGED", type: "x" } } };
    expect(ipccAnswers(form, state)).toEqual({
      country: "ES", regionAttribute: "province", path: "/tmp/ghgi.zip",
      subdivisions: [
        { guid: "f1", managementType: "MANAGED", type: null },
        { guid: "f2", managementType: "MANAGED", type: "LARCH" },
        // A category without an extra type sends none, whatever the state holds
        { guid: "w1", managementType: "MANAGED", type: null },
      ],
    });
  });
});

describe("the utilities", () => {
  it("divides only with a file that passed the check, a folder and a count in range", () => {
    const request = { source: "/tmp/a.csv", folder: "/tmp/out", files: 3, randomize: false, column: null };
    expect(divideReady(request, false)).toBe(true);
    expect(divideReady(request, true)).toBe(false);
    expect(divideReady({ ...request, folder: " " }, false)).toBe(false);
    expect(divideReady({ ...request, files: 0 }, false)).toBe(false);
    expect(divideReady({ ...request, files: 501 }, false)).toBe(false);
    expect(divideReady({ ...request, files: 2.5 }, false)).toBe(false);
  });

  it("reads the missing plots result", () => {
    expect(missingResultOf({ text: "t", totalPlots: 3, totalMissing: 1, files: [], csv: null })?.totalMissing).toBe(1);
    expect(missingResultOf({ path: "x" })).toBeNull();
    expect(missingResultOf(null)).toBeNull();
  });

  it("names the plots file after the KML", () => {
    expect(kmlCsvName("C:\\data\\points.kml")).toBe("importedFromKml_points.kml.csv");
    expect(kmlCsvName("/home/me/survey.kml")).toBe("importedFromKml_survey.kml.csv");
  });
});
