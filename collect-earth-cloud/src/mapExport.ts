// The collected data as map files (GeoJSON, KML, a zipped shapefile): the export's rows
// (recordsTable) with each record's plot drawn as Collect Earth draws it.
import { csvField, type RecordsTable } from './export.js';
import { outlineRing, type PlotOutline } from './plotShape.js';
import { dbfFieldNames, MAX_DBF_FIELDS, oriented, WGS84_PRJ, writeDbf, writeShp, type Geometry } from './shapefile.js';

export type MapFormat = 'geojson' | 'kml' | 'shp';

/** A plot's shape (a polygon, counterclockwise as GeoJSON wants), its place when the shape is unknown, null when it has no place. */
export function plotGeometry(place: readonly [number, number] | undefined, outline: PlotOutline): Geometry {
  if (!place) return null;
  const ring = outlineRing(place[0], place[1], outline);
  return ring ? { type: 'Polygon', coordinates: [oriented(ring, true)] } : { type: 'Point', coordinates: [place[1], place[0]] };
}

/** Each row's geometry: its plot's (the `plot` column) in `places` (plot -> [lat, lon]). */
export function rowGeometries(table: RecordsTable, places: ReadonlyMap<string, readonly [number, number]>, outline: PlotOutline): Geometry[] {
  const plot = table.columns.indexOf('plot');
  return table.rows.map((row) => plotGeometry(places.get(row[plot]), outline));
}

/** RFC 7946 GeoJSON: one feature per row, its columns as properties. */
export function geojsonOf(table: RecordsTable, geometries: readonly Geometry[]): string {
  const features = table.rows.map((row, i) => ({
    type: 'Feature',
    properties: Object.fromEntries(table.columns.map((c, j) => [c, row[j]])),
    geometry: geometries[i],
  }));
  return JSON.stringify({ type: 'FeatureCollection', features });
}

/** Text fit for XML 1.0: the characters it cannot hold dropped, the five special ones escaped. */
function xml(text: string): string {
  return text
    .replace(/[^\t\n\r\x20-퟿-�\u{10000}-\u{10ffff}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const coordinates = (ring: readonly (readonly [number, number])[]) => ring.map(([x, y]) => `${x},${y}`).join(' ');

/** KML 2.2: a placemark per row, named by its plot, its columns as ExtendedData. */
export function kmlOf(table: RecordsTable, geometries: readonly Geometry[], name: string): string {
  const plot = table.columns.indexOf('plot');
  const placemarks = table.rows.map((row, i) => {
    const data = table.columns.map((c, j) => `<Data name="${xml(c)}"><value>${xml(row[j])}</value></Data>`).join('');
    const g = geometries[i];
    const shape = !g
      ? ''
      : g.type === 'Point'
        ? `<Point><coordinates>${coordinates([g.coordinates])}</coordinates></Point>`
        : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates(g.coordinates[0])}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    return `<Placemark><name>${xml(row[plot])}</name><ExtendedData>${data}</ExtendedData>${shape}</Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(name)}</name>\n${placemarks.join('\n')}\n</Document></kml>\n`;
}

/**
 * The files of a shapefile named `base` (.shp, .shx, .dbf, .prj in WGS84, .cpg saying the .dbf is
 * UTF-8) and `fields.csv`: which DBF field holds which column (field names are at most 10 characters).
 */
export function shapefileOf(table: RecordsTable, geometries: readonly Geometry[], base: string, date: Date): Map<string, Uint8Array> {
  // shortcut: a DBF holds 255 fields, so columns past those are left out (listed without a field in fields.csv); a wider table would need a second file.
  const names = dbfFieldNames(table.columns.slice(0, MAX_DBF_FIELDS));
  const { shp, shx } = writeShp(geometries);
  const mapping = ['field,column', ...table.columns.map((c, i) => `${csvField(names[i] ?? '')},${csvField(c)}`)].join('\r\n');
  return new Map<string, Uint8Array>([
    [`${base}.shp`, shp],
    [`${base}.shx`, shx],
    [`${base}.dbf`, writeDbf(names, table.rows, date)],
    [`${base}.prj`, Buffer.from(WGS84_PRJ)],
    [`${base}.cpg`, Buffer.from('UTF-8')],
    ['fields.csv', Buffer.from(`${mapping}\r\n`)],
  ]);
}
