const { ee } = require("./auth");
const { getTileUrl } = require("./promise");
const { SENSORS, sensorsForYear } = require("../lib/sensors");
const { maskAndScale } = require("./landsat");

/** Scenes with more cloud over land than this (percent) are dropped before compositing. */
const MAX_CLOUD_COVER = 50;
const COMPOSITE_BANDS = ["nir", "swir", "red"];
const LANDSAT_VIZ = { bands: COMPOSITE_BANDS, min: 0, max: 0.3 };

/** One sensor's masked, scaled scenes over `plot` in `year`, with bands renamed to nir/swir/red. */
function sensorImages(id, plot, year) {
  const s = SENSORS[id];
  return ee.ImageCollection(s.collection)
    .filterBounds(plot)
    .filterDate(`${year}-01-01`, `${year + 1}-01-01`)
    .filter(ee.Filter.lt(s.cloudProperty, MAX_CLOUD_COVER))
    .map(maskAndScale)
    .select(s.falseColour, COMPOSITE_BANDS);
}

/**
 * Median of every sensor flying in `year` (port of getImageForCollection's default branch).
 * Returns the unvisualised image plus the sensor names so callers and tests can inspect it.
 */
function buildYearlyComposite(plot, year) {
  const ids = sensorsForYear(year);
  const cols = ids.map((id) => sensorImages(id, plot, year));
  const merged = cols.slice(1).reduce((acc, c) => acc.merge(c), cols[0]);
  return { image: merged.median(), sensorNames: ids.map((id) => SENSORS[id].name) };
}

/** Tile URL for the false-colour yearly Landsat composite. */
async function landsatCompositeTiles(plot, year) {
  const { image, sensorNames } = buildYearlyComposite(plot, year);
  const tileUrl = await getTileUrl(image.visualize(LANDSAT_VIZ));
  return { tileUrl, sensor: sensorNames.join(" + "), label: `${sensorNames.join("/")} ${year} composite` };
}

module.exports = { landsatCompositeTiles, buildYearlyComposite, sensorImages, LANDSAT_VIZ, MAX_CLOUD_COVER };
