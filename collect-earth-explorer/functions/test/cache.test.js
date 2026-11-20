const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCache, COLLECTION } = require("../cache");
const { cacheKey } = require("../lib/cacheKey");
const { NotFound } = require("../lib/errors");

const parsed = { plot: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, start: "2020-01-01", end: "2021-01-01", areaHa: 1 };

/**
 * Minimal in-memory stand-in for the Firestore client surface cache.js uses:
 * db.collection(name).doc(id).get() / .set(data). Records every call.
 */
function fakeDb({ docs = {}, getError, setError, setGate } = {}) {
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
              if (setGate) await setGate;
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

/** Lets pending promise chains settle. */
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

test("two concurrent identical requests share one compute, and the next one after it settles computes again", async () => {
  const { db } = fakeDb({ setError: new Error("no writes, so every read misses") });
  const { withCache } = createCache(db, { warn: () => {} });
  let computed = 0;
  let release;
  const compute = () => { computed += 1; return new Promise((r) => { release = r; }); };
  const a = withCache("ccdc", parsed, {}, 60, compute);
  const b = withCache("ccdc", parsed, {}, 60, compute);
  await settle();
  release({ ok: 1 });
  assert.deepEqual(await a, { ok: 1 });
  assert.deepEqual(await b, { ok: 1 });
  assert.equal(computed, 1);
  await assert.rejects(withCache("ccdc", parsed, {}, 60, async () => { computed += 1; throw new Error("boom"); }), /boom/);
  await withCache("ccdc", parsed, {}, 60, async () => { computed += 1; return {}; });
  assert.equal(computed, 3, "a settled compute, failed or not, is not reused");
});

test("a NotFound is cached for an hour and thrown again on a hit without computing", async () => {
  const { db, docs } = fakeDb();
  const now = 1_700_000_000_000;
  const { withCache } = createCache(db, { now: () => now });
  let computed = 0;
  const compute = async () => { computed += 1; throw new NotFound("no landsat scene"); };
  await assert.rejects(withCache("tiles/scene", parsed, {}, 20 * 3600, compute), { status: 404, message: "no landsat scene" });
  await settle();
  const stored = docs[cacheKey("tiles/scene", parsed, {})];
  assert.deepEqual(stored.value, { notFound: "no landsat scene" });
  assert.equal(new Date(stored.expiresAt).getTime(), now + 3600 * 1000);
  await assert.rejects(withCache("tiles/scene", parsed, {}, 20 * 3600, compute), { status: 404, code: "not_found", message: "no landsat scene" });
  assert.equal(computed, 1);
});

test("the reply waits for the cache write, of a value and of a NotFound, so it is not lost once the response is sent", async () => {
  let open;
  const { db, calls } = fakeDb({ setGate: new Promise((r) => { open = r; }) });
  const { withCache } = createCache(db);
  let settled = 0;
  const value = withCache("series/modis", parsed, {}, 60, async () => ({ series: [1] })).then((v) => { settled += 1; return v; });
  const missing = withCache("tiles/scene", parsed, {}, 60, async () => { throw new NotFound("none"); }).catch((e) => { settled += 1; return e; });
  await settle();
  assert.equal(calls.set.length, 2);
  assert.equal(settled, 0, "nothing answers before Firestore has the entries");
  open();
  assert.deepEqual(await value, { series: [1] });
  assert.equal((await missing).status, 404);
});

test("a NotFound whose write fails is still thrown as the NotFound", async () => {
  const { db } = fakeDb({ setError: new Error("permission denied") });
  const { withCache } = createCache(db, { warn: () => {} });
  await assert.rejects(withCache("tiles/scene", parsed, {}, 60, async () => { throw new NotFound("none"); }), { status: 404, message: "none" });
});

test("requiring cache.js does not initialise firebase-admin", () => {
  const { getApps } = require("firebase-admin/app");
  assert.equal(getApps().length, 0);
});
