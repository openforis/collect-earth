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

/**
 * Builds a POST handler: parse body, run the optional `validate(body)` hook, auth EE,
 * then run `compute(parsed, eeGeometry, body)`. `validate` runs before eeAuth so that
 * request errors are answered without touching Earth Engine.
 */
function plotRoute(compute, validate) {
  return asyncHandler(async (req, res) => {
    const parsed = parsePlotRequest(req.body);
    if (validate) validate(req.body);
    await eeAuth();
    const geometry = ee.Geometry(parsed.plot);
    res.json(await compute(parsed, geometry, req.body));
  });
}

function registerRoutes(app) {
  app.post("/api/tiles/sentinel2", plotRoute((p, g) => sentinel2CompositeTiles(g, p.end)));
  app.post(
    "/api/tiles/landsat",
    plotRoute((p, g, body) => landsatCompositeTiles(g, Number(body.year)), (body) => sensorsForYear(Number(body.year)))
  );
  app.post("/api/series/modis", plotRoute((p, g) => modisSeries(g, p.start, p.end)));
  app.post("/api/series/landsat", plotRoute((p, g) => landsatSeries(g, p.start, p.end)));
  app.post("/api/series/sentinel2", plotRoute((p, g) => sentinel2Series(g, p.start, p.end)));
  app.post(
    "/api/tiles/scene",
    plotRoute((p, g, body) => {
      const { sensor, timeStart } = validateSceneRequest(body);
      return sceneTiles(g, p.start, p.end, sensor, timeStart);
    }, validateSceneRequest)
  );
}

module.exports = { registerRoutes, plotRoute };
