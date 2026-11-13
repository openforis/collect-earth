/**
 * Landsat Collection 2 Level 2 sensors used for yearly composites. Bands listed
 * as `falseColour` are [nir, swir, red] in that order for each sensor.
 */
const SENSORS = {
  L5: { collection: "LANDSAT/LT05/C02/T1_L2", falseColour: ["SR_B4", "SR_B5", "SR_B3"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 5" },
  L7: { collection: "LANDSAT/LE07/C02/T1_L2", falseColour: ["SR_B4", "SR_B5", "SR_B3"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 7" },
  L8: { collection: "LANDSAT/LC08/C02/T1_L2", falseColour: ["SR_B5", "SR_B6", "SR_B4"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 8" },
  L9: { collection: "LANDSAT/LC09/C02/T1_L2", falseColour: ["SR_B5", "SR_B6", "SR_B4"], cloudProperty: "CLOUD_COVER_LAND", name: "Landsat 9" },
};

const MIN_YEAR = 1984;

/**
 * Sensor ids used for the yearly composite of `year`; throws a 400 for
 * non-integers and years before 1984 or after `maxYear` (the current UTC year
 * by default; injectable for tests).
 */
function sensorsForYear(year, maxYear = new Date().getUTCFullYear()) {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > maxYear) {
    throw Object.assign(new Error(`year must be an integer between ${MIN_YEAR} and ${maxYear}`), { status: 400, code: "bad_request" });
  }
  if (year < 1999) return ["L5"];
  if (year < 2013) return ["L7"];
  if (year < 2022) return ["L8"];
  return ["L8", "L9"];
}

module.exports = { SENSORS, MIN_YEAR, sensorsForYear };
