const { ee } = require("./auth");
const { getTileUrl, evaluate } = require("./promise");
const { mergedLandsat } = require("./landsat");
const { LANDSAT_VIZ } = require("./landsatComposite");
const { sentinel2SceneCollection, SENTINEL_FALSE_COLOUR } = require("./sentinel2");
const { BadRequest } = require("../lib/plotRequest");
const { notFoundIfEmpty } = require("../lib/errors");

/** Request sensor names (not the Landsat sensor table of lib/sensors.js). */
const SCENE_SENSORS = ["landsat", "sentinel2"];

/**
 * Pure validation of the scene request fields. `timeStart` is epoch
 * milliseconds and may arrive as a numeric string; it is coerced with Number.
 * Throws BadRequest (400) so the route can answer before touching Earth Engine.
 */
function validateSceneRequest(body) {
  const { sensor, timeStart } = body || {};
  if (!SCENE_SENSORS.includes(sensor)) throw new BadRequest(`sensor must be ${SCENE_SENSORS.join(" or ")}`);
  const ms = typeof timeStart === "string" && timeStart.trim() === "" ? NaN : Number(timeStart);
  if (!Number.isFinite(ms)) throw new BadRequest("timeStart (ms since epoch) is required");
  return { sensor, timeStart: ms };
}

/**
 * Tile URL for one false-colour scene identified by its system:time_start, as
 * returned in the NDVI series: an unmasked Landsat scene from the merged
 * collection in [start, end), or the Sentinel-2 scene (SR when available).
 * Rejects with a 404 not_found when no scene has that system:time_start, so
 * getMap is never asked to visualise an empty first().
 */
async function sceneTiles(plot, start, end, sensor, timeStart) {
  const v = validateSceneRequest({ sensor, timeStart });
  const iso = new Date(v.timeStart).toISOString();
  const date = iso.slice(0, 10);
  let collection;
  let viz;
  let label;
  if (v.sensor === "landsat") {
    collection = mergedLandsat(plot, start, end, false).filter(ee.Filter.equals("system:time_start", v.timeStart));
    viz = LANDSAT_VIZ;
    label = `Landsat ${date}`;
  } else {
    collection = sentinel2SceneCollection(plot, v.timeStart);
    viz = SENTINEL_FALSE_COLOUR;
    label = `Sentinel-2 ${date}`;
  }
  notFoundIfEmpty(await evaluate(collection.size()), `no ${v.sensor} scene at ${iso}`);
  const image = ee.Image(collection.first()).visualize(viz);
  return { tileUrl: await getTileUrl(image), label, sensor: v.sensor };
}

module.exports = { sceneTiles, validateSceneRequest };
