const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateSceneRequest } = require("../ee/scene");

function assertBadRequest(fn, pattern) {
  assert.throws(fn, (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.code, "bad_request");
    assert.match(err.message, pattern);
    return true;
  });
}

test("validateSceneRequest rejects an unknown sensor as a 400", () => {
  assertBadRequest(() => validateSceneRequest({ sensor: "modis", timeStart: 1609459200000 }), /landsat or sentinel2/);
  assertBadRequest(() => validateSceneRequest({ timeStart: 1609459200000 }), /landsat or sentinel2/);
  assertBadRequest(() => validateSceneRequest(undefined), /landsat or sentinel2/);
});

test("validateSceneRequest rejects a non-finite timeStart as a 400", () => {
  assertBadRequest(() => validateSceneRequest({ sensor: "landsat", timeStart: "abc" }), /timeStart/);
  assertBadRequest(() => validateSceneRequest({ sensor: "landsat" }), /timeStart/);
  assertBadRequest(() => validateSceneRequest({ sensor: "landsat", timeStart: "" }), /timeStart/);
  assertBadRequest(() => validateSceneRequest({ sensor: "landsat", timeStart: Infinity }), /timeStart/);
});

test("validateSceneRequest accepts a known sensor with a numeric timeStart", () => {
  assert.deepEqual(validateSceneRequest({ sensor: "landsat", timeStart: 1609459200000 }), { sensor: "landsat", timeStart: 1609459200000 });
  assert.deepEqual(validateSceneRequest({ sensor: "sentinel2", timeStart: 1609459200000 }), { sensor: "sentinel2", timeStart: 1609459200000 });
});

test("validateSceneRequest coerces a numeric string timeStart", () => {
  assert.deepEqual(validateSceneRequest({ sensor: "landsat", timeStart: "1609459200000" }), { sensor: "landsat", timeStart: 1609459200000 });
});

test("landsatSceneCollection consults every Landsat C2 L2 collection, with no per-sensor date window", () => {
  // A CCDC observed point can be an L7 scene from 2016 or an L8 scene from 2014, outside the
  // landsatPeriods windows the series uses, so the scene lookup must span all four sensors.
  const { landsatSceneCollectionIds, landsatSceneSensors } = require("../ee/landsat");
  const { COLLECTIONS } = require("./landsatPeriods");
  assert.deepEqual(landsatSceneSensors(), ["L5", "L7", "L8", "L9"]);
  assert.deepEqual(landsatSceneCollectionIds(), [
    "LANDSAT/LT05/C02/T1_L2",
    "LANDSAT/LE07/C02/T1_L2",
    "LANDSAT/LC08/C02/T1_L2",
    "LANDSAT/LC09/C02/T1_L2",
  ]);
  assert.deepEqual(landsatSceneCollectionIds(), Object.values(COLLECTIONS), "every collection of landsatPeriods is consulted");
});
