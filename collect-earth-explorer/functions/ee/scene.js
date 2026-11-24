const { ee } = require("./auth");
const { getTileUrl, evaluate } = require("./promise");
const { landsatSceneCollection } = require("./landsat");
const { LANDSAT_VIZ } = require("./landsatComposite");
const { sentinel2SceneCollection, SENTINEL_FALSE_COLOUR } = require("./sentinel2");
const { hlsSceneCollection, HLS_FALSE_COLOUR } = require("./hls");
const { BadRequest } = require("../lib/plotRequest");
const { notFoundIfEmpty } = require("../lib/errors");

/** Per request sensor (not the Landsat sensor table of lib/sensors.js): the scenes at an instant, their visualisation, label prefix and near-infrared/red band names. */
const SCENES = {
  landsat: { collection: landsatSceneCollection, viz: LANDSAT_VIZ, name: "Landsat", nirRed: ["nir", "red"] },
  // The Sentinel-2 scene keeps the product's band names.
  sentinel2: { collection: sentinel2SceneCollection, viz: SENTINEL_FALSE_COLOUR, name: "Sentinel-2", nirRed: ["B8", "B4"] },
  hls: { collection: hlsSceneCollection, viz: HLS_FALSE_COLOUR, name: "HLS", nirRed: ["nir", "red"] },
};
const SCENE_SENSORS = Object.keys(SCENES);

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
 * returned in the NDVI series or the CCDC observed points: an unmasked Landsat
 * scene from any Landsat sensor (no per-sensor date windows, since the CCDC
 * collection has none: see landsatSceneCollection), the Sentinel-2 scene
 * (SR when available) or the HLS L30 or S30 scene. `start` and `end` are not used for the lookup: the
 * scene is identified by its instant alone. Rejects with a 404 not_found when
 * no scene has that system:time_start, so getMap is never asked to visualise
 * an empty first().
 */
async function sceneTiles(plot, start, end, sensor, timeStart) {
  const { image, viz, label } = await sceneImage(plot, sensor, timeStart);
  return { tileUrl: await getTileUrl(image.visualize(viz)), label, sensor };
}

/**
 * The unvisualised scene sceneTiles shows, its visualisation and label, and `nirRed`, the names of its
 * near-infrared and red bands. 404 as sceneTiles.
 */
async function sceneImage(plot, sensor, timeStart) {
  const v = validateSceneRequest({ sensor, timeStart });
  const iso = new Date(v.timeStart).toISOString();
  const date = iso.slice(0, 10);
  const { collection, viz, name, nirRed } = SCENES[v.sensor];
  const scenes = collection(plot, v.timeStart);
  notFoundIfEmpty(await evaluate(scenes.size()), `no ${v.sensor} scene at ${iso}`);
  return { image: ee.Image(scenes.first()), viz, label: `${name} ${date}`, nirRed };
}

module.exports = { sceneTiles, sceneImage, validateSceneRequest };
