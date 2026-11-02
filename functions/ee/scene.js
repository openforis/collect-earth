const { ee } = require("./auth");
const { getTileUrl } = require("./promise");
const { mergedLandsat } = require("./landsat");
const { LANDSAT_VIZ } = require("./landsatComposite");
const { sentinel2Scene, SENTINEL_FALSE_COLOUR } = require("./sentinel2");
const { BadRequest } = require("../lib/plotRequest");

const SENSORS = ["landsat", "sentinel2"];

/**
 * Pure validation of the scene request fields. `timeStart` is epoch
 * milliseconds and may arrive as a numeric string; it is coerced with Number.
 * Throws BadRequest (400) so the route can answer before touching Earth Engine.
 */
function validateSceneRequest(body) {
  const { sensor, timeStart } = body || {};
  if (!SENSORS.includes(sensor)) throw new BadRequest(`sensor must be ${SENSORS.join(" or ")}`);
  const ms = typeof timeStart === "string" && timeStart.trim() === "" ? NaN : Number(timeStart);
  if (!Number.isFinite(ms)) throw new BadRequest("timeStart (ms since epoch) is required");
  return { sensor, timeStart: ms };
}

/**
 * Tile URL for one false-colour scene identified by its system:time_start, as
 * returned in the NDVI series: an unmasked Landsat scene from the merged
 * collection in [start, end), or the Sentinel-2 scene (SR when available).
 */
async function sceneTiles(plot, start, end, sensor, timeStart) {
  const v = validateSceneRequest({ sensor, timeStart });
  const date = new Date(v.timeStart).toISOString().slice(0, 10);
  let image;
  let label;
  if (v.sensor === "landsat") {
    const scene = mergedLandsat(plot, start, end, false).filter(ee.Filter.equals("system:time_start", v.timeStart)).first();
    image = ee.Image(scene).visualize(LANDSAT_VIZ);
    label = `Landsat ${date}`;
  } else {
    image = sentinel2Scene(plot, v.timeStart).visualize(SENTINEL_FALSE_COLOUR);
    label = `Sentinel-2 ${date}`;
  }
  return { tileUrl: await getTileUrl(image), label, sensor: v.sensor };
}

module.exports = { sceneTiles, validateSceneRequest };
