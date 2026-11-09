// ESRI shapefiles (the 1998 technical description) and their dBASE III attribute tables, written by
// hand: points or polygons in WGS84, every attribute a character field.

/** A point or polygon in longitude/latitude, as GeoJSON has them (rings closed, the outer first); null: no shape. */
export type Geometry = { type: 'Point'; coordinates: [number, number] } | { type: 'Polygon'; coordinates: [number, number][][] } | null;

/** WGS84, as ESRI writes it in a .prj. */
export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

const NULL_SHAPE = 0;
const POINT = 1;
const POLYGON = 5;
/** dBASE: at most 255 fields, each at most 254 bytes. */
export const MAX_DBF_FIELDS = 255;
const MAX_FIELD_BYTES = 254;

/** Twice the signed area of a ring (shoelace): positive when counterclockwise. */
export function signedArea2(ring: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum;
}

/** The ring turning the way asked (counterclockwise or not). */
export function oriented(ring: [number, number][], counterclockwise: boolean): [number, number][] {
  return signedArea2(ring) > 0 === counterclockwise ? ring : [...ring].reverse();
}

/**
 * DBF field names for columns: at most 10 characters of A-Z a-z 0-9 _, starting with a letter,
 * unique without regard to case. Collect Earth's `collect_<type>_` prefix of answers is left out
 * (else they would all start "collect_co"); a name taken gets `_1`, `_2`... in place of its end.
 */
export function dbfFieldNames(columns: readonly string[]): string[] {
  const used = new Set<string>();
  return columns.map((column) => {
    let base = column.replace(/^collect_[a-z]+_/, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z]/.test(base)) base = `F${base}`;
    base = base.slice(0, 10);
    let name = base;
    for (let n = 1; used.has(name.toUpperCase()); n++) name = base.slice(0, 10 - `_${n}`.length) + `_${n}`;
    used.add(name.toUpperCase());
    return name;
  });
}

/** The first bytes of text's UTF-8 that fit in `max`, a character never cut in two. */
function utf8Within(text: string, max: number): Buffer {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= max) return bytes;
  let end = max;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

/** A dBASE III table of character fields (UTF-8, said by the .cpg), `names` from dbfFieldNames. */
export function writeDbf(names: readonly string[], rows: readonly (readonly string[])[], date: Date): Buffer {
  const values = rows.map((row) => names.map((_, i) => utf8Within(row[i] ?? '', MAX_FIELD_BYTES)));
  const lengths = names.map((_, i) => Math.max(1, ...values.map((v) => v[i].length)));
  const headerLength = 32 + 32 * names.length + 1;
  const recordLength = 1 + lengths.reduce((a, b) => a + b, 0);
  const out = Buffer.alloc(headerLength + recordLength * rows.length + 1, 0x20);
  out.fill(0, 0, headerLength);
  out[0] = 0x03;
  out[1] = date.getUTCFullYear() - 1900;
  out[2] = date.getUTCMonth() + 1;
  out[3] = date.getUTCDate();
  out.writeUInt32LE(rows.length, 4);
  out.writeUInt16LE(headerLength, 8);
  out.writeUInt16LE(recordLength, 10);
  names.forEach((name, i) => {
    const at = 32 + 32 * i;
    out.write(name, at, 10, 'latin1');
    out[at + 11] = 0x43; // 'C': character
    out[at + 16] = lengths[i];
  });
  out[headerLength - 1] = 0x0d;
  let at = headerLength;
  for (const row of values) {
    at += 1; // ' ': not deleted
    row.forEach((v, i) => {
      v.copy(out, at);
      at += lengths[i];
    });
  }
  out[at] = 0x1a;
  return out;
}

/** A .shp's polygons: each record's rings as [x, y] points (null: a null shape). Only polygon shapefiles (5; 15 and 25 read without Z and M). */
export function readShpPolygons(shp: Buffer): ([number, number][][] | null)[] {
  if (shp.length < 100 || shp.readInt32BE(0) !== 9994) throw new Error('not a shapefile (.shp)');
  const type = shp.readInt32LE(32);
  if (type !== 5 && type !== 15 && type !== 25) throw new Error(`the shapefile holds shapes of type ${type}, not polygons`);
  const out: ([number, number][][] | null)[] = [];
  let at = 100;
  while (at + 12 <= shp.length) {
    const end = at + 8 + shp.readInt32BE(at + 4) * 2;
    if (end > shp.length) throw new Error('the shapefile (.shp) is cut short');
    const c = at + 8;
    const shapeType = shp.readInt32LE(c);
    if (shapeType === NULL_SHAPE) {
      out.push(null);
    } else {
      if (shapeType !== type || c + 44 > end) throw new Error('the shapefile (.shp) is damaged');
      const parts = shp.readInt32LE(c + 36);
      const points = shp.readInt32LE(c + 40);
      if (parts < 0 || points < 0 || c + 44 + 4 * parts + 16 * points > end) throw new Error('the shapefile (.shp) is damaged');
      const starts = Array.from({ length: parts }, (_, i) => shp.readInt32LE(c + 44 + 4 * i));
      const p0 = c + 44 + 4 * parts;
      out.push(
        starts.map((start, i) => {
          const stop = i + 1 < parts ? starts[i + 1] : points;
          if (start < 0 || stop > points || start > stop) throw new Error('the shapefile (.shp) is damaged');
          return Array.from({ length: stop - start }, (_, k): [number, number] => [shp.readDoubleLE(p0 + 16 * (start + k)), shp.readDoubleLE(p0 + 16 * (start + k) + 8)]);
        }),
      );
    }
    at = end;
  }
  return out;
}

/** A .dbf's field names and records (values trimmed; UTF-8 when it is valid UTF-8, else Latin-1). Deleted records are kept, so records stay in step with the shapes. */
export function readDbf(dbf: Buffer): { fields: string[]; records: string[][] } {
  if (dbf.length < 33) throw new Error('the attribute table (.dbf) is cut short');
  const count = dbf.readUInt32LE(4);
  const headerLength = dbf.readUInt16LE(8);
  const recordLength = dbf.readUInt16LE(10);
  const fields: { name: string; length: number }[] = [];
  for (let at = 32; at + 32 <= headerLength && dbf[at] !== 0x0d; at += 32) {
    fields.push({ name: dbf.subarray(at, at + 11).toString('latin1').replace(/\0.*$/s, '').trim(), length: dbf[at + 16] });
  }
  if (headerLength + count * recordLength > dbf.length) throw new Error('the attribute table (.dbf) is cut short');
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const text = (bytes: Buffer) => {
    try {
      return utf8.decode(bytes).trim();
    } catch {
      return bytes.toString('latin1').trim();
    }
  };
  const records: string[][] = [];
  for (let r = 0; r < count; r++) {
    let at = headerLength + r * recordLength + 1;
    records.push(
      fields.map((f) => {
        const value = text(dbf.subarray(at, at + f.length));
        at += f.length;
        return value;
      }),
    );
  }
  return { fields: fields.map((f) => f.name), records };
}

/** The bytes of one shape's record content (shape type first). */
function shapeContent(g: Geometry): Buffer {
  if (!g) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(NULL_SHAPE, 0);
    return b;
  }
  if (g.type === 'Point') {
    const b = Buffer.alloc(20);
    b.writeInt32LE(POINT, 0);
    b.writeDoubleLE(g.coordinates[0], 4);
    b.writeDoubleLE(g.coordinates[1], 12);
    return b;
  }
  // The outer ring clockwise, holes counterclockwise (the shapefile's rule; GeoJSON's is the opposite).
  const rings = g.coordinates.map((ring, i) => oriented(ring, i > 0));
  const points = rings.flat();
  const b = Buffer.alloc(44 + 4 * rings.length + 16 * points.length);
  b.writeInt32LE(POLYGON, 0);
  const box = bboxOf([g]);
  box.forEach((v, i) => b.writeDoubleLE(v, 4 + 8 * i));
  b.writeInt32LE(rings.length, 36);
  b.writeInt32LE(points.length, 40);
  let start = 0;
  rings.forEach((ring, i) => {
    b.writeInt32LE(start, 44 + 4 * i);
    start += ring.length;
  });
  let at = 44 + 4 * rings.length;
  for (const [x, y] of points) {
    b.writeDoubleLE(x, at);
    b.writeDoubleLE(y, at + 8);
    at += 16;
  }
  return b;
}

/** [xmin, ymin, xmax, ymax] of the shapes (zeros when there is none). */
function bboxOf(geometries: readonly Geometry[]): [number, number, number, number] {
  const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geometries) {
    if (!g) continue;
    for (const [x, y] of g.type === 'Point' ? [g.coordinates] : g.coordinates.flat()) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
  }
  return Number.isFinite(box[0]) ? box : [0, 0, 0, 0];
}

/** The 100-byte header of a .shp or .shx. */
function mainHeader(fileBytes: number, shapeType: number, box: readonly number[]): Buffer {
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0);
  h.writeInt32BE(fileBytes / 2, 24); // in 16-bit words
  h.writeInt32LE(1000, 28);
  h.writeInt32LE(shapeType, 32);
  box.forEach((v, i) => h.writeDoubleLE(v, 36 + 8 * i));
  return h;
}

/**
 * The .shp and .shx of the shapes, one record each in order (null: a null shape). All points or all
 * polygons: one shapefile holds one type.
 */
export function writeShp(geometries: readonly Geometry[]): { shp: Buffer; shx: Buffer } {
  const kinds = new Set(geometries.flatMap((g) => (g ? [g.type] : [])));
  if (kinds.size > 1) throw new Error('writeShp: points and polygons in one shapefile');
  const shapeType = kinds.has('Polygon') ? POLYGON : kinds.has('Point') ? POINT : NULL_SHAPE;
  const box = bboxOf(geometries);
  const records: Buffer[] = [];
  const index = Buffer.alloc(8 * geometries.length);
  let offset = 100;
  geometries.forEach((g, i) => {
    const content = shapeContent(g);
    const header = Buffer.alloc(8);
    header.writeInt32BE(i + 1, 0);
    header.writeInt32BE(content.length / 2, 4);
    index.writeInt32BE(offset / 2, 8 * i);
    index.writeInt32BE(content.length / 2, 8 * i + 4);
    records.push(header, content);
    offset += 8 + content.length;
  });
  return {
    shp: Buffer.concat([mainHeader(offset, shapeType, box), ...records]),
    shx: Buffer.concat([mainHeader(100 + index.length, shapeType, box), index]),
  };
}
