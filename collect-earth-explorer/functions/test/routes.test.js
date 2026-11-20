const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../app");
const { monthsBefore, mayBeEmpty } = require("../ee/sentinel2Composite");
const { registerRoutes, TTL } = require("../routes");
const { createRateLimit } = require("../lib/rateLimit");
const { belize } = require("./fixtures");

/**
 * Fake result cache recording every withCache call. With `canned` set it behaves as a hit
 * (returns canned + cached: true without running compute); otherwise it runs compute.
 */
function fakeCache(canned) {
  const calls = [];
  return {
    calls,
    async withCache(endpoint, parsed, extras, ttlSeconds, compute) {
      calls.push({ endpoint, parsed, extras, ttlSeconds });
      if (canned) return { ...canned, cached: true };
      return compute();
    },
  };
}

/** Express app with the real routes and the given fake cache (never the Firestore one). */
function appWith(cache = fakeCache(), rateLimit) {
  return createApp((app) => registerRoutes(app, { cache, rateLimit }));
}

/** Runs fn with console.error silenced; returns what was logged. */
async function quietly(fn) {
  const origError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await fn();
  } finally {
    console.error = origError;
  }
  return logged;
}

/** POSTs `body` to `path` with EE_KEY unset; returns the response, what was logged to console.error, and the cache. */
async function postWithoutKey(path, body, cache = fakeCache()) {
  const saved = process.env.EE_KEY;
  delete process.env.EE_KEY;
  let res;
  try {
    const logged = await quietly(async () => {
      res = await request(appWith(cache)).post(path).send(body);
    });
    return { res, logged, cache };
  } finally {
    if (saved !== undefined) process.env.EE_KEY = saved;
  }
}

/** Asserts a response is the JSON 500 reached when EE auth runs without a key. */
function assertEeKeyMissing500(res, logged) {
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, "internal");
  assert.equal(res.body.error.message, "Internal error");
  assert.equal(res.body.error.retryable, false);
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0] && logged[0][0].message), /EE_KEY secret is not set/);
}

/** Asserts a 400 bad_request whose message matches `re`, and that the cache was never consulted. */
function assert400(res, re, cache) {
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
  assert.match(res.body.error.message, re);
  assert.deepEqual(cache.calls, [], "a 400 must never reach the cache");
}

test("monthsBefore subtracts whole months", () => {
  assert.equal(monthsBefore("2025-06-01", 12), "2024-06-01");
  assert.equal(monthsBefore("2025-01-15", 1), "2024-12-15");
});

test("monthsBefore pins Date.setUTCMonth rollover for short target months", () => {
  // 31 Mar minus one month is "31 Feb", which JavaScript rolls forward to 2 Mar
  // in a leap year (29 Feb + 2). Pinned here so a change is deliberate, not accidental.
  const result = monthsBefore("2024-03-31", 1);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result, "2024-03-02");
});

test("mayBeEmpty: only a composite with an explicit window or a cloud limit pays for the empty check", () => {
  assert.equal(mayBeEmpty({}), false, "the standard request costs what it did");
  assert.equal(mayBeEmpty({ bands: "true-colour" }), false);
  assert.equal(mayBeEmpty({ start: "2022-01-01", end: "2022-01-08" }), true);
  assert.equal(mayBeEmpty({ maxCloud: 5 }), true);
});

test("registerRoutes is a function and leaves /api/health working", async () => {
  assert.equal(typeof registerRoutes, "function");
  const res = await request(appWith()).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("GET /api/catalogue answers 200 with the catalogue and its standard configuration", async () => {
  const res = await request(appWith()).get("/api/catalogue");
  assert.equal(res.status, 200);
  assert.equal(res.body.standard.layers[0].type, "sentinel2");
  assert.equal(res.body.layers.sentinel2.params.maxCloud.default, 70);
});

test("GET /api/catalogue answers any origin; a data endpoint does not", async () => {
  const origin = "https://anything.example";
  const res = await request(appWith()).get("/api/catalogue").set("Origin", origin);
  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  const data = await request(appWith()).post("/api/tiles/sentinel2").set("Origin", origin);
  assert.equal(data.headers["access-control-allow-origin"], undefined);
});

test("TTLs are 20 hours for tiles and 30 days for series", () => {
  assert.equal(TTL.tiles, 20 * 3600);
  assert.equal(TTL.series, 30 * 24 * 3600);
});

test("POST /api/tiles/sentinel2 without a body is a 400 bad_request", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/tiles/sentinel2");
  assert400(res, /plot is required/, cache);
});

test("POST /api/tiles/sentinel2 with a valid plot but no EE_KEY reaches the auth step and fails as JSON 500", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/tiles/sentinel2", { plot: belize, end: "2025-06-01" });
  assertEeKeyMissing500(res, logged);
  assert.equal(cache.calls.length, 1);
  assert.equal(cache.calls[0].endpoint, "tiles/sentinel2");
  assert.equal(cache.calls[0].ttlSeconds, TTL.tiles);
  assert.deepEqual(cache.calls[0].extras, {});
});

/** POSTs body to path against a canned cache hit; returns the extras the cache was keyed with. */
async function extrasFor(path, body) {
  const cache = fakeCache({ tileUrl: "x" });
  const res = await request(appWith(cache)).post(path).send({ plot: belize, ...body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return cache.calls[0].extras;
}

test("POST /api/tiles/sentinel2 keys the cache only with non-default composite parameters", async () => {
  const path = "/api/tiles/sentinel2";
  assert.deepEqual(await extrasFor(path, {}), {}, "no new fields: the same key as before");
  assert.deepEqual(await extrasFor(path, { bands: "false-colour", maxCloud: 70 }), {}, "explicit defaults equal absent ones");
  assert.deepEqual(await extrasFor(path, { bands: "true-colour" }), { bands: "true-colour" });
  assert.deepEqual(await extrasFor(path, { maxCloud: 20 }), { maxCloud: 20 });
  assert.deepEqual(await extrasFor(path, { compositeStart: "2022-01-01", compositeEnd: "2022-07-01" }), { start: "2022-01-01", end: "2022-07-01" });
  assert.deepEqual(await extrasFor(path, { compositeStart: "2020-01-01", compositeEnd: "2023-01-01" }), { start: "2020-01-01", end: "2023-01-01" }, "three years is allowed");
});

test("POST /api/tiles/sentinel2 rejects bad composite parameters with a 400 before the cache", async () => {
  for (const [body, re] of [
    [{ bands: "infrared" }, /bands/],
    [{ maxCloud: 0 }, /maxCloud/],
    [{ maxCloud: "70" }, /maxCloud/],
    [{ compositeStart: "2022-02-30", compositeEnd: "2022-07-01" }, /start/],
    [{ compositeStart: "2022-01-01" }, /compositeStart and compositeEnd/],
    [{ compositeEnd: "2022-07-01" }, /compositeStart and compositeEnd/],
    [{ compositeStart: "2022-07-01", compositeEnd: "2022-07-01" }, /before/],
    [{ compositeStart: "2022-08-01", compositeEnd: "2022-07-01" }, /before/],
    [{ compositeStart: "2015-06-23", compositeEnd: "9999-12-31" }, /at most 1096 days/],
    [{ compositeStart: "2020-01-01", compositeEnd: "2023-01-02" }, /at most 1096 days/],
  ]) {
    const cache = fakeCache();
    const res = await request(appWith(cache)).post("/api/tiles/sentinel2").send({ plot: belize, ...body });
    assert400(res, re, cache);
  }
});

test("POST /api/tiles/landsat keys the cache with the year plus only non-default composite parameters", async () => {
  const path = "/api/tiles/landsat";
  assert.deepEqual(await extrasFor(path, { year: 2020 }), { year: 2020 }, "no new fields: the same key as before");
  assert.deepEqual(await extrasFor(path, { year: 2020, bands: "false-colour", maxCloud: 50 }), { year: 2020 }, "explicit defaults equal absent ones");
  assert.deepEqual(await extrasFor(path, { year: 2020, bands: "true-colour" }), { year: 2020, bands: "true-colour" });
  assert.deepEqual(await extrasFor(path, { year: 2020, maxCloud: 20 }), { year: 2020, maxCloud: 20 });
});

test("POST /api/tiles/landsat rejects bad composite parameters with a 400 before the cache", async () => {
  for (const [body, re] of [[{ bands: "infrared" }, /bands/], [{ maxCloud: 101 }, /maxCloud/], [{ maxCloud: 20.5 }, /maxCloud/]]) {
    const cache = fakeCache();
    const res = await request(appWith(cache)).post("/api/tiles/landsat").send({ plot: belize, year: 2020, ...body });
    assert400(res, re, cache);
  }
});

test("POST /api/tiles/landsat with a valid plot but year 1900 is a 400 before EE auth or the cache", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/tiles/landsat", { plot: belize, year: 1900 });
  assert400(res, /1984/, cache);
  assert.equal(logged.length, 0, "a 400 must not reach the EE auth step or be logged as a server error");
});

test("POST /api/tiles/landsat with a non-numeric year is a 400", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/tiles/landsat").send({ plot: belize, year: "abc" });
  assert400(res, /year/, cache);
});

test("POST /api/tiles/landsat without a body is a 400 bad_request", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/tiles/landsat");
  assert400(res, /plot is required/, cache);
});

test("POST /api/tiles/landsat with a cache hit answers 200 with the cached value and never touches EE auth", async () => {
  const canned = { tileUrl: "https://earthengine.googleapis.com/v1/projects/x/maps/y/tiles/{z}/{x}/{y}", sensors: ["L8"] };
  const { res, logged, cache } = await postWithoutKey("/api/tiles/landsat", { plot: belize, year: 2020 }, fakeCache(canned));
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ...canned, cached: true });
  assert.equal(logged.length, 0, "a cache hit must not log a server error (no EE auth attempted)");
  assert.equal(cache.calls.length, 1);
  assert.equal(cache.calls[0].endpoint, "tiles/landsat");
  assert.equal(cache.calls[0].ttlSeconds, TTL.tiles);
  assert.deepEqual(cache.calls[0].extras, { year: 2020 });
  assert.deepEqual(cache.calls[0].parsed.plot, belize);
});

test("POST /api/tiles/sentinel1 keys the cache with the year plus only a non-default band combination, without the plot's dates", async () => {
  const path = "/api/tiles/sentinel1";
  assert.deepEqual(await extrasFor(path, { year: 2020 }), { year: 2020 });
  assert.deepEqual(await extrasFor(path, { year: 2020, bands: "false-colour" }), { year: 2020 }, "explicit default equals absent");
  assert.deepEqual(await extrasFor(path, { year: 2020, bands: "vh" }), { year: 2020, bands: "vh" });
  const cache = fakeCache({ tileUrl: "x" });
  const res = await request(appWith(cache)).post(path).send({ plot: belize, start: "2020-01-01", end: "2021-01-01", year: 2020 });
  assert.equal(res.status, 200);
  assert.equal(cache.calls[0].endpoint, "tiles/sentinel1");
  assert.equal(cache.calls[0].ttlSeconds, TTL.tiles);
  assert.equal(cache.calls[0].parsed.start, null);
  assert.equal(cache.calls[0].parsed.end, null);
});

test("POST /api/tiles/sentinel1 rejects a missing, early or non-numeric year and unknown bands with a 400 before the cache", async () => {
  for (const [body, re] of [[{}, /year.*2015/], [{ year: 2014 }, /year.*2015/], [{ year: "2020" }, /year/], [{ year: 2020, bands: "true-colour" }, /bands/]]) {
    const { res, logged, cache } = await postWithoutKey("/api/tiles/sentinel1", { plot: belize, ...body });
    assert400(res, re, cache);
    assert.equal(logged.length, 0);
  }
});

test("POST /api/series/sentinel1 keys the cache with the band only when it is VV, and rejects others before the cache", async () => {
  assert.deepEqual(await extrasFor("/api/series/sentinel1", {}), {});
  assert.deepEqual(await extrasFor("/api/series/sentinel1", { band: "VH" }), {});
  assert.deepEqual(await extrasFor("/api/series/sentinel1", { band: "VV" }), { band: "VV" });
  const cache = fakeCache({ points: [] });
  await request(appWith(cache)).post("/api/series/sentinel1").send({ plot: belize, start: "2020-01-01", end: "2021-01-01" });
  assert.equal(cache.calls[0].endpoint, "series/sentinel1");
  assert.equal(cache.calls[0].ttlSeconds, TTL.series);
  assert.equal(cache.calls[0].parsed.start, "2020-01-01");
  for (const band of ["vh", "HH", 1]) {
    const c = fakeCache();
    const res = await request(appWith(c)).post("/api/series/sentinel1").send({ plot: belize, band });
    assert400(res, /band/, c);
  }
});

test("POST /api/series/precipitation keys the cache with the plot and dates only, as a series", async () => {
  assert.deepEqual(await extrasFor("/api/series/precipitation", { band: "VV" }), {});
  const cache = fakeCache({ points: [] });
  const res = await request(appWith(cache)).post("/api/series/precipitation").send({ plot: belize, start: "2020-01-01", end: "2021-01-01" });
  assert.equal(res.status, 200);
  assert.equal(cache.calls[0].endpoint, "series/precipitation");
  assert.equal(cache.calls[0].ttlSeconds, TTL.series);
  assert.equal(cache.calls[0].parsed.start, "2020-01-01");
  assert.equal(cache.calls[0].parsed.end, "2021-01-01");
  const c = fakeCache();
  assert400(await request(appWith(c)).post("/api/series/precipitation").send({}), /plot is required/, c);
});

test("POST /api/series/modis without a body is a 400 bad_request", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/series/modis");
  assert400(res, /plot is required/, cache);
});

test("POST /api/series/modis with a valid plot but no EE_KEY calls the cache with the parsed request, then fails inside compute as JSON 500", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/series/modis", { plot: belize, start: "2020-01-01", end: "2021-01-01" });
  assertEeKeyMissing500(res, logged);
  assert.equal(cache.calls.length, 1);
  const call = cache.calls[0];
  assert.equal(call.endpoint, "series/modis");
  assert.deepEqual(call.parsed.plot, belize);
  assert.equal(call.parsed.start, "2020-01-01");
  assert.equal(call.parsed.end, "2021-01-01");
  assert.deepEqual(call.extras, {});
  assert.equal(call.ttlSeconds, TTL.series);
});

test("POST /api/series/landsat without a body is a 400 bad_request", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/series/landsat");
  assert400(res, /plot is required/, cache);
});

test("POST /api/series/landsat with a valid plot but no EE_KEY reaches the auth step and fails as JSON 500", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/series/landsat", { plot: belize, start: "2012-01-01", end: "2016-01-01" });
  assertEeKeyMissing500(res, logged);
  assert.equal(cache.calls[0].endpoint, "series/landsat@cloud");
  assert.equal(cache.calls[0].ttlSeconds, TTL.series);
});

test("POST /api/series/landsat and series/sentinel2 key the cache with the index only when it is not NDVI", async () => {
  for (const path of ["/api/series/landsat", "/api/series/sentinel2"]) {
    assert.deepEqual(await extrasFor(path, {}), {}, "no index: the same key as before");
    assert.deepEqual(await extrasFor(path, { index: "NDVI" }), {}, "explicit NDVI equals absent");
    for (const index of ["NDMI", "NBR", "EVI"]) assert.deepEqual(await extrasFor(path, { index }), { index });
  }
});

test("POST /api/series/landsat and series/sentinel2 reject an unknown index with a 400 before the cache", async () => {
  for (const path of ["/api/series/landsat", "/api/series/sentinel2"]) {
    for (const index of ["ndvi", "NDFI", 1]) {
      const cache = fakeCache();
      const res = await request(appWith(cache)).post(path).send({ plot: belize, index });
      assert400(res, /index/, cache);
    }
  }
});

test("POST /api/series/landsat and series/sentinel2 key the cache with the new named indices and with a whitespace-free formula", async () => {
  for (const path of ["/api/series/landsat", "/api/series/sentinel2"]) {
    for (const index of ["EVI2", "MSAVI", "BSI"]) assert.deepEqual(await extrasFor(path, { index }), { index });
    const a = await extrasFor(path, { formula: "(nir - red) / (nir + red)" });
    assert.deepEqual(a, { formula: "(nir-red)/(nir+red)" });
    assert.deepEqual(await extrasFor(path, { formula: " (nir-red)/\t(nir+red)" }), a, "spacing differences share one key");
    assert.deepEqual(await extrasFor(path, { formula: "nir / red" }), { formula: "nir/red" }, "two formulas, two keys");
    assert.deepEqual(await extrasFor(path, { formula: "nir / red", index: "NDVI" }), { formula: "nir/red" }, "an explicit default index goes with a formula");
    assert.deepEqual(await extrasFor(path, { name: "Ratio" }), {}, "name without formula is ignored");
    assert.deepEqual(await extrasFor(path, { formula: "nir / red", name: "Ratio" }), { formula: "nir/red" }, "name never enters the key");
  }
  assert.deepEqual(await extrasFor("/api/series/sentinel2", { formula: "(rededge3 - rededge1) / (rededge3 + rededge1)" }), { formula: "(rededge3-rededge1)/(rededge3+rededge1)" });
});

test("POST /api/series/landsat and series/sentinel2 reject a bad formula, or a formula with another index, with a 400 before the cache", async () => {
  for (const path of ["/api/series/landsat", "/api/series/sentinel2"]) {
    for (const [body, re] of [
      [{ formula: "nir; red" }, /;/],
      [{ formula: "ndvi * 2" }, /ndvi/],
      [{ formula: "(nir - red" }, /parenthes/],
      [{ formula: "1 + 2" }, /band/],
      [{ formula: "" }, /empty/],
      [{ formula: "x".repeat(201) }, /formula.*200/],
      [{ formula: 5 }, /formula/],
      [{ formula: "nir / red", index: "NDMI" }, /formula.*index|index.*formula/],
    ]) {
      const cache = fakeCache();
      const res = await request(appWith(cache)).post(path).send({ plot: belize, ...body });
      assert400(res, re, cache);
    }
  }
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/series/landsat").send({ plot: belize, formula: "(rededge1 - red) / (rededge1 + red)" });
  assert400(res, /rededge1/, cache);
});

test("POST /api/series/modis keys the cache with the index only when it is EVI, and rejects others before the cache", async () => {
  assert.deepEqual(await extrasFor("/api/series/modis", {}), {});
  assert.deepEqual(await extrasFor("/api/series/modis", { index: "NDVI" }), {});
  assert.deepEqual(await extrasFor("/api/series/modis", { index: "EVI" }), { index: "EVI" });
  for (const index of ["NDMI", "evi"]) {
    const cache = fakeCache();
    const res = await request(appWith(cache)).post("/api/series/modis").send({ plot: belize, index });
    assert400(res, /index/, cache);
  }
});

test("POST /api/series/sentinel2 without a body is a 400 bad_request", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/series/sentinel2");
  assert400(res, /plot is required/, cache);
});

test("POST /api/series/sentinel2 with a valid plot but no EE_KEY reaches the auth step and fails as JSON 500", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/series/sentinel2", { plot: belize, start: "2022-01-01", end: "2022-07-01" });
  assertEeKeyMissing500(res, logged);
  assert.equal(cache.calls[0].endpoint, "series/sentinel2@cloud");
  assert.equal(cache.calls[0].ttlSeconds, TTL.series);
});

test("POST /api/tiles/scene without a body is a 400 bad_request", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/tiles/scene");
  assert400(res, /plot is required/, cache);
});

test("POST /api/tiles/scene with an unknown sensor is a 400 before EE auth or the cache", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/tiles/scene", { plot: belize, sensor: "modis", timeStart: 1 });
  assert400(res, /landsat or sentinel2/, cache);
  assert.equal(logged.length, 0, "a 400 must not reach the EE auth step or be logged as a server error");
});

test("POST /api/tiles/scene with a non-numeric timeStart is a 400 before EE auth or the cache", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/tiles/scene", { plot: belize, sensor: "landsat", timeStart: "abc" });
  assert400(res, /timeStart/, cache);
  assert.equal(logged.length, 0, "a 400 must not reach the EE auth step or be logged as a server error");
});

test("POST /api/tiles/scene with a valid plot, sensor and timeStart but no EE_KEY reaches the auth step and fails as JSON 500", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/tiles/scene", { plot: belize, sensor: "sentinel2", timeStart: "1609459200000" });
  assertEeKeyMissing500(res, logged);
  assert.equal(cache.calls[0].endpoint, "tiles/scene");
  assert.equal(cache.calls[0].ttlSeconds, TTL.tiles);
  assert.deepEqual(cache.calls[0].extras, { sensor: "sentinel2", timeStart: 1609459200000 }, "extras carry the normalised scene parameters");
});

test("POST /api/ccdc without a body is a 400 bad_request", async () => {
  const cache = fakeCache();
  const res = await request(appWith(cache)).post("/api/ccdc");
  assert400(res, /plot is required/, cache);
});

test("POST /api/ccdc with an unknown band is a 400 before EE auth or the cache", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/ccdc", { plot: belize, band: "EVI" });
  assert400(res, /NDFI or NDVI/, cache);
  assert.equal(logged.length, 0, "a 400 must not reach the EE auth step or be logged as a server error");
});

test("POST /api/ccdc with a valid plot but no EE_KEY reaches the auth step and fails as JSON 500", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/ccdc", { plot: belize, start: "2010-01-01", end: "2020-01-01" });
  assertEeKeyMissing500(res, logged);
  assert.equal(cache.calls[0].endpoint, "ccdc");
  assert.equal(cache.calls[0].ttlSeconds, TTL.series);
  assert.deepEqual(cache.calls[0].extras, { band: "NDFI" }, "the default band is part of the key");
});

test("POST /api/ccdc with band NDVI and no EE_KEY passes validation and reaches the auth step", async () => {
  const { res, logged, cache } = await postWithoutKey("/api/ccdc", { plot: belize, band: "NDVI" });
  assertEeKeyMissing500(res, logged);
  assert.deepEqual(cache.calls[0].extras, { band: "NDVI" });
});

test("registerRoutes without options uses the default (Firestore) cache lazily, without initialising firebase-admin", () => {
  const { getApps } = require("firebase-admin/app");
  createApp(registerRoutes);
  assert.equal(getApps().length, 0);
});

test("tiles/sentinel2 drops start from the cache key, tiles/scene and tiles/landsat both dates (their computation ignores them); series/modis keeps them", async () => {
  const canned = { tileUrl: "https://example/{z}/{x}/{y}", label: "x" };
  const body = { plot: belize, start: "2020-01-01", end: "2021-01-01" };

  let cache = fakeCache(canned);
  let res = await request(appWith(cache)).post("/api/tiles/sentinel2").send(body);
  assert.equal(res.status, 200);
  assert.equal(cache.calls[0].parsed.start, null);
  assert.equal(cache.calls[0].parsed.end, "2021-01-01");
  assert.deepEqual(cache.calls[0].parsed.plot, belize);

  cache = fakeCache(canned);
  res = await request(appWith(cache)).post("/api/tiles/scene").send({ ...body, sensor: "landsat", timeStart: 1609459200000 });
  assert.equal(res.status, 200);
  assert.equal(cache.calls[0].parsed.start, null);
  assert.equal(cache.calls[0].parsed.end, null);

  cache = fakeCache(canned);
  res = await request(appWith(cache)).post("/api/tiles/landsat").send({ ...body, year: 2020 });
  assert.equal(res.status, 200);
  assert.equal(cache.calls[0].parsed.start, null);
  assert.equal(cache.calls[0].parsed.end, null);

  cache = fakeCache({ series: [] });
  res = await request(appWith(cache)).post("/api/series/modis").send(body);
  assert.equal(res.status, 200);
  assert.equal(cache.calls[0].parsed.start, "2020-01-01");
});

test("POST /api/tiles/sentinel2 with its own window keys the cache without the plot's end; without one it keeps it", async () => {
  const keyOf = async (body) => {
    const cache = fakeCache({ tileUrl: "x" });
    await request(appWith(cache)).post("/api/tiles/sentinel2").send({ plot: belize, ...body });
    return cache.calls[0].parsed;
  };
  const window = { compositeStart: "2022-01-01", compositeEnd: "2022-07-01" };
  assert.equal((await keyOf({ end: "2025-06-01", ...window })).end, null);
  assert.equal((await keyOf({ end: "2025-06-01" })).end, "2025-06-01");
  assert.equal((await keyOf({ end: "2025-06-01" })).start, null);
});

test("only the two series whose points carry `cloud` use a versioned cache key; every other endpoint keeps its name", async () => {
  const body = { plot: belize, start: "2020-01-01", end: "2021-01-01" };
  const cases = [
    ["/api/series/landsat", {}, "series/landsat@cloud"],
    ["/api/series/sentinel2", {}, "series/sentinel2@cloud"],
    ["/api/series/modis", {}, "series/modis"],
    ["/api/tiles/sentinel2", {}, "tiles/sentinel2"],
    ["/api/tiles/landsat", { year: 2020 }, "tiles/landsat"],
    ["/api/tiles/scene", { sensor: "landsat", timeStart: 1609459200000 }, "tiles/scene"],
    ["/api/ccdc", {}, "ccdc"],
  ];
  for (const [path, extra, endpoint] of cases) {
    const cache = fakeCache({ x: 1 });
    const res = await request(appWith(cache)).post(path).send({ ...body, ...extra });
    assert.equal(res.status, 200, path);
    assert.equal(cache.calls[0].endpoint, endpoint, path);
  }
});

test("POST /api/tiles/difference keys the cache with both sides' path and non-default extras, the plot's dates kept, bands ignored", async () => {
  const path = "/api/tiles/difference";
  const landsat2019 = { path: "tiles/landsat", year: 2019 };
  assert.deepEqual(
    await extrasFor(path, { left: landsat2019, right: { path: "tiles/sentinel2" } }),
    { left: { path: "tiles/landsat", year: 2019 }, right: { path: "tiles/sentinel2" } }
  );
  assert.deepEqual(
    await extrasFor(path, { left: { ...landsat2019, bands: "true-colour", maxCloud: 50 }, right: { path: "tiles/sentinel2", bands: "true-colour", maxCloud: 20, compositeStart: "2022-01-01", compositeEnd: "2023-01-01" } }),
    { left: { path: "tiles/landsat", year: 2019 }, right: { path: "tiles/sentinel2", maxCloud: 20, start: "2022-01-01", end: "2023-01-01" } },
    "defaults dropped, bands ignored, the window renamed as its own endpoint does"
  );
  assert.deepEqual(
    await extrasFor(path, { left: { timeStart: "1609459200000", sensor: "landsat", path: "tiles/scene" }, right: { year: 2021, path: "tiles/landsat" } }),
    { left: { path: "tiles/scene", sensor: "landsat", timeStart: 1609459200000 }, right: { path: "tiles/landsat", year: 2021 } }
  );

  // The same comparison sent with keys in another order gives the same cache key.
  const { cacheKey } = require("../lib/cacheKey");
  const keyOf = async (body) => {
    const cache = fakeCache({ tileUrl: "x" });
    const res = await request(appWith(cache)).post(path).send({ plot: belize, start: "2020-01-01", end: "2021-01-01", ...body });
    assert.equal(res.status, 200);
    const c = cache.calls[0];
    assert.equal(c.endpoint, "tiles/difference");
    assert.equal(c.ttlSeconds, TTL.tiles);
    assert.equal(c.parsed.end, "2021-01-01", "the last-12-months composite depends on the plot's end");
    return cacheKey(c.endpoint, c.parsed, c.extras);
  };
  assert.equal(
    await keyOf({ left: { path: "tiles/sentinel2", maxCloud: 20 }, right: { path: "tiles/scene", sensor: "sentinel2", timeStart: 1 } }),
    await keyOf({ right: { timeStart: 1, sensor: "sentinel2", path: "tiles/scene" }, left: { maxCloud: 20, path: "tiles/sentinel2" } })
  );
});

test("POST /api/tiles/difference rejects a missing or bad side with a 400 before the cache, using each endpoint's own validation", async () => {
  const good = { path: "tiles/landsat", year: 2020 };
  for (const [body, re] of [
    [{ right: good }, /left is required/],
    [{ left: good }, /right is required/],
    [{ left: good, right: { path: "tiles/nope" } }, /right\.path must be one of/],
    [{ left: { path: "tiles/sentinel1", year: 2020 }, right: good }, /left\.path must be one of/],
    [{ left: { year: 2020 }, right: good }, /left\.path/],
    [{ left: { path: "tiles/landsat" }, right: good }, /left: year/],
    [{ left: good, right: { path: "tiles/landsat", year: 1900 } }, /right: year.*1984/],
    [{ left: good, right: { path: "tiles/landsat", year: 2020, maxCloud: 101 } }, /right: .*maxCloud/],
    [{ left: { path: "tiles/scene", sensor: "modis", timeStart: 1 }, right: good }, /left: sensor/],
    [{ left: { path: "tiles/scene", sensor: "landsat" }, right: good }, /left: timeStart/],
    [{ left: good, right: { path: "tiles/sentinel2", compositeStart: "2022-01-01" } }, /right: compositeStart and compositeEnd/],
  ]) {
    const { res, logged, cache } = await postWithoutKey("/api/tiles/difference", { plot: belize, ...body });
    assert400(res, re, cache);
    assert.equal(logged.length, 0);
  }
});

test("computations, not cache hits, are limited per client address (the last X-Forwarded-For entry) with 429 rate_limited", async () => {
  const saved = process.env.EE_KEY;
  delete process.env.EE_KEY;
  try {
    const rateLimit = createRateLimit({ limit: 2, now: () => 0 });
    const hits = request(appWith(fakeCache({ series: [] }), rateLimit));
    for (let i = 0; i < 3; i++) assert.equal((await hits.post("/api/series/modis").set("X-Forwarded-For", "9.9.9.9").send({ plot: belize })).status, 200);
    const app = request(appWith(fakeCache(), rateLimit));
    const post = (xff) => app.post("/api/series/modis").set("X-Forwarded-For", xff).send({ plot: belize });
    await quietly(async () => {
      // Under the limit a computation goes on to EE auth (no key here: 500).
      assert.equal((await post("6.6.6.6, 9.9.9.9")).status, 500);
      assert.equal((await post("7.7.7.7, 9.9.9.9")).status, 500);
      const res = await post("8.8.8.8, 9.9.9.9");
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, "rate_limited");
      assert.equal(res.body.error.retryable, true);
      assert.equal((await post("9.9.9.9, 1.2.3.4")).status, 500, "another address has its own count");
    });
  } finally {
    if (saved !== undefined) process.env.EE_KEY = saved;
  }
});
