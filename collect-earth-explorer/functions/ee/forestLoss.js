const { ee } = require("./auth");
const { evaluate } = require("./promise");
const { shapeForestLoss } = require("../lib/forestLoss");

/** The newest Hansen Global Forest Change version (checked 2026-11): loss years 2001-2025, 0.00025 degree (~30 m). */
const HANSEN = "UMD/hansen/global_forest_change_2025_v1_13";
/** RADD (Sentinel-1, ~10 m): one image per region and weekly version; `Alert` 2 unconfirmed, 3 confirmed; `Date` YYDOY. */
const RADD = "projects/radar-wur/raddalert/v1";
/**
 * GLAD-L (Landsat, ~30 m): per year YY a `confYY` band (2 probable, 3 confirmed) and `alertDateYY` (day of year).
 * Each final collection holds its year (2023final also 2024, up to July); UpdResult, updated daily, holds 2025 on.
 */
const GLAD_FINALS = [["2019final", 19], ["2020final", 20], ["2021final", 21], ["2022final", 22], ["2023final", 23], ["2023final", 24]];
const GLAD_UPDATES = "projects/glad/alert/UpdResult";

/** `img` on the dataset's own grid: a reduction without a scale then runs at it. */
const onGrid = (img, projection) => img.reproject(projection);

/** Sum of pixel area (m²) over `plot` per value of `code`'s single band, at `projection` (the dataset's own grid). */
const areaByCode = (code, plot, projection) =>
  onGrid(ee.Image.pixelArea().addBands(code), projection).reduceRegion({ reducer: ee.Reducer.sum().group({ groupField: 1, groupName: "code" }), geometry: plot, maxPixels: 1e9 }).get("groups");

function hansen(plot) {
  const h = ee.Image(HANSEN);
  const projection = h.select("lossyear").projection();
  const lossyear = h.select("lossyear");
  return evaluate(
    ee.Dictionary({
      plotHa: plot.area(1).divide(1e4),
      treeCover2000: onGrid(h.select("treecover2000"), projection).reduceRegion({ reducer: ee.Reducer.mean(), geometry: plot, maxPixels: 1e9 }).get("treecover2000"),
      loss: areaByCode(lossyear.updateMask(lossyear.gt(0)), plot, projection),
    })
  );
}

/** The newest version of each RADD region the plot touches; none outside RADD's area. */
function radd(plot) {
  const regions = ee.ImageCollection(RADD).filter(ee.Filter.eq("layer", "alerts")).filterBounds(plot);
  const latest = ee.ImageCollection(regions.aggregate_array("geography").distinct().map((g) => regions.filter(ee.Filter.eq("geography", g)).sort("version_date", false).first()));
  const img = latest.mosaic();
  const code = img.select("Date").multiply(10).add(img.select("Alert")).toInt();
  const covered = regions.size().gt(0);
  return evaluate(ee.Dictionary({ covered, groups: ee.Algorithms.If(covered, areaByCode(code, plot, latest.first().select("Alert").projection()), []) }));
}

/** One image per year YY (bands conf, date) from the collection's images that have that year, the newest on top. */
function gladYear(id, yy) {
  const c = ee.ImageCollection(id).filter(ee.Filter.listContains("system:band_names", `conf${yy}`));
  return ee.Algorithms.If(c.size().gt(0), c.select([`conf${yy}`, `alertDate${yy}`], ["conf", "date"]).sort("system:time_start").mosaic().set("yy", yy), null);
}

/** GLAD-L alerts of every year since 2019; covered when the newest year has data (0 = no alert) on the plot. */
function glad(plot, thisYear = new Date().getUTCFullYear() % 100) {
  const updates = [];
  for (let yy = 25; yy <= thisYear; yy++) updates.push(gladYear(GLAD_UPDATES, yy));
  const years = ee.List([...GLAD_FINALS.map(([name, yy]) => gladYear(`projects/glad/alert/${name}`, yy)), ...updates]).removeAll([null]);
  // A mosaic has no native grid of its own: GLAD-L's is 0.00025 degree, aligned on whole degrees (as Hansen's).
  const projection = ee.Projection("EPSG:4326", [0.00025, 0, 0, 0, -0.00025, 0]);
  const groups = years.map((y) => {
    const img = ee.Image(y);
    const conf = img.select("conf");
    // YYDOY * 10 + confidence, as RADD's.
    const code = img.select("date").add(ee.Number(img.get("yy")).multiply(1000)).multiply(10).add(conf).toInt();
    return areaByCode(code.updateMask(conf.gte(2).and(img.select("date").gt(0))), plot, projection);
  });
  const newest = onGrid(ee.Image(years.get(-1)).select("conf"), projection).reduceRegion({ reducer: ee.Reducer.count(), geometry: plot, maxPixels: 1e9 }).get("conf");
  return evaluate(ee.Dictionary({ covered: ee.Number(newest).gt(0), groups: groups.flatten() }));
}

/**
 * Forest loss on `plot`, whatever the dates: Hansen's tree cover in 2000 (mean %), yearly loss, and the RADD and GLAD-L
 * alerts with whether each system covers the plot. One evaluation per dataset, in parallel; areas from pixel areas on
 * each dataset's own grid, alert pixels grouped by date and confidence on the server.
 */
async function forestLoss(plot) {
  const [h, r, g] = await Promise.all([hansen(plot), radd(plot), glad(plot)]);
  return shapeForestLoss({ ...h, radd: { covered: Boolean(r.covered), groups: r.groups }, glad: { covered: Boolean(g.covered), groups: g.groups } });
}

module.exports = { forestLoss };
