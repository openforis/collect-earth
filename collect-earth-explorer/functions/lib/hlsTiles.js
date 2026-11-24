/**
 * The system:index prefixes ("T" + UTM zone of the MGRS tile) of the HLS tiles that can cover a plot at
 * longitude `lon`: its zone and both neighbours (tiles overlap zone edges). HLSS30 tiles crossing the
 * antimeridian (zones 01 and 60) have world-wide footprints and pass any bounds filter, enough to exceed Earth
 * Engine's 5000-element limit over a decade, so the series keeps only these prefixes. Pure.
 */
function hlsTilePrefixes(lon) {
  const zone = Math.min(Math.floor((lon + 180) / 6), 59); // 0..59
  return [-1, 0, 1].map((d) => `T${String(((zone + d + 60) % 60) + 1).padStart(2, "0")}`);
}

module.exports = { hlsTilePrefixes };
