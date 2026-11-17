const { cacheKey } = require("./lib/cacheKey");
const { NotFound } = require("./lib/errors");

const COLLECTION = "cache";
/** "No imagery here" answers are kept for an hour: new scenes arrive, but asking again every page view is waste. */
const NOT_FOUND_TTL = 3600;

/** Milliseconds for an `expiresAt` read back from Firestore (Timestamp) or from a plain Date/number. */
function expiresAtMillis(expiresAt) {
  if (expiresAt && typeof expiresAt.toMillis === "function") return expiresAt.toMillis();
  const ms = new Date(expiresAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Builds a result cache on top of a Firestore-like client (`db.collection(name).doc(id).get()/set()`).
 * `now` and `warn` are injectable for tests. Cache failures never fail a request: a read error
 * is treated as a miss and a write error is only logged.
 */
function createCache(db, { now = Date.now, warn = (...args) => console.warn(...args) } = {}) {
  async function read(ref) {
    try {
      const snap = await ref.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (!data || expiresAtMillis(data.expiresAt) <= now()) return null;
      return data.value;
    } catch (err) {
      warn("cache read failed:", err && err.message ? err.message : String(err));
      return null;
    }
  }

  function write(ref, endpoint, value, ttlSeconds) {
    // Fire and forget: the response does not wait for Firestore.
    const expiresAt = new Date(now() + ttlSeconds * 1000);
    Promise.resolve()
      .then(() => ref.set({ endpoint, value, expiresAt }))
      .catch((err) => warn("cache write failed:", err && err.message ? err.message : String(err)));
  }

  /** Computes in flight in this instance, by cache key: a second identical request waits for the first. */
  const inFlight = new Map();

  async function computeAndStore(ref, endpoint, ttlSeconds, compute) {
    try {
      const value = await compute();
      write(ref, endpoint, value, ttlSeconds);
      return value;
    } catch (err) {
      if (err instanceof NotFound) write(ref, endpoint, { notFound: err.message }, NOT_FOUND_TTL);
      throw err;
    }
  }

  /**
   * Returns the cached value (with `cached: true`) for this endpoint/plot/dates/extras, or runs
   * `compute` and stores its result for `ttlSeconds`. A cached NotFound is thrown again.
   */
  async function withCache(endpoint, parsed, extras, ttlSeconds, compute) {
    const key = cacheKey(endpoint, parsed, extras);
    const ref = db.collection(COLLECTION).doc(key);
    const hit = await read(ref);
    if (hit !== null) {
      if (typeof hit.notFound === "string") throw new NotFound(hit.notFound);
      return { ...hit, cached: true };
    }
    if (!inFlight.has(key)) {
      inFlight.set(key, computeAndStore(ref, endpoint, ttlSeconds, compute).finally(() => inFlight.delete(key)));
    }
    return inFlight.get(key);
  }

  return { withCache };
}

/**
 * The production cache, built on first use so that requiring this module (unit tests,
 * `node -e require`) never initialises firebase-admin or opens a Firestore connection.
 * Under `firebase emulators:start` firebase-admin picks up FIRESTORE_EMULATOR_HOST automatically.
 */
let defaultCache;
function getDefaultCache() {
  if (!defaultCache) {
    const { getApps, initializeApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    if (!getApps().length) initializeApp();
    // Named database: the project's (default) one is in Datastore mode and belongs to other services.
    defaultCache = createCache(getFirestore("explorer"));
  }
  return defaultCache;
}

const withCache = (...args) => getDefaultCache().withCache(...args);

module.exports = { createCache, withCache, getDefaultCache, COLLECTION };
