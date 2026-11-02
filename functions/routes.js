const { asyncHandler } = require("./app");
const { parsePlotRequest } = require("./lib/plotRequest");
const { sensorsForYear } = require("./lib/sensors");
const { eeAuth, ee } = require("./ee/auth");
const { sentinel2CompositeTiles } = require("./ee/sentinel2Composite");
const { landsatCompositeTiles } = require("./ee/landsatComposite");
const { modisSeries } = require("./ee/modisSeries");
const { landsatSeries } = require("./ee/landsatSeries");
const { sentinel2Series } = require("./ee/sentinel2Series");
const { sceneTiles, validateSceneRequest } = require("./ee/scene");
const { ccdcSeries, validateCcdcRequest } = require("./ee/ccdc");
const defaultCache = require("./cache");

/** Cache lifetimes in seconds: tile URLs expire on the EE side after ~24 h, series results are stable. */
const TTL = { tiles: 20 * 3600, series: 30 * 24 * 3600 };

/**
 * Builds a cached POST handler. Order per request:
 *   1. parsePlotRequest(body) and the optional `validate(body)` hook: a 400 here never reaches the cache or EE;
 *   2. `extrasOf(body)` -> endpoint-specific parameters, part of the cache key and the third argument of compute;
 *   3. cache lookup (skipped with `?refresh=1`); on a miss: eeAuth, then `compute(parsed, eeGeometry, extras)`.
 * `extrasOf` may itself throw a BadRequest (the scene and ccdc validators double as extras builders).
 * `ignoreStart` keys the cache with `start: null` for endpoints whose computation does not depend on
 * `start` (tile composites and scenes), so one plot does not get one cache entry per start date.
 */
function plotRoute(endpoint, ttlSeconds, extrasOf, compute, validate, cache = defaultCache, { ignoreStart = false } = {}) {
  return asyncHandler(async (req, res) => {
    const parsed = parsePlotRequest(req.body);
    if (validate) validate(req.body);
    const extras = extrasOf ? extrasOf(req.body) : {};
    const refresh = req.query.refresh === "1";
    const keyed = ignoreStart ? { ...parsed, start: null } : parsed;
    const result = await cache.withCache(endpoint, keyed, extras, ttlSeconds, async () => {
      await eeAuth();
      return compute(parsed, ee.Geometry(parsed.plot), extras);
    }, { refresh });
    res.json(result);
  });
}

/** Registers the API routes; `cache` (an object with `withCache`) defaults to the Firestore-backed one. */
function registerRoutes(app, { cache = defaultCache } = {}) {
  const route = (endpoint, ttl, extrasOf, compute, validate, opts) => plotRoute(endpoint, ttl, extrasOf, compute, validate, cache, opts);
  const noStart = { ignoreStart: true };

  app.post("/api/tiles/sentinel2", route("tiles/sentinel2", TTL.tiles, null, (p, g) => sentinel2CompositeTiles(g, p.end), null, noStart));
  app.post(
    "/api/tiles/landsat",
    route("tiles/landsat", TTL.tiles, (b) => ({ year: Number(b.year) }), (p, g, x) => landsatCompositeTiles(g, x.year), (b) => sensorsForYear(Number(b.year)))
  );
  app.post("/api/series/modis", route("series/modis", TTL.series, null, (p, g) => modisSeries(g, p.start, p.end)));
  app.post("/api/series/landsat", route("series/landsat", TTL.series, null, (p, g) => landsatSeries(g, p.start, p.end)));
  app.post("/api/series/sentinel2", route("series/sentinel2", TTL.series, null, (p, g) => sentinel2Series(g, p.start, p.end)));
  app.post(
    "/api/tiles/scene",
    route("tiles/scene", TTL.tiles, validateSceneRequest, (p, g, x) => sceneTiles(g, p.start, p.end, x.sensor, x.timeStart), null, noStart)
  );
  app.post("/api/ccdc", route("ccdc", TTL.series, validateCcdcRequest, (p, g, x) => ccdcSeries(g, p.start, p.end, x.band)));
}

module.exports = { registerRoutes, plotRoute, TTL };
