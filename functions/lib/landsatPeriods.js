/**
 * Pure date-window logic for the merged Landsat collection (port of charts_v2
 * getMergedLandsat). Dates are zero-padded "YYYY-MM-DD" strings, which compare
 * correctly as strings. No Earth Engine dependency so it can be unit tested.
 */
const L7_THRESHOLD = "2015-01-01"; // L7 used before, L8 after (same cut as charts_v2)
const L5_THRESHOLD = "1999-12-31";
const L9_START = "2023-11-01";
/** Landsat 7 launch; charts_v2 has no lower bound and so requests an empty L7 window for pre-1999 ranges. */
const L7_START = "1999-04-15";

const COLLECTIONS = {
  L5: "LANDSAT/LT05/C02/T1_L2",
  L7: "LANDSAT/LE07/C02/T1_L2",
  L8: "LANDSAT/LC08/C02/T1_L2",
  L9: "LANDSAT/LC09/C02/T1_L2",
};

/** Sensors whose OLI bands are harmonised to ETM+ (Roy et al. 2016). */
const HARMONIZED = { L5: false, L7: false, L8: true, L9: true };

const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);

/**
 * The [start, end) windows, one per sensor in chronological sensor order
 * (L5, L7, L8, L9), that mergedLandsat requests for the requested range.
 * Returns [] when start >= end. Windows may overlap (L5/L7 in 1999, L8/L9
 * from 2023-11-01), as in charts_v2.
 *
 * Differences from charts_v2: the L9 window is clipped to max(start, L9_START)
 * so a request for 2024 does not also pull late-2023 scenes, the L7 window is
 * clipped to L7_START, and a window that would be empty is left out instead of
 * being requested as an empty collection.
 */
function landsatPeriods(start, end) {
  const candidates = [
    { sensor: "L5", start, end: min(end, L5_THRESHOLD) },
    { sensor: "L7", start: max(start, L7_START), end: min(end, L7_THRESHOLD) },
    { sensor: "L8", start: max(start, L7_THRESHOLD), end },
    { sensor: "L9", start: max(start, L9_START), end },
  ];
  return candidates.filter((p) => p.start < p.end);
}

module.exports = { landsatPeriods, COLLECTIONS, HARMONIZED, L7_THRESHOLD, L5_THRESHOLD, L9_START, L7_START };
