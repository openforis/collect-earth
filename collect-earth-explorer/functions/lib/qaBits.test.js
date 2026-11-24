const { test } = require("node:test");
const assert = require("node:assert/strict");
const { landsatClearMaskBits } = require("./qaBits");

test("landsatClearMaskBits covers C2 QA_PIXEL dilated cloud, cloud, cloud shadow and snow", () => {
  const bits = landsatClearMaskBits();
  assert.equal(bits, 58);
  assert.equal(bits, (1 << 1) | (1 << 3) | (1 << 4) | (1 << 5));
  // bit 0 (fill), bit 2 (cirrus), bit 6 (clear) and bit 7 (water) are not masked
  for (const bit of [0, 2, 6, 7]) assert.equal(bits & (1 << bit), 0, `bit ${bit} must not be masked`);
});

const { hlsClearMaskBits } = require("./qaBits");

test("hlsClearMaskBits covers HLS v2 Fmask cloud, adjacent to cloud/shadow, cloud shadow and snow/ice", () => {
  const bits = hlsClearMaskBits();
  assert.equal(bits, 30);
  // bit 0 (cirrus, unused), bit 5 (water) and bits 6-7 (aerosol level) are not masked
  for (const bit of [0, 5, 6, 7]) assert.equal(bits & (1 << bit), 0, `bit ${bit} must not be masked`);
});
