/**
 * Landsat Collection 2 QA_PIXEL bit meanings (same layout for L4-5 TM, L7
 * ETM+ and L8-9 OLI): bit 0 fill, bit 1 dilated cloud, bit 2 cirrus (OLI
 * only), bit 3 cloud, bit 4 cloud shadow, bit 5 snow, bit 6 clear, bit 7
 * water. Pure, no Earth Engine dependency.
 *
 * The GEE scripts this app ports (charts_v2 maskLandsatSR and the CCDC
 * uiChart) tested bits 3 and 5 with Collection 1 pixel_qa meanings in mind
 * (shadow and cloud), which in Collection 2 are cloud and snow: they let cloud
 * shadow through and dropped snow by mistake. Collection 2 is masked here on
 * dilated cloud, cloud, cloud shadow and snow.
 */
const DILATED_CLOUD = 1;
const CLOUD = 3;
const CLOUD_SHADOW = 4;
const SNOW = 5;

/** Bitmask of the QA_PIXEL bits that must all be zero for a Landsat C2 pixel to count as clear (= 58). */
function landsatClearMaskBits() {
  return (1 << DILATED_CLOUD) | (1 << CLOUD) | (1 << CLOUD_SHADOW) | (1 << SNOW);
}

module.exports = { landsatClearMaskBits };
