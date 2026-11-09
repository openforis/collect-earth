// Which answers say where a plot is (recommendation 3 of the data review): for forest inventories the plots' exact
// places are often confidential, so the downloads can leave them out ("without plot locations"). A summary key is a
// position when it is a coordinate attribute (collect_coord_...), or when a word of its name says latitude, longitude,
// coordinates, easting or northing (a plot file's column, e.g. collect_real_latitude, collect_text_plot_lon). Words, not
// letters: "translation" or "colony" are not positions.
const POSITION_WORDS = new Set(['lat', 'latitude', 'lon', 'lng', 'longitude', 'coord', 'coords', 'coordinate', 'coordinates', 'easting', 'northing', 'utm', 'xcoord', 'ycoord', 'geometry', 'wkt']);

/** Whether the answer of a summary key (or of an analysis column's key) is a place. */
export function isPositionKey(key: string): boolean {
  if (/^collect_coord_/.test(key)) return true;
  // The attribute's own name: after collect_<type>_ and, in a multiple entity, after the last "."
  const name = key.replace(/^.*\]\./, '').replace(/^collect_[a-z]+_/, '');
  return name.split(/[^A-Za-z0-9]+|_/).some((word) => POSITION_WORDS.has(word.toLowerCase()));
}

/** `?coordinates=none` of a download: leave the positions out. */
export function withoutPositions(query: unknown): boolean {
  return (query as { coordinates?: unknown } | null)?.coordinates === 'none';
}
