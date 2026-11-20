const { getTileUrl } = require("./promise");
const { differenceLabel } = require("../lib/labels");

/** Brown (loss) through near-white to teal (gain): ColorBrewer BrBG, safe for colour-blind readers. */
const DIFFERENCE_VIZ = { min: -0.4, max: 0.4, palette: ["8c510a", "d8b365", "f5f5f5", "5ab4ac", "01665e"] };

/**
 * Tile URL for NDVI(right) - NDVI(left), each side as an image function returns it (`image`, `label`,
 * optional `nirRed` band names, default nir/red). A pixel masked on either side stays masked.
 */
async function differenceTiles(left, right) {
  const ndvi = (side) => side.image.normalizedDifference(side.nirRed || ["nir", "red"]);
  const tileUrl = await getTileUrl(ndvi(right).subtract(ndvi(left)).visualize(DIFFERENCE_VIZ));
  return { tileUrl, label: differenceLabel(left.label, right.label) };
}

module.exports = { differenceTiles, DIFFERENCE_VIZ };
