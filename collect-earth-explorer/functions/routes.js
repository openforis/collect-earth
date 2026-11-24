const { asyncHandler } = require("./app");
const { parsePlotRequest } = require("./lib/plotRequest");
const { sensorsForYear } = require("./lib/sensors");
const { eeAuth, ee } = require("./ee/auth");
const { sentinel2CompositeTiles, sentinel2CompositeImage } = require("./ee/sentinel2Composite");
const { landsatCompositeTiles, landsatCompositeImage } = require("./ee/landsatComposite");
const { modisSeries } = require("./ee/modisSeries");
const { landsatSeries } = require("./ee/landsatSeries");
const { sentinel2Series } = require("./ee/sentinel2Series");
const { hlsSeries } = require("./ee/hls");
const { sentinel1CompositeTiles, sentinel1Series } = require("./ee/sentinel1");
const { precipitationSeries } = require("./ee/precipitation");
const { sceneTiles, sceneImage, validateSceneRequest } = require("./ee/scene");
const { differenceTiles } = require("./ee/difference");
const { ccdcSeries, validateCcdcRequest } = require("./ee/ccdc");
const { catalogue, paramOf } = require("./lib/catalogue");
const { BadRequest } = require("./lib/errors");
const { checkFormula, normaliseFormula } = require("./lib/formula");
const defaultCache = require("./cache");
const { createRateLimit, clientAddress } = require("./lib/rateLimit");

// Generous on purpose: a classroom of interpreters shares one address. Counts computations only, not cache hits.
const defaultRateLimit = createRateLimit();

/** Cache lifetimes in seconds: tile URLs expire on the EE side after ~24 h, series results are stable. */
const TTL = { tiles: 20 * 3600, series: 30 * 24 * 3600 };

/**
 * Builds a cached POST handler. Order per request:
 *   1. parsePlotRequest(body) and the optional `validate(body)` hook: a 400 here never reaches the cache or EE;
 *   2. `extrasOf(body)` -> endpoint-specific parameters, part of the cache key and the third argument of compute;
 *   3. cache lookup; on a miss: the client address's rate limit (429), eeAuth, then `compute(parsed, eeGeometry, extras)`.
 * `extrasOf` may itself throw a BadRequest (the scene and ccdc validators double as extras builders).
 * `ignore` drops from the cache key the dates the computation does not use, so one plot does not get one
 * entry per date: "start" (the Sentinel-2 composite) or "dates" (the Landsat composite and scenes).
 */
function plotRoute(endpoint, ttlSeconds, extrasOf, compute, validate, cache = defaultCache, { ignore, rateLimit = defaultRateLimit } = {}) {
  return asyncHandler(async (req, res) => {
    const parsed = parsePlotRequest(req.body);
    if (validate) validate(req.body);
    const extras = extrasOf ? extrasOf(req.body) : {};
    // With its own window (extras.end) a composite does not depend on the plot's end either.
    const keyed = ignore === "dates" ? { ...parsed, start: null, end: null }
      : ignore === "start" ? { ...parsed, start: null, end: extras.end ? null : parsed.end } : parsed;
    const result = await cache.withCache(endpoint, keyed, extras, ttlSeconds, async () => {
      rateLimit.take(clientAddress(req));
      await eeAuth();
      return compute(parsed, ee.Geometry(parsed.plot), extras);
    });
    res.json(result);
  });
}

/**
 * The catalogue parameters `names` of `kind` ("layers" or "charts") `type` from the body, validated, keeping only
 * non-default values: extras are part of the cache key, so an absent and an explicit default must give the same
 * (pre-existing) key.
 */
function nonDefault(kind, type, body, names) {
  const x = {};
  for (const name of names) {
    const v = paramOf(kind, type, name, body[name]);
    if (v !== paramOf(kind, type, name)) x[name] = v;
  }
  return x;
}

/** Three years: the longest Sentinel-2 composite window a request may ask for (web/src/lib/config.ts applies the same). */
const MAX_WINDOW_DAYS = 1096;

/** Sentinel-2 composite extras; the optional window `compositeStart`/`compositeEnd` becomes `start`/`end`. */
function sentinel2Extras(b) {
  const x = nonDefault("layers", "sentinel2", b, ["bands", "maxCloud"]);
  const start = paramOf("layers", "sentinel2", "start", b.compositeStart);
  const end = paramOf("layers", "sentinel2", "end", b.compositeEnd);
  if ((start === undefined) !== (end === undefined)) throw new BadRequest("compositeStart and compositeEnd go together");
  if (start === undefined) return x;
  if (start >= end) throw new BadRequest("compositeStart must be before compositeEnd");
  // The API is public: an unbounded window would be the cheapest way to make a request expensive.
  if (Date.parse(end) - Date.parse(start) > MAX_WINDOW_DAYS * 86400000) throw new BadRequest(`the composite window is at most ${MAX_WINDOW_DAYS} days`);
  return { ...x, start, end };
}

/**
 * Index series extras: a non-default `index`, or a custom `formula` checked against the sensor's bands and
 * stored without whitespace (one cache entry whatever the spacing). The display-only `name` is never read.
 */
function seriesExtras(type) {
  return (b) => {
    const x = nonDefault("charts", type, b, ["index"]);
    const formula = paramOf("charts", type, "formula", b.formula);
    if (formula === undefined) return x;
    if (x.index) throw new BadRequest("give either formula or index, not both");
    return { formula: normaliseFormula(checkFormula(formula, catalogue.bands[type])) };
  };
}

/**
 * The optical tile endpoints by path: their extras/validate hooks (shared by their own route and each side of
 * tiles/difference) and the unvisualised image their tiles show (with `label` and the bands NDVI needs).
 */
const TILE_SOURCES = {
  "tiles/sentinel2": { extrasOf: sentinel2Extras, image: (p, g, x) => sentinel2CompositeImage(g, x.end ?? p.end, x) },
  "tiles/landsat": {
    extrasOf: (b) => ({ year: Number(b.year), ...nonDefault("layers", "landsat", b, ["bands", "maxCloud"]) }),
    validate: (b) => sensorsForYear(Number(b.year)),
    image: (p, g, { year, ...options }) => landsatCompositeImage(g, year, options),
  },
  "tiles/scene": { extrasOf: validateSceneRequest, image: (p, g, x) => sceneImage(g, x.sensor, x.timeStart) },
};

/**
 * tiles/difference extras: each side `{ path, ...fields }` validated by its own endpoint's hooks and kept as
 * `{ path, ...its extras }`. `bands` is dropped first: it does not change the index.
 */
function differenceExtras(b) {
  const side = (name) => {
    const s = b[name];
    if (!s || typeof s !== "object") throw new BadRequest(`${name} is required`);
    const { path, bands, ...fields } = s;
    if (!Object.hasOwn(TILE_SOURCES, path)) throw new BadRequest(`${name}.path must be one of ${Object.keys(TILE_SOURCES).join(", ")}`);
    const source = TILE_SOURCES[path];
    try {
      if (source.validate) source.validate(fields);
      return { path, ...source.extrasOf(fields) };
    } catch (err) {
      if (err.status === 400) err.message = `${name}: ${err.message}`;
      throw err;
    }
  };
  return { left: side("left"), right: side("right") };
}

/**
 * Registers the API routes; `cache` (an object with `withCache`) defaults to the Firestore-backed one, `rateLimit`
 * (lib/rateLimit.js) to this instance's.
 */
function registerRoutes(app, { cache = defaultCache, rateLimit = defaultRateLimit } = {}) {
  const route = (endpoint, ttl, extrasOf, compute, validate, opts) => plotRoute(endpoint, ttl, extrasOf, compute, validate, cache, { ...opts, rateLimit });
  const noStart = { ignore: "start" };
  const noDates = { ignore: "dates" };

  // Public and read-only: the cloud dashboard reads it from any origin (replaces the allowlist's echo for this route).
  app.get("/api/catalogue", (req, res) => res.set("Access-Control-Allow-Origin", "*").json(catalogue));
  app.post("/api/tiles/sentinel2", route("tiles/sentinel2", TTL.tiles, TILE_SOURCES["tiles/sentinel2"].extrasOf, (p, g, x) => sentinel2CompositeTiles(g, x.end ?? p.end, x), null, noStart));
  app.post(
    "/api/tiles/landsat",
    route(
      "tiles/landsat",
      TTL.tiles,
      TILE_SOURCES["tiles/landsat"].extrasOf,
      (p, g, { year, ...options }) => landsatCompositeTiles(g, year, options),
      TILE_SOURCES["tiles/landsat"].validate,
      noDates
    )
  );
  app.post(
    "/api/tiles/sentinel1",
    route(
      "tiles/sentinel1",
      TTL.tiles,
      (b) => ({ year: b.year, ...nonDefault("layers", "sentinel1", b, ["bands"]) }),
      (p, g, { year, ...options }) => sentinel1CompositeTiles(g, year, options),
      // paramOf returns the default (none) for an absent year: require it.
      (b) => paramOf("layers", "sentinel1", "year", b.year ?? null),
      noDates
    )
  );
  app.post("/api/series/modis", route("series/modis", TTL.series, (b) => nonDefault("charts", "modis", b, ["index"]), (p, g, x) => modisSeries(g, p.start, p.end, x.index)));
  // "@cloud" versions the cache key of the two series whose points gained `cloud`, so answers stored without it
  // are not served; their URLs, bodies and every other endpoint's key are unchanged.
  app.post("/api/series/landsat", route("series/landsat@cloud", TTL.series, seriesExtras("landsat-series"), (p, g, x) => landsatSeries(g, p.start, p.end, x.index, x.formula)));
  app.post("/api/series/sentinel2", route("series/sentinel2@cloud", TTL.series, seriesExtras("sentinel2-series"), (p, g, x) => sentinel2Series(g, p.start, p.end, x.index, x.formula)));
  app.post("/api/series/hls", route("series/hls", TTL.series, seriesExtras("hls-series"), (p, g, x) => hlsSeries(g, p.start, p.end, x.index, x.formula)));
  app.post("/api/series/sentinel1", route("series/sentinel1", TTL.series, (b) => nonDefault("charts", "sentinel1-series", b, ["band"]), (p, g, x) => sentinel1Series(g, p.start, p.end, x.band)));
  app.post("/api/series/precipitation", route("series/precipitation", TTL.series, null, (p, g) => precipitationSeries(g, p.start, p.end)));
  app.post(
    "/api/tiles/scene",
    route("tiles/scene", TTL.tiles, TILE_SOURCES["tiles/scene"].extrasOf, (p, g, x) => sceneTiles(g, p.start, p.end, x.sensor, x.timeStart), null, noDates)
  );
  // NDVI(right) - NDVI(left). The plot's dates stay in the key: a last-12-months Sentinel-2 side depends on `end`.
  app.post(
    "/api/tiles/difference",
    route("tiles/difference", TTL.tiles, differenceExtras, async (p, g, x) => {
      const images = await Promise.all([x.left, x.right].map(({ path, ...extras }) => TILE_SOURCES[path].image(p, g, extras)));
      return differenceTiles(...images);
    })
  );
  app.post("/api/ccdc", route("ccdc", TTL.series, validateCcdcRequest, (p, g, x) => ccdcSeries(g, p.start, p.end, x.band)));
}

module.exports = { registerRoutes, plotRoute, TTL };
