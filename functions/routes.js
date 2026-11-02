const { asyncHandler } = require("./app");
const { parsePlotRequest } = require("./lib/plotRequest");
const { eeAuth, ee } = require("./ee/auth");
const { sentinel2CompositeTiles } = require("./ee/sentinel2Composite");

/** Builds a POST handler: parse body, auth EE, run `compute(parsed, eeGeometry, body)`. */
function plotRoute(compute) {
  return asyncHandler(async (req, res) => {
    const parsed = parsePlotRequest(req.body);
    await eeAuth();
    const geometry = ee.Geometry(parsed.plot);
    res.json(await compute(parsed, geometry, req.body));
  });
}

function registerRoutes(app) {
  app.post("/api/tiles/sentinel2", plotRoute((p, g) => sentinel2CompositeTiles(g, p.end)));
}

module.exports = { registerRoutes, plotRoute };
