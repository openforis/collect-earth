const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkFormula, normaliseFormula, MAX_LENGTH } = require("./formula");
const { catalogue } = require("./catalogue");

const BANDS = ["blue", "green", "red", "nir", "swir1", "swir2"];

function assert400(fn, re) {
  assert.throws(fn, (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.code, "bad_request");
    assert.match(err.message, re);
    return true;
  });
}

test("accepts numbers, bands, the four operators, parentheses, commas and the allowed functions", () => {
  for (const ok of [
    "(nir - red) / (nir + red)",
    "2.5 * (nir - red) / (nir + 2.4 * red + 1)",
    "nir * .5 + 0.25 + 3.",
    "-nir + red * -2",
    "sqrt(nir) + abs(red - nir) + min(nir, red) + max(nir, 0.1) + pow(nir, 2)",
    "sqrt (nir)",
    "  nir  ",
  ]) assert.equal(checkFormula(ok, BANDS), ok);
});

test("rejects unknown names, other characters and calls of anything but the allowed functions, naming the token", () => {
  for (const [bad, re] of [
    ["nir + ndvi", /ndvi/],
    ["rededge1 - red", /rededge1/],
    ["nir; red", /;/],
    ["'nir'", /'/],
    ['"nir"', /"/],
    ["nir[0]", /\[/],
    ["b('nir')", /\bb\b/],
    ["nir(red)", /\(/],
    ["exp(nir)", /exp/],
    ["nir ** 2", /\*/],
    ["nir % 2", /%/],
    ["nir > red ? 1 : 0", />/],
    ["sqrt nir", /sqrt/],
    ["nir.red", /\./],
    ["1e5 * nir", /e5/],
  ]) assert400(() => checkFormula(bad, BANDS), re);
});

test("rejects unbalanced or empty parentheses, operators in a row, adjacent operands and a dangling end", () => {
  for (const [bad, re] of [
    ["(nir - red", /parenthes/],
    ["nir - red)", /\)/],
    ["()", /\)/],
    ["sqrt()", /\)/],
    ["nir + * red", /\*/],
    ["nir +", /end/],
    ["* nir", /\*/],
    ["red 2", /2/],
    ["nir red", /red/],
    ["(nir)(red)", /\(/],
    ["min(nir,)", /\)/],
    ["nir, red", /,/],
  ]) assert400(() => checkFormula(bad, BANDS), re);
});

test("rejects an empty formula, one without a band, a non-string and one over the length limit", () => {
  assert400(() => checkFormula("", BANDS), /empty/);
  assert400(() => checkFormula("   ", BANDS), /empty/);
  assert400(() => checkFormula("1 + 2", BANDS), /band/);
  assert400(() => checkFormula(5, BANDS), /formula/);
  const long = "nir" + " + nir".repeat(40);
  assert.ok(long.length > MAX_LENGTH);
  assert400(() => checkFormula(long, BANDS), /200/);
});

test("normaliseFormula removes all whitespace", () => {
  assert.equal(normaliseFormula(" (nir -\tred) /\n(nir + red) "), "(nir-red)/(nir+red)");
});

test("every named index in the catalogue passes the check with both sensors' bands", () => {
  for (const type of ["landsat-series", "sentinel2-series"]) {
    for (const [name, formula] of Object.entries(catalogue.indices)) {
      assert.doesNotThrow(() => checkFormula(formula, catalogue.bands[type]), `${type} ${name}`);
    }
  }
});
