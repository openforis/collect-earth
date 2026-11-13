/** Web Mercator (OSM slippy map) tile indices containing lon/lat at zoom z. */
function tileXY(lon, lat, z) {
  const n = 2 ** z;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x, y };
}

module.exports = { tileXY };
