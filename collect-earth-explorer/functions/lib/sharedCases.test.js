const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkFormula } = require("./formula");
const { catalogue, paramOf } = require("./catalogue");
const cases = require("../test/validationCases.json");

// The web app runs the same cases (web/src/lib/sharedCases.test.ts) against its mirrors in config.ts.
test("shared formula cases", () => {
  for (const { bands, accepted, refused } of cases.formulas) {
    for (const f of accepted) assert.equal(checkFormula(f, catalogue.bands[bands]), f, JSON.stringify(f));
    for (const f of refused) assert.throws(() => checkFormula(f, catalogue.bands[bands]), { status: 400 }, JSON.stringify(f));
  }
});

test("shared parameter cases", () => {
  for (const { kind, type, name, maxYear, accepted, refused } of cases.params) {
    for (const v of accepted) assert.deepEqual(paramOf(kind, type, name, v, { maxYear }), v, `${name} ${JSON.stringify(v)}`);
    for (const v of refused) assert.throws(() => paramOf(kind, type, name, v, { maxYear }), { status: 400 }, `${name} ${JSON.stringify(v)}`);
  }
});
