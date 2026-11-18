const { test } = require("node:test");
const assert = require("node:assert/strict");
const { SCENE_PROPS } = require("../ee/landsat");
const { landsatPointProps } = require("../ee/landsatSeries");
const { sentinel2PointProps } = require("../ee/sentinel2Series");

/** A stand-in for an ee.Image: get(name) returns the property. */
const fakeImage = (props) => ({ get: (name) => props[name] });

test("Landsat points carry SPACECRAFT_ID as sensor and CLOUD_COVER as cloud", () => {
  assert.deepEqual(landsatPointProps(fakeImage({ SPACECRAFT_ID: "LANDSAT_8", CLOUD_COVER: 12.5 })), { sensor: "LANDSAT_8", cloud: 12.5 });
});

test("Sentinel-2 points carry CLOUDY_PIXEL_PERCENTAGE as cloud", () => {
  assert.deepEqual(sentinel2PointProps(fakeImage({ CLOUDY_PIXEL_PERCENTAGE: 3.2 })), { cloud: 3.2 });
});

test("the cloud properties survive prepared() and indexImage()", () => {
  assert.ok(SCENE_PROPS.includes("CLOUD_COVER"));
  assert.ok(SCENE_PROPS.includes("CLOUDY_PIXEL_PERCENTAGE"));
});
