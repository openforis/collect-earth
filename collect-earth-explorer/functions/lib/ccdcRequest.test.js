const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateCcdcRequest } = require("../ee/ccdc");

test("validateCcdcRequest defaults band to NDFI", () => {
  assert.deepEqual(validateCcdcRequest({}), { band: "NDFI" });
  assert.deepEqual(validateCcdcRequest(undefined), { band: "NDFI" });
  assert.deepEqual(validateCcdcRequest({ band: undefined }), { band: "NDFI" });
});

test("validateCcdcRequest accepts NDFI and NDVI", () => {
  assert.deepEqual(validateCcdcRequest({ band: "NDFI" }), { band: "NDFI" });
  assert.deepEqual(validateCcdcRequest({ band: "NDVI" }), { band: "NDVI" });
});

test("validateCcdcRequest rejects any other band as a 400", () => {
  for (const band of ["EVI", "ndvi", "", null, 1, ["NDVI"]]) {
    assert.throws(() => validateCcdcRequest({ band }), (e) => e.status === 400 && e.code === "bad_request" && /NDFI or NDVI/.test(e.message), `band ${JSON.stringify(band)}`);
  }
});
