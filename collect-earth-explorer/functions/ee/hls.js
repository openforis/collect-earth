const { ee } = require("./auth");
const { indexImage, formulaOf } = require("./indices");
const { meanSeries, evaluateSeries } = require("./series");
const { sentinelWindow } = require("./sentinel2Series");
const { hlsClearMaskBits } = require("../lib/qaBits");
const { hlsTilePrefixes } = require("../lib/hlsTiles");

/** First day of NASA/HLS/HLSL30/v002 (HLSS30 starts 2015-11-28). */
const HLS_START = "2013-04-11";

/**
 * The two HLS v2 collections, 30 m surface reflectance already scaled to 0..1, with the bands of the formula names
 * (catalogue.json bands["hls-series"]) and the label of their points.
 */
const HLS_COLLECTIONS = [
  { id: "NASA/HLS/HLSL30/v002", sensor: "HLS L30", bands: ["B2", "B3", "B4", "B5", "B6", "B7"] },
  { id: "NASA/HLS/HLSS30/v002", sensor: "HLS S30", bands: ["B2", "B3", "B4", "B8A", "B11", "B12"] },
];
const NAMES = ["blue", "green", "red", "nir", "swir1", "swir2"];
const HLS_BANDS = Object.fromEntries(NAMES.map((n) => [n, n]));
const CLEAR_MASK = hlsClearMaskBits();

/**
 * The scenes of both collections passing `filter`, bands renamed to NAMES, each carrying `sensor` and its
 * CLOUD_COVERAGE (percent of the tile) as `cloud`; cloud-masked with Fmask when `mask`.
 */
function hlsImages(filter, mask) {
  const parts = HLS_COLLECTIONS.map(({ id, sensor, bands }) =>
    ee.ImageCollection(id).filter(filter).map((img) => {
      const renamed = img.select(bands, NAMES);
      const out = mask ? renamed.updateMask(img.select("Fmask").bitwiseAnd(CLEAR_MASK).eq(0)) : renamed;
      return out.set({ sensor, cloud: img.get("CLOUD_COVERAGE") }); // select and updateMask keep the properties
    })
  );
  return parts[0].merge(parts[1]);
}

/**
 * Per-scene mean of the named `index` (catalogue.json "indices"), or of `formula`, at 30 m over `plot` from
 * Fmask-masked HLS L30 and S30 scenes in [start, end). Each point carries `sensor` ("HLS L30" or "HLS S30") and `cloud`.
 * A range entirely before HLS_START yields no points without an Earth Engine round trip.
 */
async function hlsSeries(plot, start, end, index = "NDVI", formula = formulaOf(index)) {
  const w = sentinelWindow(start, end, HLS_START);
  if (!w) return { points: [] };
  // plot is built from GeoJSON, so toGeoJSON() is client-side; see lib/hlsTiles.js for why the tiles are filtered.
  const tiles = ee.Filter.or(...hlsTilePrefixes(plot.toGeoJSON().coordinates[0][0][0]).map((t) => ee.Filter.stringStartsWith("system:index", t)));
  const col = hlsImages(ee.Filter.and(ee.Filter.date(w.start, w.end), ee.Filter.bounds(plot), tiles), true)
    .map((img) => indexImage(img, formula, HLS_BANDS).set({ sensor: img.get("sensor"), cloud: img.get("cloud") }));
  const points = await evaluateSeries(meanSeries(col, "index", plot, 30, (img) => ({ sensor: img.get("sensor"), cloud: img.get("cloud") })));
  return { points };
}

/** The unmasked HLS scenes with exactly this system:time_start over the plot (1 ms date window first, as sentinel2SceneCollection). */
function hlsSceneCollection(plot, timeStart) {
  return hlsImages(ee.Filter.and(ee.Filter.bounds(plot), ee.Filter.date(timeStart, timeStart + 1), ee.Filter.equals("system:time_start", timeStart)), false);
}

/** False colour of the 0..1 reflectance, the Landsat scene's stretch. */
const HLS_FALSE_COLOUR = { bands: ["nir", "swir1", "red"], min: 0, max: 0.3, gamma: [1.3, 1.3, 1.3] };

module.exports = { hlsSeries, hlsSceneCollection, HLS_FALSE_COLOUR, HLS_START };
