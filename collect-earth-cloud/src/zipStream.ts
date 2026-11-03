// A zip written as it goes, with ZIP64 when it needs it: for downloads too large to build in
// memory (the Collect Earth backup, Task 17: 100,000 records are 100,001 entries, over the
// 65,535 a zip without ZIP64 can count).
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';

const deflateRaw = promisify(zlib.deflateRaw);

/** One file of the zip: its name (UTF-8, "/" between folders) and its bytes. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const U16 = 0xffff;
/**
 * Entries smaller than this are deflated on the main thread: a record of 17 KB takes about 0.1 ms
 * there and 0.2 ms through the thread pool (the hop costs more than it saves), and the stream asks
 * for one entry at a time, so other requests wait 0.1 ms at most. Larger ones go to the pool.
 */
const SYNC_LIMIT = 1 << 20;
const U32 = 0xffffffff;

/**
 * How long the stream works without letting other requests run: the deflating is synchronous, and
 * a consumer awaiting each chunk (Readable.from) never leaves the microtask queue on its own.
 */
const SLICE_MS = 10;

/** What the central directory needs of an entry already written. */
export interface Written {
  name: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
}

/**
 * Yields the bytes of a zip of `entries`, in their order, one entry at a time: only the entry
 * being written and the central directory (about 60 bytes an entry) are held. Each entry is
 * deflated (node:zlib, level 6; SYNC_LIMIT) or stored when that is not smaller, and its
 * sizes and CRC go in the local header (no data descriptors: the entry is in memory anyway).
 *
 * ZIP64 (APPNOTE 4.5.3, 4.3.14-16) only where the plain fields do not fit: an entry starting at
 * 4 GB or more gets a ZIP64 extra field with its offset in the central directory, and a zip of
 * 65,535 entries or more, or whose directory starts or ends past 4 GB, gets the ZIP64 end of
 * central directory record and its locator, the plain end record holding 0xFFFF / 0xFFFFFFFF in
 * the fields that overflow (as Info-ZIP and Python write them; java.util.zip reads them since
 * Java 7). One entry of 4 GB or more is refused (not needed: records are kilobytes).
 *
 * Every SLICE_MS of work it lets the event loop run (setImmediate), so other requests are not held
 * up while it deflates. Names may be 65,535 bytes long.
 *
 * Every entry gets `date` (UTC: zip dates carry no zone). The same entries and date always give
 * the same bytes.
 */
export async function* zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>, date: Date): AsyncGenerator<Buffer> {
  const { dosDate, dosTime } = toDosDateTime(date);
  const written: Written[] = [];
  let offset = 0;
  let sliceStart = performance.now();
  const pause = async () => {
    if (performance.now() - sliceStart >= SLICE_MS) {
      await new Promise((resolve) => setImmediate(resolve));
      sliceStart = performance.now();
    }
  };
  for await (const { name, data } of entries) {
    await pause();
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.length > U16) throw new Error(`zipStream: the name ${name.slice(0, 40)}... is too long`);
    if (data.length >= U32) throw new Error(`zipStream: the file ${name} is too large`);
    const deflated = data.length === 0 ? null : data.length < SYNC_LIMIT ? zlib.deflateRawSync(data, { level: 6 }) : await deflateRaw(data, { level: 6 });
    const stored = !deflated || deflated.length >= data.length;
    const body = stored ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : deflated!;
    const entry: Written = {
      name: nameBytes,
      flags: /[^\x00-\x7f]/.test(name) ? 0x0800 : 0, // bit 11: the name is UTF-8
      method: stored ? 0 : 8,
      crc: crc32(data),
      compressed: body.length,
      size: data.length,
      offset,
    };
    written.push(entry);
    offset += 30 + nameBytes.length + body.length;
    yield Buffer.concat([localHeader(entry, dosDate, dosTime), nameBytes]);
    yield body;
  }

  // The central directory, in pieces of about 1 MB.
  const directoryStart = offset;
  let piece: Buffer[] = [];
  let pieceBytes = 0;
  for (const e of written) {
    await pause();
    const far = e.offset >= U32;
    const central = Buffer.alloc(46 + (far ? 12 : 0));
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(far ? 45 : 20, 4);
    central.writeUInt16LE(far ? 45 : 20, 6);
    central.writeUInt16LE(e.flags, 8);
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compressed, 20);
    central.writeUInt32LE(e.size, 24);
    central.writeUInt16LE(e.name.length, 28);
    central.writeUInt16LE(far ? 12 : 0, 30);
    // Comment, disk, internal and external attributes: 0.
    central.writeUInt32LE(far ? U32 : e.offset, 42);
    if (far) {
      // The ZIP64 extra field (0x0001) holds only the fields set to 0xFFFFFFFF: the offset.
      central.writeUInt16LE(0x0001, 46);
      central.writeUInt16LE(8, 48);
      central.writeBigUInt64LE(BigInt(e.offset), 50);
    }
    piece.push(central.subarray(0, 46), e.name, central.subarray(46));
    pieceBytes += central.length + e.name.length;
    offset += central.length + e.name.length;
    if (pieceBytes >= 1 << 20) {
      yield Buffer.concat(piece);
      piece = [];
      pieceBytes = 0;
    }
  }
  const directorySize = offset - directoryStart;
  const count = written.length;
  const zip64 = count >= U16 || directoryStart >= U32 || directorySize >= U32 || offset >= U32;
  if (zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4); // the size of what follows this field
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeUInt32LE(0, 16); // this disk
    record.writeUInt32LE(0, 20); // the disk the directory starts on
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryStart), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    locator.writeBigUInt64LE(BigInt(offset), 8); // where the ZIP64 record starts
    locator.writeUInt32LE(1, 16); // disks in all
    piece.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, U16), 8);
  end.writeUInt16LE(Math.min(count, U16), 10);
  end.writeUInt32LE(Math.min(directorySize, U32), 12);
  end.writeUInt32LE(Math.min(directoryStart, U32), 16);
  piece.push(end);
  yield Buffer.concat(piece);
}

/**
 * The 30 bytes of an entry's local header (its name follows). An entry starting at 4 GB or more is
 * a ZIP64 entry (its offset is in the central directory's ZIP64 field), so it needs version 4.5.
 */
export function localHeader(entry: Written, dosDate: number, dosTime: number): Buffer {
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(entry.offset >= U32 ? 45 : 20, 4);
  local.writeUInt16LE(entry.flags, 6);
  local.writeUInt16LE(entry.method, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(entry.crc, 14);
  local.writeUInt32LE(entry.compressed, 18);
  local.writeUInt32LE(entry.size, 22);
  local.writeUInt16LE(entry.name.length, 26);
  local.writeUInt16LE(0, 28);
  return local;
}

/** A date as zip (MS-DOS) date and time fields: UTC, two-second steps, 1980-2107. */
export function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
  if (Number.isNaN(date.getTime())) throw new Error('zip: invalid date');
  const year = date.getUTCFullYear();
  if (year < 1980) return { dosDate: (1 << 5) | 1, dosTime: 0 };
  if (year > 2107) return { dosDate: (127 << 9) | (12 << 5) | 31, dosTime: (23 << 11) | (59 << 5) | 29 };
  return {
    dosDate: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    dosTime: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
  };
}

/** CRC-32 of zip entries: node:zlib's when it has one (Node 20.15 and 22.2 on), else ours. */
export function crc32(data: Uint8Array): number {
  return typeof zlib.crc32 === 'function' ? zlib.crc32(data) >>> 0 : slowCrc32(data);
}

let crcTable: Uint32Array | null = null;
function slowCrc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
