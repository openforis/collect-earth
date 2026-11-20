// The tile endpoints' labels. Answers are cached and the web app recognises these forms (web/src/lib/api.ts tileLabel,
// checked against test/tileLabels.json): never change the wording.

const landsatCompositeLabel = (sensorNames, year) => `${sensorNames.join("/")} ${year} composite`;
const sentinel2CompositeLabel = (start, end) => `Sentinel-2 composite ${start} to ${end}`;
const sentinel1CompositeLabel = (year) => `Sentinel-1 ${year} radar composite`;
const differenceLabel = (left, right) => `NDVI change: ${left} → ${right}`;

module.exports = { landsatCompositeLabel, sentinel2CompositeLabel, sentinel1CompositeLabel, differenceLabel };
