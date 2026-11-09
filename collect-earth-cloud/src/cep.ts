// Reading a Collect Earth project file (CEP): a zip holding the survey (an IDML file),
// the balloons, the KML template and project_definition.properties.
import * as zlib from 'node:zlib';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { crc32, toDosDateTime } from './zipStream.js';

export interface CepFiles {
  /** Every zip entry, in zip order. */
  entries: Map<string, Uint8Array>;
  /** e.g. "placemark.idm.xml". */
  surveyPath: string;
  balloonPath: string | null;
  balloonWebPath: string | null;
  templatePath: string | null;
}

/** A key attribute of the root entity. `type` is the element name: text, code, integer... */
export interface SurveyKey {
  name: string;
  type: string;
  list: string | null;
}

export interface CodeItem {
  code: string;
  label: string;
}

export interface SurveyInfo {
  /** Name of the first <entity> under <schema>. */
  rootEntity: string;
  rootEntityCount: number;
  /** Direct children of the root entity with key="true", in order. */
  keys: SurveyKey[];
  /** A direct child of the root entity named "round" without key="true". */
  hasNonKeyRound: boolean;
  /** List name to its top-level items, with the default-language label. */
  codeLists: Map<string, CodeItem[]>;
  /** The <language> elements; empty means just the default language. */
  languages: string[];
  /** <survey lastId="...">. */
  lastId: number;
}

export type CepErrorCode = 'not_a_zip' | 'too_large' | 'no_survey' | 'survey_unreadable';

const unusable = (why: string) => `The project file is not a zip file Collect Earth can use: ${why}.`;

export class CepError extends Error {
  constructor(
    public code: CepErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CepError';
  }
}

const PROPERTIES_PATH = 'project_definition.properties';
/** Values in the properties file look like `${project_path}/placemark.idm.xml`. */
const PROJECT_PATH_PREFIX = /^\$\{project_path\}[/\\]/;

/** Where each file is named in project_definition.properties, and its usual name. */
const LOCATIONS = {
  survey: { key: 'metadata_file', fallback: 'placemark.idm.xml' },
  balloon: { key: 'balloon', fallback: 'balloon.html' },
  balloonWeb: { key: 'balloon_web', fallback: 'balloon_web.html' },
  template: { key: 'template', fallback: 'kml_template.fmt' },
} as const;

/** How much a project file may unzip to, so an upload cannot exhaust the server's memory. */
export interface CepLimits {
  maxEntries: number;
  /** Unzipped bytes in total, whatever the zip's size. */
  maxTotalBytes: number;
  /** Unzipped bytes per byte of zip... */
  maxRatio: number;
  /** ...but a small zip may always unzip to this much (text compresses well). */
  minAllowanceBytes: number;
  /**
   * The survey is parsed in one go, which holds up the server (about a quarter of a second
   * per MB), so it has a cap of its own. The demo survey is 379 KB. Default 10 MB.
   */
  maxSurveyBytes?: number;
  /** Each balloon and the KML template, which are searched and edited as text. Default 5 MB. */
  maxTextFileBytes?: number;
}

const MB = 1024 * 1024;
export const DEFAULT_CEP_LIMITS: Required<CepLimits> = {
  maxEntries: 2000,
  maxTotalBytes: 200 * MB,
  maxRatio: 20,
  minAllowanceBytes: 20 * MB,
  maxSurveyBytes: 10 * MB,
  maxTextFileBytes: 5 * MB,
};

/** How many unzipped bytes a zip of this size may hold. */
function allowedBytes(zipLength: number, limits: CepLimits): number {
  return Math.min(limits.maxTotalBytes, Math.max(limits.maxRatio * zipLength, limits.minAllowanceBytes));
}

/** A byte count in plain words: "20 MB", "200 KB", "512 bytes". */
function sizeInWords(bytes: number): string {
  if (bytes >= MB) return `${Math.floor(bytes / MB).toLocaleString('en')} MB`;
  if (bytes >= 1024) return `${Math.floor(bytes / 1024).toLocaleString('en')} KB`;
  return `${bytes} bytes`;
}

/**
 * The plot file a project file brings (its properties' `csv`, e.g. `${project_path}/grid/plots.csv`):
 * its path in the zip, or null when it names none the zip has. Collect Earth opens it with the
 * project, until an assigned plot file is chosen.
 */
export function bundledPlotPath(files: CepFiles): string | null {
  const propertiesBytes = files.entries.get(PROPERTIES_PATH);
  if (!propertiesBytes) return null;
  const named = parseProperties(decodeUtf8(propertiesBytes)).get('csv');
  if (named === undefined) return null;
  const path = named.replace(PROJECT_PATH_PREFIX, '').replace(/\\/g, '/');
  return files.entries.has(path) && path.toLowerCase().endsWith('.csv') ? path : null;
}

/**
 * The served project file with its bundled plot file (bundledPlotPath) replaced by `rewrite`'s
 * bytes, every entry stamped `date` (zipCep); the zip unchanged when it brings none. Only for zips
 * the server made itself (addRound, addNote): they were read within the upload's limits already.
 */
export function withBundledPlotFile(zip: Buffer, rewrite: (data: Buffer, path: string) => Buffer, date: Date): Buffer {
  const files = readCepWithin(zip, DEFAULT_CEP_LIMITS, DEFAULT_CEP_LIMITS.maxTotalBytes * 2);
  const path = bundledPlotPath(files);
  if (path === null) return zip;
  const entries = new Map(files.entries);
  entries.set(path, rewrite(asBuffer(files.entries.get(path)!), path));
  return zipCep(entries, date);
}

/** Opens a CEP and finds its survey, balloons and KML template. */
export function readCep(zip: Uint8Array, limits: CepLimits = DEFAULT_CEP_LIMITS): CepFiles {
  return readCepWithin(asBuffer(zip), limits, allowedBytes(zip.length, limits));
}

/** The files of any zip, read within the project file's limits (an uploaded shapefile's, for one). Throws CepError. */
export function readZip(zip: Uint8Array, limits: CepLimits = DEFAULT_CEP_LIMITS): Map<string, Uint8Array> {
  return unzipEntries(asBuffer(zip), limits.maxEntries, allowedBytes(zip.length, limits));
}

const asBuffer = (bytes: Uint8Array): Buffer =>
  Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function readCepWithin(zip: Buffer, limits: CepLimits, allowed: number): CepFiles {
  const entries = unzipEntries(zip, limits.maxEntries, allowed);
  const propertiesBytes = entries.get(PROPERTIES_PATH);
  const properties = propertiesBytes ? parseProperties(decodeUtf8(propertiesBytes)) : new Map<string, string>();
  const locate = ({ key, fallback }: { key: string; fallback: string }): string | null => {
    const named = properties.get(key);
    if (named !== undefined) {
      const path = named.replace(PROJECT_PATH_PREFIX, '');
      if (entries.has(path)) return path;
    }
    return entries.has(fallback) ? fallback : null;
  };

  const surveyPath = locate(LOCATIONS.survey);
  if (!surveyPath) {
    const named = properties.get(LOCATIONS.survey.key);
    const where = named === undefined ? LOCATIONS.survey.fallback : named.replace(PROJECT_PATH_PREFIX, '');
    throw new CepError('no_survey', `The project file has no survey (${where}).`);
  }
  const files: CepFiles = {
    entries,
    surveyPath,
    balloonPath: locate(LOCATIONS.balloon),
    balloonWebPath: locate(LOCATIONS.balloonWeb),
    templatePath: locate(LOCATIONS.template),
  };
  const cap = (path: string | null, what: string, max: number) => {
    if (path !== null && entries.get(path)!.length > max) {
      throw new CepError(
        'too_large',
        `The project file's ${what} (${path}) is larger than ${sizeInWords(max)}, more than the server accepts.`,
      );
    }
  };
  const maxText = limits.maxTextFileBytes ?? DEFAULT_CEP_LIMITS.maxTextFileBytes;
  cap(files.surveyPath, 'survey', limits.maxSurveyBytes ?? DEFAULT_CEP_LIMITS.maxSurveyBytes);
  cap(files.balloonPath, 'balloon', maxText);
  cap(files.balloonWebPath, 'web balloon', maxText);
  cap(files.templatePath, 'KML template', maxText);
  return files;
}

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_SIZES_AFTER_DATA = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;

interface CentralEntry {
  name: string;
  nameBytes: Buffer;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localAt: number;
}

/**
 * Every entry of a zip, in central directory order, read by hand so that nothing in the
 * zip is trusted before it is checked. A zip is only a list of claims: where each file
 * starts, how big it is packed and unpacked, its checksum. Before anything is inflated:
 * - the end record and the central directory must lie inside the zip; ZIP64, zips split
 *   over several parts, encrypted files and methods other than stored and deflate are
 *   refused;
 * - the files must follow one another without overlapping (in the order they lie in the
 *   zip, whatever the order of the central directory), so no packed byte is counted twice;
 * - each local header must name the same file, with the same method, as the central
 *   directory, and, unless sizes follow the data (bit 3), the same checksum and sizes, so
 *   that a reader going by the local headers (Java's zip4j) sees the same files;
 * - the central directory must end exactly where the end record says, hiding nothing;
 * - the number of files and the unpacked sizes they declare must fit the limits.
 * Then each file is inflated no further than its declared size, and must come out exactly
 * that long and with its checksum. So the declared sizes bound the memory used.
 * Names are UTF-8 when the zip says so (bit 11), else read one byte per character, as
 * fflate did.
 */
function unzipEntries(zip: Buffer, maxEntries: number, allowed: number): Map<string, Uint8Array> {
  const notAZip = () => new CepError('not_a_zip', 'The project file is not a zip file.');
  const cannotUse = (why: string) => new CepError('not_a_zip', unusable(why));

  // The end of central directory record: 22 bytes, then a comment of up to 64 KiB.
  if (zip.length < 22) throw notAZip();
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === EOCD_SIGNATURE && at + 22 + zip.readUInt16LE(at + 20) <= zip.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw notAZip();
  const disk = zip.readUInt16LE(end + 4);
  const centralDisk = zip.readUInt16LE(end + 6);
  const countOnDisk = zip.readUInt16LE(end + 8);
  const count = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  const centralAt = zip.readUInt32LE(end + 16);
  const zip64 = () => cannotUse('it is in the zip format for very large files (ZIP64), which the server does not read');
  if (
    count === 0xffff ||
    countOnDisk === 0xffff ||
    centralSize === 0xffffffff ||
    centralAt === 0xffffffff ||
    (end >= 20 && zip.readUInt32LE(end - 20) === ZIP64_LOCATOR_SIGNATURE)
  ) {
    throw zip64();
  }
  if (disk !== 0 || centralDisk !== 0 || countOnDisk !== count) throw cannotUse('it is split over several parts');
  if (centralAt + centralSize > end) throw notAZip();
  if (count > maxEntries) {
    throw new CepError('too_large', `The project file has more than ${maxEntries.toLocaleString('en')} files.`);
  }

  // The central directory: every claim, checked before anything is inflated.
  const central: CentralEntry[] = [];
  const names = new Set<string>();
  let total = 0;
  let at = centralAt;
  const centralEnd = centralAt + centralSize;
  for (let i = 0; i < count; i++) {
    if (at + 46 > centralEnd || zip.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw notAZip();
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const startDisk = zip.readUInt16LE(at + 34);
    const localAt = zip.readUInt32LE(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > centralEnd) throw notAZip();
    if (compressedSize === 0xffffffff || size === 0xffffffff || localAt === 0xffffffff || startDisk === 0xffff) {
      throw zip64();
    }
    if (startDisk !== 0) throw cannotUse('it is split over several parts');
    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw cannotUse('it is password-protected');
    if (method !== 0 && method !== 8) {
      throw cannotUse('a file inside it is compressed in a way the server does not read');
    }
    const nameBytes = zip.subarray(at + 46, at + 46 + nameLength);
    const name = flags & FLAG_UTF8 ? nameBytes.toString('utf8') : nameBytes.toString('latin1');
    // A served CEP is re-zipped from the entries map, so nothing may be lost.
    if (name === '__proto__') throw cannotUse('it has a file named __proto__');
    if (names.has(name)) throw cannotUse(`it has two files named ${name}`);
    names.add(name);
    total += size;
    if (total > allowed) {
      throw new CepError(
        'too_large',
        `The project file unzips to more than ${sizeInWords(allowed)}, more than the server accepts.`,
      );
    }
    central.push({ name, nameBytes, method, crc, compressedSize, size, localAt });
    at = next;
  }
  if (at !== centralEnd) throw notAZip();

  // The files' bodies: inside the zip, none overlapping another, taken in the order they
  // lie in the zip; the entries keep the central directory's order.
  const bodies: number[] = new Array(central.length);
  const byPosition = central.map((_, i) => i).sort((a, b) => central[a].localAt - central[b].localAt);
  let packed = 0;
  for (let k = 0; k < byPosition.length; k++) {
    const i = byPosition[k];
    const e = central[i];
    const limit = k + 1 < byPosition.length ? central[byPosition[k + 1]].localAt : centralAt;
    if (e.localAt + 30 > limit || zip.readUInt32LE(e.localAt) !== LOCAL_SIGNATURE) throw notAZip();
    const localFlags = zip.readUInt16LE(e.localAt + 6);
    if (zip.readUInt16LE(e.localAt + 8) !== e.method) throw notAZip();
    if (
      !(localFlags & FLAG_SIZES_AFTER_DATA) &&
      (zip.readUInt32LE(e.localAt + 14) !== e.crc ||
        zip.readUInt32LE(e.localAt + 18) !== e.compressedSize ||
        zip.readUInt32LE(e.localAt + 22) !== e.size)
    ) {
      throw notAZip();
    }
    const nameLength = zip.readUInt16LE(e.localAt + 26);
    const extraLength = zip.readUInt16LE(e.localAt + 28);
    const bodyAt = e.localAt + 30 + nameLength + extraLength;
    if (bodyAt + e.compressedSize > limit) throw notAZip();
    if (!zip.subarray(e.localAt + 30, e.localAt + 30 + nameLength).equals(e.nameBytes)) throw notAZip();
    packed += e.compressedSize;
    bodies[i] = bodyAt;
  }
  if (packed > zip.length) throw notAZip();

  // Inflating, never past the declared size, then the length and the checksum.
  const entries = new Map<string, Uint8Array>();
  for (let i = 0; i < central.length; i++) {
    const e = central[i];
    const damaged = () => cannotUse(`a file inside it (${e.name}) is damaged`);
    const body = zip.subarray(bodies[i], bodies[i] + e.compressedSize);
    let data: Uint8Array;
    if (e.method === 0) {
      if (e.compressedSize !== e.size) throw damaged();
      data = new Uint8Array(body);
    } else {
      try {
        // maxOutputLength must be at least 1: an empty file must then inflate to nothing.
        data = zlib.inflateRawSync(body, { maxOutputLength: Math.max(e.size, 1) });
      } catch {
        throw damaged();
      }
    }
    if (data.length !== e.size || crc32(data) !== e.crc) throw damaged();
    entries.set(e.name, data);
  }
  return entries;
}

/**
 * A Java properties file, enough for project_definition.properties: comments, `=`, `:` or
 * space separators, continuation lines, and backslash escapes such as `\:` and `\\`.
 */
function parseProperties(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^[ \t\f]+/, '');
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    // An odd number of trailing backslashes joins the next line.
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].replace(/^[ \t\f]+/, '');
    }
    const sep = /^((?:[^\\=: \t\f]|\\.)*)[ \t\f]*[=: \t\f]?[ \t\f]*([\s\S]*)$/.exec(line);
    if (!sep) continue;
    result.set(unescapeProperty(sep[1]), unescapeProperty(sep[2]));
  }
  return result;
}

function unescapeProperty(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c: string) => {
    if (c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return c === 't' ? '\t' : c === 'n' ? '\n' : c === 'r' ? '\r' : c === 'f' ? '\f' : c;
  });
}

// ---------------------------------------------------------------------------------------
// The survey

/** One node of fast-xml-parser's preserveOrder output: { tag: children, ':@': attributes }. */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  // Codes such as "01" stay as written.
  parseTagValue: false,
  parseAttributeValue: false,
  // Collect writes accents as character references (caf&#233;, &#x2019;): decode them.
  // DOCTYPE entities would be expanded too, so surveyInfo refuses any DOCTYPE first.
  htmlEntities: true,
});

export const tagOf = (node: XmlNode): string | null => {
  for (const key of Object.keys(node)) if (key !== ':@') return key;
  return null;
};
export const childrenOf = (node: XmlNode): XmlNode[] => {
  const tag = tagOf(node);
  const children = tag ? node[tag] : undefined;
  return Array.isArray(children) ? (children as XmlNode[]) : [];
};
export const attr = (node: XmlNode, name: string): string | undefined => {
  const attrs = node[':@'] as Record<string, unknown> | undefined;
  const value = attrs?.[`@_${name}`];
  return value === undefined ? undefined : String(value);
};
export const elements = (nodes: XmlNode[], tag: string): XmlNode[] => nodes.filter((n) => tagOf(n) === tag);
export const textOf = (node: XmlNode): string =>
  childrenOf(node)
    .map((c) => (c['#text'] === undefined ? '' : String(c['#text'])))
    .join('')
    .trim();

/** A survey parsed for reading: its <survey> element, the root entity and the languages. */
export interface ParsedSurvey {
  survey: XmlNode;
  /** The children of <survey>. */
  surveyChildren: XmlNode[];
  /** Every <entity> directly under <schema>; the first is the root entity. */
  rootEntities: XmlNode[];
  root: XmlNode;
  rootEntity: string;
  /** The <language> elements; empty means just the default language. */
  languages: string[];
  /**
   * Of several <label> (or <description>) elements, the one in the survey's default
   * language: the one without xml:lang, else the one in the first declared language, else
   * the first.
   */
  pickLabel: (labels: XmlNode[]) => XmlNode | undefined;
}

/**
 * Parses a survey (placemark.idm.xml), refusing a DOCTYPE, invalid XML, and a survey
 * without <survey> or without an entity in its schema (CepError survey_unreadable).
 *
 * Element names are matched without a prefix: Collect writes IDML with its namespace as
 * the default one (xmlns="http://www.openforis.org/idml/3.0"), and this assumes it.
 */
export function parseSurvey(idmXml: string): ParsedSurvey {
  const unreadable = (why: string) => new CepError('survey_unreadable', `The survey cannot be read: ${why}.`);
  // A survey has no DOCTYPE. Refusing one means no entity it declares is ever expanded.
  if (/<!DOCTYPE/i.test(idmXml)) throw unreadable('it has a DOCTYPE');
  if (XMLValidator.validate(idmXml) !== true) throw unreadable('it is not valid XML');
  let document: XmlNode[];
  try {
    document = parser.parse(idmXml) as XmlNode[];
  } catch {
    throw unreadable('it is not valid XML');
  }
  const survey = elements(document, 'survey')[0];
  if (!survey) throw unreadable('it has no <survey> element');
  const surveyChildren = childrenOf(survey);

  const schema = elements(surveyChildren, 'schema')[0];
  const rootEntities = schema ? elements(childrenOf(schema), 'entity') : [];
  const root = rootEntities[0];
  const rootEntity = root && attr(root, 'name');
  if (!root || !rootEntity) throw unreadable('it has no entity in its schema');

  const languages = elements(surveyChildren, 'language').map(textOf).filter((l) => l !== '');
  // The label without xml:lang, else the one in the survey's default language, else the first.
  const pickLabel = (labels: XmlNode[]): XmlNode | undefined =>
    labels.find((l) => attr(l, 'xml:lang') === undefined) ??
    (languages.length > 0 ? labels.find((l) => attr(l, 'xml:lang') === languages[0]) : undefined) ??
    labels[0];

  return { survey, surveyChildren, rootEntities, root, rootEntity, languages, pickLabel };
}

/** project_definition.properties of an opened project file (empty when it has none). */
export function cepProperties(files: CepFiles): Map<string, string> {
  const bytes = files.entries.get(PROPERTIES_PATH);
  return bytes ? parseProperties(decodeUtf8(bytes)) : new Map<string, string>();
}

/** For each key of the survey's root entity, in order: whether it is hidden from Collect Earth's record list. */
export function hiddenKeys(idmXml: string): boolean[] {
  const { root } = parseSurvey(idmXml);
  const out: boolean[] = [];
  for (const child of childrenOf(root)) {
    const type = tagOf(child);
    if (!type || type.startsWith('#') || attr(child, 'key') !== 'true') continue;
    out.push(attr(child, 'collectearth:hideinrecordlist') === 'true');
  }
  return out;
}

/** Reads what the server needs to know about a survey (placemark.idm.xml). */
export function surveyInfo(idmXml: string): SurveyInfo {
  const { survey, surveyChildren, rootEntities, root, rootEntity, languages, pickLabel } = parseSurvey(idmXml);

  const keys: SurveyKey[] = [];
  let hasNonKeyRound = false;
  for (const child of childrenOf(root)) {
    const type = tagOf(child);
    const name = attr(child, 'name');
    if (!type || type.startsWith('#') || !name) continue;
    if (attr(child, 'key') === 'true') keys.push({ name, type, list: attr(child, 'list') ?? null });
    else if (name === 'round') hasNonKeyRound = true;
  }

  const codeLists = new Map<string, CodeItem[]>();
  for (const codeListsNode of elements(surveyChildren, 'codeLists')) {
    for (const list of elements(childrenOf(codeListsNode), 'list')) {
      const name = attr(list, 'name');
      if (!name) continue;
      const items: CodeItem[] = [];
      for (const itemsNode of elements(childrenOf(list), 'items')) {
        for (const item of elements(childrenOf(itemsNode), 'item')) {
          const itemChildren = childrenOf(item);
          const code = elements(itemChildren, 'code')[0];
          if (!code) continue;
          const label = pickLabel(elements(itemChildren, 'label'));
          items.push({ code: textOf(code), label: label ? textOf(label) : '' });
        }
      }
      codeLists.set(name, items);
    }
  }

  const lastId = Number.parseInt(attr(survey, 'lastId') ?? '', 10);

  return {
    rootEntity,
    rootEntityCount: rootEntities.length,
    keys,
    hasNonKeyRound,
    codeLists,
    languages,
    lastId: Number.isFinite(lastId) ? lastId : 0,
  };
}

/**
 * Zips entries in the given order: what was read with readCep goes back as it came.
 *
 * Written here rather than with fflate: its zipSync puts names like "1" first, and its
 * streaming ZipDeflate corrupts some binary files (the demo's fonts) at level 6. Each entry
 * is deflated with node:zlib, or stored when that is not smaller.
 *
 * Every entry gets `date`, written in UTC so the bytes do not depend on the server's time
 * zone (zip dates carry no zone). Collect Earth applies it when it extracts the file and
 * caches the plot file by path and modification time, so a new upload must carry a new
 * date: pass the upload time. The same entries and date always give the same bytes.
 */
export function zipCep(entries: Map<string, Uint8Array>, date: Date): Buffer {
  // 0xffff and 0xffffffff themselves mean "see the ZIP64 record", which this writer lacks.
  const tooLarge = (what: string) =>
    new Error(`zipCep: ${what} too large for a zip without ZIP64; the project file cannot be written`);
  if (entries.size >= 0xffff) throw tooLarge('the number of files is');
  const { dosDate, dosTime } = toDosDateTime(date);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.length >= 0xffff) throw tooLarge(`the name ${name.slice(0, 40)}... is`);
    if (data.length >= 0xffffffff) throw tooLarge(`the file ${name} is`);
    const deflated = data.length > 0 ? zlib.deflateRawSync(data, { level: 6 }) : null;
    const stored = !deflated || deflated.length >= data.length;
    const body = stored ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : deflated!;
    if (offset >= 0xffffffff) throw tooLarge('the project file is');
    const crc = crc32(data);
    const flags = /[^\x00-\x7f]/.test(name) ? 0x0800 : 0; // bit 11: the name is UTF-8
    const method = stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    // Extra field, comment, disk, internal attributes: 0. External: MS-DOS directory bit.
    central.writeUInt32LE(name.endsWith('/') ? 0x10 : 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  if (offset >= 0xffffffff || centralSize >= 0xffffffff) throw tooLarge('the project file is');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------------------------------------------------------------------------------------
// Adding the round key

export type RoundState = 'added' | 'own' | 'none';
export type RefusalCode =
  | CepErrorCode
  | 'several_entities'
  | 'several_keys'
  | 'round_not_key'
  | 'balloon_missing'
  | 'balloon_marker_missing'
  | 'balloon_ids_missing'
  | 'template_missing'
  | 'template_marker_missing';

export interface RoundInfo {
  /** added: the server added round; own: the survey has a round key; none: no round. */
  state: RoundState;
  /** Why the server did not add it (state none), else null. */
  refusal: RefusalCode | null;
  /** Keys of the served survey. */
  keyCount: number;
  /** Position of round among the keys of the served survey. */
  roundIndex: number | null;
  /** Codes of round's list (own and added). */
  roundCodes: CodeItem[];
  /** added: "2"; own: "2" when that code exists, else null until the coordinator picks one. */
  reassessmentCode: string | null;
  /**
   * The coordinator's note (Task 16): whether the served survey has it and at which extra column of
   * a served row it is read. Absent on infos stored before it (read as none).
   */
  note?: NoteInfo;
}

const BALLOON_MARKER = '<!-- START OF EXTRA CSV DATA -->';
const TEMPLATE_MARKER =
  '<!-- DO NOT REMOVE THIS LINE - IT GENERATES THE EXTRA FIELDS FROM THE CSV-BALLOON INTEGRATION -->';
const ROUND_INPUT =
  '<input type="hidden" id="collect_code_round" name="collect_code_round" value="$[EXTRA_round]" class="extra" />';
const ROUND_TEMPLATE_LINES = ['<Data name="EXTRA_round">', '<value>${placemark.idColumns[1]}</value>', '</Data>'];
const EXTRA_ID_ATTRIBUTES = /\b(?:var|let|const)\s+EXTRA_ID_ATTRIBUTES\s*=\s*\[([^\]]*)\]/;
const NAMESPACES: Array<[string, string]> = [
  ['collect', 'http://www.openforis.org/collect/3.0/collect'],
  ['collectearth', 'http://www.openforis.org/collect/3.0/collectearth'],
  ['ui', 'http://www.openforis.org/collect/3.0/ui'],
];

type Lang = 'en' | 'es' | 'fr' | 'pt';
const ROUND_TEXTS: Record<'name' | 'first' | 'again', Record<Lang, string>> = {
  name: { en: 'Assessment round', es: 'Ronda de evaluación', fr: 'Phase d’évaluation', pt: 'Fase de avaliação' },
  first: { en: 'First assessment', es: 'Primera evaluación', fr: 'Première évaluation', pt: 'Primeira avaliação' },
  again: { en: 'Re-assessment', es: 'Reevaluación', fr: 'Réévaluation', pt: 'Reavaliação' },
};
const isLang = (l: string): l is Lang => l in ROUND_TEXTS.name;

/** The language a survey's unmarked labels are in, when it is one we have texts in (else English). */
const unmarkedLang = (languages: readonly string[]): Lang => {
  const defaultLang = languages[0] ?? 'en';
  return isLang(defaultLang) ? defaultLang : 'en';
};

/**
 * <label> elements for a text: unmarked in the survey's default language (English when it is not
 * one of ours), then marked in its other declared languages we have; a survey that declares no
 * languages gets English plus es/fr/pt.
 */
function labelElements(languages: readonly string[], texts: Record<Lang, string>, type: string): string[] {
  const defaultLang = languages[0] ?? 'en';
  const unmarked = unmarkedLang(languages);
  const marked = (languages.length > 0 ? languages : ['en', 'es', 'fr', 'pt']).filter(
    (l): l is Lang => isLang(l) && l !== defaultLang && l !== unmarked,
  );
  return [
    `<label${type}>${xmlAscii(texts[unmarked])}</label>`,
    ...marked.map((l) => `<label${type} xml:lang="${l}">${xmlAscii(texts[l])}</label>`),
  ];
}

/**
 * Serves an id-only project file with a hidden `round` key added to its survey, balloons and
 * KML template. Hands back the original bytes, and why, in every other case.
 * `date` stamps every entry of the served zip (see zipCep): the upload time.
 * A zip above the limits throws CepError('too_large'), whose message names the limit.
 */
export function addRound(
  zip: Buffer,
  date: Date = new Date(),
  limits: CepLimits = DEFAULT_CEP_LIMITS,
): { cep: Buffer; info: RoundInfo } {
  const none = (refusal: RefusalCode, keyCount = 0) => ({
    cep: zip,
    info: { state: 'none', refusal, keyCount, roundIndex: null, roundCodes: [], reassessmentCode: null } as RoundInfo,
  });

  let files: CepFiles;
  let info: SurveyInfo;
  try {
    files = readCep(zip, limits);
    info = surveyInfo(decodeUtf8(files.entries.get(files.surveyPath)!));
  } catch (e) {
    // too_large is thrown, so the upload is refused with the limit it had.
    if (e instanceof CepError && e.code !== 'too_large') return none(e.code);
    throw e;
  }
  const keyCount = info.keys.length;
  if (info.rootEntityCount > 1) return none('several_entities', keyCount);

  const own = ownRoundInfo(info);
  if (own) return { cep: zip, info: own };
  if (info.hasNonKeyRound) return none('round_not_key', keyCount);
  if (keyCount !== 1) return none('several_keys', keyCount);

  // Every file is edited as bytes read one to one (latin1), and only ASCII is inserted, so
  // whatever the files' encoding, every byte not inserted stays as it was.
  const read = (path: string) => latin1(files.entries.get(path)!);
  const balloons: string[] = [];
  if (!files.balloonPath) return none('balloon_missing', keyCount);
  balloons.push(files.balloonPath);
  if (files.balloonWebPath) balloons.push(files.balloonWebPath);
  for (const path of balloons) {
    const refusal = balloonRefusal(read(path));
    if (refusal) return none(refusal, keyCount);
  }
  if (!files.templatePath) return none('template_missing', keyCount);
  const template = read(files.templatePath);
  if (!template.includes(TEMPLATE_MARKER) && !template.includes('<Data name="EXTRA_id">')) {
    return none('template_marker_missing', keyCount);
  }

  let edited: { survey: string; listName: string };
  try {
    edited = addRoundToSurvey(read(files.surveyPath), info);
  } catch (e) {
    if (e instanceof CepError) return none('survey_unreadable', keyCount);
    throw e;
  }
  const { survey: newSurvey, listName } = edited;
  const entries = new Map(files.entries);
  entries.set(files.surveyPath, fromLatin1(newSurvey));
  for (const path of balloons) entries.set(path, fromLatin1(addRoundToBalloon(read(path))));
  entries.set(files.templatePath, fromLatin1(addRoundToTemplate(template)));
  const cep = zipCep(entries, date);

  // The served file must read back as [key, round]: anything else is a bug, never handed out.
  // It is read within the limits the upload had, plus what was inserted: its own size
  // (smaller or larger after re-deflating) must not change what fits.
  const grown = [...entries.values()].reduce((n, d) => n + d.length, 0) -
    [...files.entries.values()].reduce((n, d) => n + d.length, 0);
  const served = readCepWithin(cep, limits, allowedBytes(zip.length, limits) + Math.max(grown, 0));
  const check = surveyInfo(decodeUtf8(served.entries.get(served.surveyPath)!));
  const roundCodes = check.codeLists.get(listName);
  if (
    check.keys.length !== 2 ||
    check.keys[0].name !== info.keys[0].name ||
    check.keys[1].name !== 'round' ||
    check.keys[1].list !== listName ||
    !roundCodes
  ) {
    throw new Error(`addRound produced a survey whose keys are not [${info.keys[0].name}, round]`);
  }
  return {
    cep,
    info: { state: 'added', refusal: null, keyCount: 2, roundIndex: 1, roundCodes, reassessmentCode: '2' },
  };
}

/** The info of a survey with a round key of its own, else null. */
function ownRoundInfo(info: SurveyInfo): RoundInfo | null {
  const roundIndex = info.keys.findIndex((k) => k.name === 'round');
  if (roundIndex < 0) return null;
  const roundCodes = info.codeLists.get(info.keys[roundIndex].list ?? '') ?? [];
  return {
    state: 'own',
    refusal: null,
    keyCount: info.keys.length,
    roundIndex,
    roundCodes,
    reassessmentCode: roundCodes.some((c) => c.code === '2') ? '2' : null,
  };
}

/**
 * What a project file says about round, without changing it (once records exist):
 * `own` when its survey has a round key, else `none` with no refusal. A file whose
 * survey cannot be read is `none` too. Only `too_large` is thrown.
 */
export function roundInfoOf(zip: Buffer): RoundInfo {
  let info: SurveyInfo | null = null;
  try {
    const files = readCep(zip);
    info = surveyInfo(decodeUtf8(files.entries.get(files.surveyPath)!));
  } catch (e) {
    if (!(e instanceof CepError) || e.code === 'too_large') throw e;
  }
  return (
    (info && ownRoundInfo(info)) ?? {
      state: 'none',
      refusal: null,
      keyCount: info?.keys.length ?? 0,
      roundIndex: null,
      roundCodes: [],
      reassessmentCode: null,
    }
  );
}

/**
 * The round info of a project file stored before the server kept one (a project from
 * before the round work, whose `round_info` is empty): what the file says, `own` or
 * `none`, never `added` (that file was served as it was uploaded). Null when the file
 * is too large to read; the caller then leaves the info empty, as before.
 */
export function legacyRoundInfo(zip: Buffer): RoundInfo | null {
  try {
    return roundInfoOf(zip);
  } catch {
    return null;
  }
}

function balloonRefusal(html: string): RefusalCode | null {
  if (!html.includes(BALLOON_MARKER)) return 'balloon_marker_missing';
  const ids = EXTRA_ID_ATTRIBUTES.exec(html);
  if (!ids || quotedItems(ids[1]).length === 0) return 'balloon_ids_missing';
  return null;
}

function quotedItems(list: string): Array<{ quote: string; value: string; start: number; end: number }> {
  return [...list.matchAll(/(['"])((?:(?!\1).)*)\1/g)].map((m) => ({
    quote: m[1],
    value: m[2],
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}

function addRoundToBalloon(html: string): string {
  let out = html;
  const ids = EXTRA_ID_ATTRIBUTES.exec(out)!;
  const items = quotedItems(ids[1]);
  if (!items.some((i) => i.value === 'collect_code_round')) {
    const last = items[items.length - 1];
    const before = items[items.length - 2];
    const separator = before ? ids[1].slice(before.end, last.start) : ', ';
    const at = ids.index + ids[0].indexOf('[') + 1 + last.end;
    out = out.slice(0, at) + separator + last.quote + 'collect_code_round' + last.quote + out.slice(at);
  }
  if (!out.includes('id="collect_code_round"')) {
    const marker = out.indexOf(BALLOON_MARKER);
    out = insertLinesAfter(out, lineContentEnd(out, marker), [indentAt(out, marker) + ROUND_INPUT]);
  }
  return out;
}

function addRoundToTemplate(template: string): string {
  return blindPlacemarkNames(addRoundDataToTemplate(template));
}

function addRoundDataToTemplate(template: string): string {
  // An EXTRA_round already there is left alone. Surveys whose template has one normally
  // have a non-key round too, and were refused (round_not_key) before getting here.
  if (template.includes('<Data name="EXTRA_round">')) return template;
  const marker = template.indexOf(TEMPLATE_MARKER);
  if (marker >= 0) {
    const indent = indentAt(template, marker);
    return insertLinesAfter(template, lineContentEnd(template, marker), ROUND_TEMPLATE_LINES.map((l) => indent + l));
  }
  const idData = template.indexOf('<Data name="EXTRA_id">');
  const close = template.indexOf('</Data>', idData);
  const indent = indentAt(template, idData);
  return insertLinesAfter(template, close + '</Data>'.length, ROUND_TEMPLATE_LINES.map((l) => indent + l));
}

/**
 * Google Earth Pro shows a plot by the <name> of its Placemark, which the demo template fills with
 * ${placemark.placemarkId}: every key, round too, so a check copy would show as "105,2". Collect Earth
 * gives the template the id without the keys hidden from the collector as
 * ${placemark.visiblePlacemarkId} (SimplePlacemarkObject), which its folder names already use. Only the
 * first <name> of each Placemark, when it holds plain text, is changed; the rest of the template, such
 * as the ids of elements and the URLs, keeps the whole id.
 */
const PLACEMARK_NAME = /(<Placemark\b[^>]*>(?:(?!<\/?Placemark\b|<name>)[\s\S])*<name>)([^<]*)(<\/name>)/g;
const PLACEMARK_ID = '${placemark.placemarkId}';
const VISIBLE_PLACEMARK_ID = '${placemark.visiblePlacemarkId!""}';

function blindPlacemarkNames(template: string): string {
  return template.replace(PLACEMARK_NAME, (_all, open: string, name: string, close: string) =>
    open + name.split(PLACEMARK_ID).join(VISIBLE_PLACEMARK_ID) + close,
  );
}

/** Adds the round key, and its code list when needed, to an id-only survey. */
function addRoundToSurvey(text: string, info: SurveyInfo): { survey: string; listName: string } {
  const unreadable = () => new CepError('survey_unreadable', 'The survey cannot be read.');
  const survey = scanXml(text).find((e) => e.name === 'survey');
  const schema = survey?.children.find((e) => e.name === 'schema');
  const root = schema?.children.find((e) => e.name === 'entity');
  const keyName = info.keys[0].name;
  const keyElement = root?.children.find(
    (e) => attrOf(e, 'name')?.value === keyName && attrOf(e, 'key')?.value === 'true',
  );
  if (!survey || !root || !keyElement) throw unreadable();

  const edits: Edit[] = [];
  const unit = indentUnit(indentAt(text, root.start), indentAt(text, keyElement.start));

  // Ids above every id in use, whatever lastId says.
  let maxId = info.lastId;
  const visit = (e: XmlElement) => {
    const id = Number(attrOf(e, 'id')?.value);
    if (Number.isInteger(id) && id > maxId) maxId = id;
    e.children.forEach(visit);
  };
  visit(survey);
  const roundId = maxId + 1;
  let lastId = roundId;

  // The list: assessment_phases, reused when it holds codes 1 and 2, else the first free name.
  let listName = 'assessment_phases';
  let reuse = false;
  for (let n = 2; ; n++) {
    const existing = info.codeLists.get(listName);
    if (!existing) break;
    const codes = new Set(existing.map((c) => c.code));
    if (codes.has('1') && codes.has('2')) {
      reuse = true;
      break;
    }
    listName = `assessment_phases_${n}`;
  }

  const labels = (texts: Record<Lang, string>, type: string) => labelElements(info.languages, texts, type);

  if (!reuse) {
    const listId = lastId + 1;
    lastId = listId + 2;
    const item = (id: number, code: string, texts: Record<Lang, string>) =>
      `<item id="${id}"><code>${code}</code>${labels(texts, '').join('')}</item>`;
    const listLines = (indent: string) => [
      `${indent}<list id="${listId}" name="${listName}">`,
      ...labels(ROUND_TEXTS.name, ' type="item"').map((l) => indent + unit + l),
      `${indent}${unit}<codingScheme scope="local" />`,
      `${indent}${unit}<items>`,
      `${indent}${unit}${unit}${item(listId + 1, '1', ROUND_TEXTS.first)}`,
      `${indent}${unit}${unit}${item(listId + 2, '2', ROUND_TEXTS.again)}`,
      `${indent}${unit}</items>`,
      `${indent}</list>`,
    ];
    const codeLists = survey.children.find((e) => e.name === 'codeLists');
    if (codeLists && !codeLists.selfClosing) {
      const indent = indentAt(text, codeLists.closeStart);
      edits.push(insertLinesBefore(text, codeLists.closeStart, listLines(indent + unit)));
    } else {
      const anchor = codeLists ?? survey.children.find((e) => ['units', 'spatialReferenceSystems', 'schema'].includes(e.name));
      if (!anchor) throw unreadable();
      const indent = indentAt(text, anchor.start);
      const block = [`${indent}<codeLists>`, ...listLines(indent + unit), `${indent}</codeLists>`];
      if (codeLists) {
        // <codeLists/>: replaced by the full section, in place (its line break stays its own).
        const eol = eolAt(text, codeLists.start);
        edits.push({
          at: codeLists.start,
          remove: codeLists.end - codeLists.start,
          insert: block.join(eol).slice(indent.length),
        });
      } else {
        edits.push(insertLinesBefore(text, anchor.start, block));
      }
    }
  }

  // The round key, right after the id key.
  const tab = attrOf(keyElement, 'ui:tab');
  const indent = indentAt(text, keyElement.start);
  const roundLines = [
    `${indent}<code id="${roundId}" name="round" required="true"${tab ? ` ui:tab="${tab.value}"` : ''} key="true" ` +
      `list="${listName}" collect:measurement="true" collectearth:fromcsv="true" collectearth:hideinrecordlist="true">`,
    ...labels(ROUND_TEXTS.name, ' type="instance"').map((l) => indent + unit + l),
    `${indent}</code>`,
  ];
  edits.push({ at: keyElement.end, remove: 0, insert: linesAfter(text, keyElement.end, roundLines) });

  // lastId and the namespaces the round key uses, on the <survey> start tag.
  const lastIdAttr = attrOf(survey, 'lastId');
  let tagInsert = lastIdAttr ? '' : ` lastId="${lastId}"`;
  if (lastIdAttr) edits.push({ at: lastIdAttr.at, remove: lastIdAttr.value.length, insert: String(lastId) });
  for (const [prefix, uri] of NAMESPACES) {
    if (!attrOf(survey, `xmlns:${prefix}`)) tagInsert += ` xmlns:${prefix}="${uri}"`;
  }
  if (tagInsert) edits.push({ at: survey.attrsEnd, remove: 0, insert: tagInsert });

  return { survey: applyEdits(text, edits), listName };
}

// ---------------------------------------------------------------------------------------
// The coordinator's note (Task 16)

/** The note's attribute; Collect Earth sends it in a record's summary as NOTE_SUMMARY_KEY. */
export const NOTE_NAME = 'coordinator_note';
export const NOTE_SUMMARY_KEY = `collect_text_${NOTE_NAME}`;

export type NoteRefusal =
  | CepErrorCode
  | 'several_entities'
  | 'note_name_taken'
  | 'note_mismatch'
  | 'nested_plot_columns'
  | 'balloon_missing'
  | 'balloon_marker_missing'
  | 'template_missing'
  | 'template_marker_missing'
  | 'records_exist';

export interface NoteInfo {
  /** added: the served survey has the note (the server added it, or the upload had it). */
  state: 'added' | 'none';
  /** Why the server did not add it (state none), else null. */
  refusal: NoteRefusal | null;
  /**
   * added: the note's place among a served row's extra columns (those after the keys and the
   * latitude and longitude): the number of attributes the survey fills from the plot file before it.
   */
  column: number | null;
}

/** Whether the served survey has the note, and at which extra column (null: no note). */
export const noteColumn = (info: { note?: NoteInfo } | null | undefined): number | null =>
  info?.note?.state === 'added' ? info.note.column : null;

const NOTE_TEXTS: Record<'name', Record<Lang, string>> = {
  name: { en: 'Note from the coordinator', es: 'Nota del coordinador', fr: 'Note du coordinateur', pt: 'Nota do coordenador' },
};
const NOTE_INPUT =
  '<input type="hidden" id="collect_text_coordinator_note" name="collect_text_coordinator_note" value="$[EXTRA_coordinator_note]" class="extra" />';
const NOTE_SHOWN_ID = 'coordinator_note_shown';
const noteTemplateLines = (column: number) => [
  '<Data name="EXTRA_coordinator_note">',
  `<value>\${placemark.extraColumns[${column}]!""}</value>`,
  '</Data>',
];
/** IDML elements that are attributes (not entities, labels or the like). */
const ATTRIBUTE_TAGS = new Set(['text', 'code', 'number', 'boolean', 'date', 'time', 'coordinate', 'range', 'taxon', 'file']);
const isPlotColumn = (e: XmlElement) => attrOf(e, 'collectearth:fromcsv')?.value === 'true';
const isKey = (e: XmlElement) => attrOf(e, 'key')?.value === 'true';

/**
 * Serves a project file with the coordinator's note added (Task 16): a text attribute
 * `coordinator_note` filled from the plot file (collectearth:fromcsv) and shown in the header of
 * Collect Earth's form only when it has a value (collectearth:includeinheader), the last of the
 * attributes filled from the plot file, so it reads extra column N of a row, N being how many of
 * them come before it; the balloons get its hidden input and a line that shows it, the KML template
 * its `<Data>`. Hands back the original bytes, and why, in every other case; a file that already has
 * the note the server adds is `added` with its bytes unchanged.
 * `date` stamps every entry of the served zip (zipCep). A zip above the limits throws too_large.
 */
export function addNote(
  zip: Buffer,
  date: Date = new Date(),
  limits: CepLimits = DEFAULT_CEP_LIMITS,
): { cep: Buffer; info: NoteInfo } {
  const none = (refusal: NoteRefusal) => ({ cep: zip, info: { state: 'none', refusal, column: null } as NoteInfo });
  let files: CepFiles;
  let languages: string[];
  try {
    files = readCep(zip, limits);
    const parsed = parseSurvey(decodeUtf8(files.entries.get(files.surveyPath)!));
    if (parsed.rootEntities.length > 1) return none('several_entities');
    languages = parsed.languages;
  } catch (e) {
    if (e instanceof CepError && e.code !== 'too_large') return none(e.code);
    throw e;
  }
  const read = (path: string) => latin1(files.entries.get(path)!);
  const surveyText = read(files.surveyPath);
  let shape: NoteShape;
  try {
    shape = noteShape(surveyText);
  } catch (e) {
    if (e instanceof CepError) return none('survey_unreadable');
    throw e;
  }
  if (shape.nested) return none('nested_plot_columns');
  const template = files.templatePath ? read(files.templatePath) : null;
  const templateColumn = template === null ? null : noteTemplateColumn(template);
  if (shape.note) {
    // The survey's own coordinator_note: not ours.
    if (!shape.ours) return none('note_name_taken');
    // Ours, already there (the served file uploaded again, or exported again by the Collect designer,
    // which writes the Data without !"" and balloons without the line that shows it): kept as it is
    // when the template reads it where the rows have it.
    return templateColumn === shape.column
      ? { cep: zip, info: { state: 'added', refusal: null, column: shape.column } }
      : none('note_mismatch');
  }
  // A template that already reads a note the survey does not have: the files do not agree.
  if (template !== null && template.includes('<Data name="EXTRA_coordinator_note">')) return none('note_mismatch');

  const balloons: string[] = [];
  if (!files.balloonPath) return none('balloon_missing');
  balloons.push(files.balloonPath);
  if (files.balloonWebPath) balloons.push(files.balloonWebPath);
  for (const path of balloons) {
    if (!read(path).includes(BALLOON_MARKER)) return none('balloon_marker_missing');
  }
  if (!files.templatePath || template === null) return none('template_missing');
  if (!template.includes(TEMPLATE_MARKER) && !template.includes('<Data name="EXTRA_id">')) {
    return none('template_marker_missing');
  }

  let newSurvey: string;
  try {
    newSurvey = addNoteToSurvey(surveyText, shape, languages);
  } catch (e) {
    if (e instanceof CepError) return none('survey_unreadable');
    throw e;
  }
  const column = shape.column;
  const entries = new Map(files.entries);
  entries.set(files.surveyPath, fromLatin1(newSurvey));
  for (const path of balloons) entries.set(path, fromLatin1(addNoteToBalloon(read(path), languages)));
  entries.set(files.templatePath, fromLatin1(addNoteToTemplate(template, column)));
  const cep = zipCep(entries, date);

  // The served file must read back with the note where the rows have it: anything else is a bug,
  // never handed out.
  const grown = [...entries.values()].reduce((n, d) => n + d.length, 0) -
    [...files.entries.values()].reduce((n, d) => n + d.length, 0);
  const served = readCepWithin(cep, limits, allowedBytes(zip.length, limits) + Math.max(grown, 0));
  const check = noteShape(latin1(served.entries.get(served.surveyPath)!));
  const servedTemplate = latin1(served.entries.get(served.templatePath!)!);
  const ok =
    check.note &&
    check.ours &&
    check.column === column &&
    !check.nested &&
    surveyInfo(decodeUtf8(served.entries.get(served.surveyPath)!)).rootEntityCount === 1 &&
    count(servedTemplate, '<Data name="EXTRA_coordinator_note">') === 1 &&
    servedTemplate.includes(noteTemplateLines(column)[1]) &&
    balloons.every((p) => count(latin1(served.entries.get(p)!), 'id="collect_text_coordinator_note"') === 1);
  if (!ok) throw new Error(`addNote produced a project file whose note is not read from extra column ${column}`);
  return { cep, info: { state: 'added', refusal: null, column } };
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** The extra column the template's EXTRA_coordinator_note reads (with or without !""), else null. */
function noteTemplateColumn(template: string): number | null {
  const m = /<Data name="EXTRA_coordinator_note">\s*<value>\$\{placemark\.extraColumns\[(\d+)\](?:!"")?\}<\/value>/.exec(template);
  return m ? Number(m[1]) : null;
}

/** What addNote needs of a survey, read from its text as the editor sees it. */
interface NoteShape {
  root: XmlElement;
  survey: XmlElement;
  /** The root's attributes filled from the plot file that are not keys, before the note, in order. */
  column: number;
  /** An attribute below the root is filled from the plot file: its place would come after the note. */
  nested: boolean;
  /** The root has an attribute named coordinator_note... */
  note: boolean;
  /** ...the one addNote adds: text, from the plot file, in the header, after every other one from it. */
  ours: boolean;
  /** Where the note goes: after the last root attribute filled from the plot file, else the last key. */
  anchor: XmlElement | null;
  firstKey: XmlElement | null;
}

function noteShape(text: string): NoteShape {
  const unreadable = () => new CepError('survey_unreadable', 'The survey cannot be read.');
  const survey = scanXml(text).find((e) => e.name === 'survey');
  const schema = survey?.children.find((e) => e.name === 'schema');
  const root = schema?.children.find((e) => e.name === 'entity');
  if (!survey || !root) throw unreadable();
  const nestedColumn = (e: XmlElement): boolean =>
    e.children.some((c) => (ATTRIBUTE_TAGS.has(c.name) && isPlotColumn(c)) || (c.name === 'entity' && nestedColumn(c)));
  let column = 0;
  let note: XmlElement | null = null;
  let after = 0;
  let anchor: XmlElement | null = null;
  let lastKey: XmlElement | null = null;
  let firstKey: XmlElement | null = null;
  let nested = false;
  for (const child of root.children) {
    if (child.name === 'entity') {
      nested ||= nestedColumn(child);
      continue;
    }
    if (!ATTRIBUTE_TAGS.has(child.name)) continue;
    if (isKey(child)) {
      firstKey ??= child;
      lastKey = child;
    }
    if (attrOf(child, 'name')?.value === NOTE_NAME) {
      note = child;
      continue;
    }
    if (isPlotColumn(child) && !isKey(child)) {
      if (note) after++;
      else column++;
      anchor = child;
    }
  }
  const ours =
    note !== null &&
    note.name === 'text' &&
    isPlotColumn(note) &&
    !isKey(note) &&
    attrOf(note, 'collectearth:includeinheader')?.value === 'true' &&
    after === 0;
  return { root, survey, column, nested, note: note !== null, ours, anchor: anchor ?? lastKey, firstKey };
}

/** Adds the note attribute after the root's last attribute filled from the plot file (else its last key). */
function addNoteToSurvey(text: string, shape: NoteShape, languages: readonly string[]): string {
  const { survey, anchor, firstKey } = shape;
  if (!anchor) throw new CepError('survey_unreadable', 'The survey cannot be read.');
  const edits: Edit[] = [];
  let maxId = 0;
  const visit = (e: XmlElement) => {
    const id = Number(attrOf(e, 'id')?.value);
    if (Number.isInteger(id) && id > maxId) maxId = id;
    e.children.forEach(visit);
  };
  visit(survey);
  const lastIdAttr = attrOf(survey, 'lastId');
  const declared = Number.parseInt(lastIdAttr?.value ?? '', 10);
  const noteId = Math.max(maxId, Number.isFinite(declared) ? declared : 0) + 1;

  const tab = firstKey ? attrOf(firstKey, 'ui:tab') : null;
  const indent = indentAt(text, anchor.start);
  const unit = indentUnit(indentAt(text, shape.root.start), indent);
  const lines = [
    `${indent}<text id="${noteId}" name="${NOTE_NAME}" type="memo"${tab ? ` ui:tab="${tab.value}"` : ''} ` +
      'collectearth:fromcsv="true" collectearth:includeinheader="true">',
    ...labelElements(languages, NOTE_TEXTS.name, ' type="instance"').map((l) => indent + unit + l),
    `${indent}</text>`,
  ];
  edits.push({ at: anchor.end, remove: 0, insert: linesAfter(text, anchor.end, lines) });

  let tagInsert = lastIdAttr ? '' : ` lastId="${noteId}"`;
  if (lastIdAttr) edits.push({ at: lastIdAttr.at, remove: lastIdAttr.value.length, insert: String(noteId) });
  for (const [prefix, uri] of NAMESPACES) {
    if (!attrOf(survey, `xmlns:${prefix}`)) tagInsert += ` xmlns:${prefix}="${uri}"`;
  }
  if (tagInsert) edits.push({ at: survey.attrsEnd, remove: 0, insert: tagInsert });
  return applyEdits(text, edits);
}

/** A text as a CSS string's content, ASCII only: anything else as an escape. */
const cssAscii = (s: string) =>
  s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/gu, (c) => `\\${c.codePointAt(0)!.toString(16).padStart(6, '0')}`);

/**
 * The note in a balloon: its hidden input, as the other columns of the plot file have, then a line
 * that shows it, labelled, hidden while empty. A `$[...]` left unfilled (a plot file without the
 * column, opened in the browser) is cleared so it never shows.
 */
function addNoteToBalloon(html: string, languages: readonly string[]): string {
  if (html.includes('id="collect_text_coordinator_note"')) return html;
  const label = cssAscii(`${NOTE_TEXTS.name[unmarkedLang(languages)]}: `);
  const marker = html.indexOf(BALLOON_MARKER);
  const indent = indentAt(html, marker);
  const lines = [
    NOTE_INPUT,
    `<style>#${NOTE_SHOWN_ID}{margin:4px 0 8px;padding:4px 8px;border-left:3px solid #f0ad4e;background:#fcf8e3;white-space:pre-wrap}` +
      `#${NOTE_SHOWN_ID}:empty{display:none}#${NOTE_SHOWN_ID}::before{content:"${label}";font-weight:bold}</style>`,
    `<div id="${NOTE_SHOWN_ID}">$[EXTRA_coordinator_note]</div>`,
    `<script>(function(){var n=document.getElementById('${NOTE_SHOWN_ID}');` +
      `if(n&&n.textContent.indexOf('$'+'[')===0){n.textContent='';}})();</script>`,
  ];
  return insertLinesAfter(html, lineContentEnd(html, marker), lines.map((l) => indent + l));
}

function addNoteToTemplate(template: string, column: number): string {
  if (template.includes('<Data name="EXTRA_coordinator_note">')) return template;
  const lines = noteTemplateLines(column);
  const marker = template.indexOf(TEMPLATE_MARKER);
  if (marker >= 0) {
    const indent = indentAt(template, marker);
    return insertLinesAfter(template, lineContentEnd(template, marker), lines.map((l) => indent + l));
  }
  const idData = template.indexOf('<Data name="EXTRA_id">');
  const close = template.indexOf('</Data>', idData);
  const indent = indentAt(template, idData);
  return insertLinesAfter(template, close + '</Data>'.length, lines.map((l) => indent + l));
}

// ---------------------------------------------------------------------------------------
// Text helpers for the edits

interface Edit {
  at: number;
  remove: number;
  insert: string;
}

function applyEdits(text: string, edits: Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, e.at) + e.insert + out.slice(e.at + e.remove);
  }
  return out;
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
const fromLatin1 = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'));
const decodeUtf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** Text as XML in ASCII only: anything else becomes a character reference. */
const xmlAscii = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/[^\x00-\x7f]/gu, (c) => `&#${c.codePointAt(0)};`);

const lineStart = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
const indentAt = (text: string, pos: number) => /^[ \t]*/.exec(text.slice(lineStart(text, pos), pos))![0];
/** The end of the line holding pos, before its line break. */
function lineContentEnd(text: string, pos: number): number {
  const newline = text.indexOf('\n', pos);
  if (newline < 0) return text.length;
  return newline > 0 && text[newline - 1] === '\r' ? newline - 1 : newline;
}
/** The line break of the line holding pos, else the file's own. */
function eolAt(text: string, pos: number): string {
  const newline = text.indexOf('\n', pos);
  if (newline >= 0) return newline > 0 && text[newline - 1] === '\r' ? '\r\n' : '\n';
  return text.includes('\r\n') ? '\r\n' : '\n';
}
/** One indentation step: what a child adds to its parent's indentation. */
function indentUnit(parent: string, child: string): string {
  if (child.length > parent.length && child.startsWith(parent)) return child.slice(parent.length);
  return child.includes('\t') || parent.includes('\t') ? '\t' : '  ';
}
const linesAfter = (text: string, pos: number, lines: string[]) => {
  const eol = eolAt(text, pos);
  return lines.map((l) => eol + l).join('');
};
const insertLinesAfter = (text: string, pos: number, lines: string[]) =>
  text.slice(0, pos) + linesAfter(text, pos, lines) + text.slice(pos);
/** Lines placed before pos: on their own lines above it when pos starts its line. */
function insertLinesBefore(text: string, pos: number, lines: string[]): Edit {
  const eol = eolAt(text, pos);
  const start = lineStart(text, pos);
  if (/^[ \t]*$/.test(text.slice(start, pos))) {
    return { at: start, remove: 0, insert: lines.map((l) => l + eol).join('') };
  }
  return { at: pos, remove: 0, insert: lines.join(eol) + eol + indentAt(text, pos) };
}

/** An element found by scanXml, with positions in the text. */
interface XmlElement {
  name: string;
  start: number;
  attrsEnd: number;
  /** Where its closing tag starts (its own end when it closes itself). */
  closeStart: number;
  end: number;
  selfClosing: boolean;
  attrs: string;
  attrsStart: number;
  children: XmlElement[];
}

const XML_TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?:[^>"']|"[^"]*"|'[^']*')*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;

/** The elements of an XML text, with where each starts and ends, for editing it in place. */
function scanXml(text: string): XmlElement[] {
  const top: XmlElement[] = [];
  const stack: XmlElement[] = [];
  for (const m of text.matchAll(XML_TOKEN)) {
    const [whole, closing, name, attrs, selfClosing] = m;
    if (name === undefined) continue; // comment, CDATA, processing instruction
    const start = m.index!;
    const end = start + whole.length;
    if (closing) {
      const open = stack.pop();
      if (!open || open.name !== name) throw new CepError('survey_unreadable', 'The survey cannot be read.');
      open.closeStart = start;
      open.end = end;
      continue;
    }
    const attrsStart = start + 1 + name.length;
    const element: XmlElement = {
      name,
      start,
      attrs,
      attrsStart,
      attrsEnd: attrsStart + attrs.length,
      closeStart: end,
      end,
      selfClosing: selfClosing === '/',
      children: [],
    };
    (stack.length > 0 ? stack[stack.length - 1].children : top).push(element);
    if (!element.selfClosing) stack.push(element);
  }
  return top;
}

/** An attribute's raw (still escaped) value, and where the value starts in the text. */
function attrOf(e: XmlElement, name: string): { value: string; at: number } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(e.attrs);
  if (!m) return null;
  const value = m[2] ?? m[3];
  const valueOffset = m.index + m[0].length - value.length - 1;
  return { value, at: e.attrsStart + valueOffset };
}
