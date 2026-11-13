const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCache, COLLECTION } = require("../cache");
const { cacheKey } = require("../lib/cacheKey");

const parsed = { plot: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, start: "2020-01-01", end: "2021-01-01", areaHa: 1 };

/**
 * Minimal in-memory stand-in for the Firestore client surface cache.js uses:
 * db.collection(name).doc(id).get() / .set(data). Records every call.
 */
function fakeDb({ docs = {}, getError, setError } = {}) {
  const calls = { get: [], set: [], collections: [] };
  const db = {
    collection(name) {
      calls.collections.push(name);
      return {
        doc(id) {
          return {
            async get() {
              calls.get.push(id);
              if (getError) throw getError;
              const data = docs[id];
              return { exists: data !== undefined, data: () => data };
            },
            async set(data) {
              calls.set.push({ id, data });
              if (setError) throw setError;
              docs[id] = data;
            },
          };
        },
      };
    },
  };
  return { db, calls, docs };
}

/** Lets a fire-and-forget promise chain settle. */
const settle = () => new Promise((r) => setImmediate(r));

test("cache hit returns the stored value with cached: true and does not run compute", async () => {
  const key = cacheKey("series/modis", parsed, {});
  const stored = { endpoint: "series/modis", value: { series: [1, 2, 3] }, expiresAt: { toMillis: () => Date.now() + 60_000 } };
  const { db, calls } = fakeDb({ docs: { [key]: stored } });
  const { withCache } = createCache(db);
  let computed = 0;
  const result = await withCache("series/modis", parsed, {}, 60, async () => { computed += 1; return { series: [] }; });
  assert.deepEqual(result, { series: [1, 2, 3], cached: true });
  assert.equal(computed, 0);
  assert.deepEqual(calls.collections, [COLLECTION]);
  assert.deepEqual(calls.set, []);
});

test("cache miss runs compute, returns its value without cached flag and writes endpoint, value and expiresAt", async () => {
  const { db, calls, docs } = fakeDb();
  const now = 1_700_000_000_000;
  const { withCache } = createCache(db, { now: () => now });
  const result = await withCache("tiles/landsat", parsed, { year: 2020 }, 20 * 3600, async () => ({ tileUrl: "u" }));
  assert.deepEqual(result, { tileUrl: "u" });
  assert.equal(result.cached, undefined);
  await settle();
  assert.equal(calls.set.length, 1);
  const key = cacheKey("tiles/landsat", parsed, { year: 2020 });
  assert.equal(calls.set[0].id, key);
  const written = docs[key];
  assert.equal(written.endpoint, "tiles/landsat");
  assert.deepEqual(written.value, { tileUrl: "u" });
  assert.equal(new Date(written.expiresAt).getTime(), now + 20 * 3600 * 1000);
});

test("an expired entry is recomputed and overwritten", async () => {
  const key = cacheKey("series/modis", parsed, {});
  const stale = { endpoint: "series/modis", value: { series: ["old"] }, expiresAt: { toMillis: () => Date.now() - 1 } };
  const { db, calls, docs } = fakeDb({ docs: { [key]: stale } });
  const { withCache } = createCache(db);
  const result = await withCache("series/modis", parsed, {}, 60, async () => ({ series: ["new"] }));
  assert.deepEqual(result, { series: ["new"] });
  await settle();
  assert.equal(calls.set.length, 1);
  assert.deepEqual(docs[key].value, { series: ["new"] });
});

test("an entry whose expiresAt was stored as a Date is honoured too", async () => {
  const key = cacheKey("series/modis", parsed, {});
  const { db } = fakeDb({ docs: { [key]: { endpoint: "series/modis", value: { series: [9] }, expiresAt: new Date(Date.now() + 60_000) } } });
  const { withCache } = createCache(db);
  const result = await withCache("series/modis", parsed, {}, 60, async () => ({ series: [] }));
  assert.deepEqual(result, { series: [9], cached: true });
});

test("refresh: true skips the read, recomputes and rewrites the entry", async () => {
  const key = cacheKey("series/modis", parsed, {});
  const fresh = { endpoint: "series/modis", value: { series: ["cached"] }, expiresAt: { toMillis: () => Date.now() + 60_000 } };
  const { db, calls, docs } = fakeDb({ docs: { [key]: fresh } });
  const { withCache } = createCache(db);
  const result = await withCache("series/modis", parsed, {}, 60, async () => ({ series: ["recomputed"] }), { refresh: true });
  assert.deepEqual(result, { series: ["recomputed"] });
  assert.deepEqual(calls.get, [], "refresh must not read the cache");
  await settle();
  assert.deepEqual(docs[key].value, { series: ["recomputed"] });
});

test("a Firestore read error is treated as a miss and logged once", async () => {
  const warnings = [];
  const { db, calls } = fakeDb({ getError: new Error("firestore unavailable") });
  const { withCache } = createCache(db, { warn: (...a) => warnings.push(a) });
  const result = await withCache("series/modis", parsed, {}, 60, async () => ({ series: [1] }));
  assert.deepEqual(result, { series: [1] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].join(" "), /cache read failed.*firestore unavailable/);
  await settle();
  assert.equal(calls.set.length, 1, "the fresh result is still written");
});

test("a Firestore write error does not fail the request and is logged as a warning", async () => {
  const warnings = [];
  const { db } = fakeDb({ setError: new Error("permission denied") });
  const { withCache } = createCache(db, { warn: (...a) => warnings.push(a) });
  const result = await withCache("series/modis", parsed, {}, 60, async () => ({ series: [1] }));
  assert.deepEqual(result, { series: [1] });
  await settle();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].join(" "), /cache write failed.*permission denied/);
});

test("a compute failure propagates and nothing is written", async () => {
  const { db, calls } = fakeDb();
  const { withCache } = createCache(db);
  await assert.rejects(withCache("series/modis", parsed, {}, 60, async () => { throw new Error("EE_KEY secret is not set"); }), /EE_KEY/);
  await settle();
  assert.deepEqual(calls.set, []);
});

test("requiring cache.js does not initialise firebase-admin", () => {
  const { getApps } = require("firebase-admin/app");
  assert.equal(getApps().length, 0);
});
