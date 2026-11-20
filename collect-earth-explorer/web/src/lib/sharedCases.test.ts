import { describe, expect, it } from "vitest";
import catalogueJson from "../../../functions/catalogue.json";
import cases from "../../../functions/test/validationCases.json";
import { check, formulaOk, type Spec } from "./config";

// The server runs the same cases (functions/lib/sharedCases.test.js) against lib/formula.js and lib/catalogue.js.
const catalogue = catalogueJson as unknown as Record<string, Record<string, { params: Record<string, Spec> }>> & { bands: Record<string, string[]> };
const THIS_YEAR = new Date().getUTCFullYear();

describe("the cases shared with the server", () => {
  it("formulaOk agrees with checkFormula", () => {
    for (const { bands, accepted, refused } of cases.formulas) {
      for (const f of accepted) expect(formulaOk(f, catalogue.bands[bands]), JSON.stringify(f)).toBe(true);
      for (const f of refused) expect(formulaOk(f, catalogue.bands[bands]), JSON.stringify(f)).toBe(false);
    }
  });

  it("check agrees with paramOf", () => {
    for (const c of cases.params as { kind: string; type: string; name: string; maxYear?: number; accepted: unknown[]; refused: unknown[] }[]) {
      const spec = catalogue[c.kind][c.type].params[c.name];
      for (const v of c.accepted) expect(check(spec, v, c.maxYear ?? THIS_YEAR), `${c.name} ${JSON.stringify(v)}`).toBe(true);
      for (const v of c.refused) expect(check(spec, v, c.maxYear ?? THIS_YEAR), `${c.name} ${JSON.stringify(v)}`).toBe(false);
    }
  });
});
