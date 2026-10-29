// Reading a Collect Earth project file (CEP): a zip holding the survey (an IDML file),
// the balloons, the KML template and project_definition.properties.
import { deflateRawSync } from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

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

export type CepErrorCode = 'not_a_zip' | 'no_survey' | 'survey_unreadable';

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

/** Opens a CEP and finds its survey, balloons and KML template. */
export function readCep(zip: Buffer): CepFiles {
  // unzipSync hands back a plain object, which puts names like "1" first and cannot hold
  // "__proto__". The filter sees every entry in zip order, so the names are taken from it
  // and the entries map is built in that order. A served CEP is re-zipped from this map,
  // so nothing may be lost: a "__proto__" entry or a repeated name is refused.
  const names: string[] = [];
  const seen = new Set<string>();
  let refusal: string | null = null;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength), {
      filter: ({ name }) => {
        if (name === '__proto__') refusal = 'it has a file named __proto__';
        else if (seen.has(name)) refusal = `it has two files named ${name}`;
        if (refusal) return false;
        seen.add(name);
        names.push(name);
        return true;
      },
    });
  } catch {
    throw new CepError('not_a_zip', 'The project file is not a zip file.');
  }
  if (refusal) throw new CepError('not_a_zip', `The project file is not a zip file Collect Earth can use: ${refusal}.`);
  const entries = new Map(names.map((name) => [name, unzipped[name]] as const));

  const propertiesBytes = entries.get(PROPERTIES_PATH);
  const properties = propertiesBytes ? parseProperties(strFromU8(propertiesBytes)) : new Map<string, string>();
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
  return {
    entries,
    surveyPath,
    balloonPath: locate(LOCATIONS.balloon),
    balloonWebPath: locate(LOCATIONS.balloonWeb),
    templatePath: locate(LOCATIONS.template),
  };
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
type XmlNode = Record<string, unknown>;

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

const tagOf = (node: XmlNode): string | null => {
  for (const key of Object.keys(node)) if (key !== ':@') return key;
  return null;
};
const childrenOf = (node: XmlNode): XmlNode[] => {
  const tag = tagOf(node);
  const children = tag ? node[tag] : undefined;
  return Array.isArray(children) ? (children as XmlNode[]) : [];
};
const attr = (node: XmlNode, name: string): string | undefined => {
  const attrs = node[':@'] as Record<string, unknown> | undefined;
  const value = attrs?.[`@_${name}`];
  return value === undefined ? undefined : String(value);
};
const elements = (nodes: XmlNode[], tag: string): XmlNode[] => nodes.filter((n) => tagOf(n) === tag);
const textOf = (node: XmlNode): string =>
  childrenOf(node)
    .map((c) => (c['#text'] === undefined ? '' : String(c['#text'])))
    .join('')
    .trim();

/**
 * Reads what the server needs to know about a survey (placemark.idm.xml).
 *
 * Element names are matched without a prefix: Collect writes IDML with its namespace as
 * the default one (xmlns="http://www.openforis.org/idml/3.0"), and this assumes it.
 */
export function surveyInfo(idmXml: string): SurveyInfo {
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

  const keys: SurveyKey[] = [];
  let hasNonKeyRound = false;
  for (const child of childrenOf(root)) {
    const type = tagOf(child);
    const name = attr(child, 'name');
    if (!type || type.startsWith('#') || !name) continue;
    if (attr(child, 'key') === 'true') keys.push({ name, type, list: attr(child, 'list') ?? null });
    else if (name === 'round') hasNonKeyRound = true;
  }

  const languages = elements(surveyChildren, 'language').map(textOf).filter((l) => l !== '');
  // The label without xml:lang, else the one in the survey's default language, else the first.
  const pickLabel = (labels: XmlNode[]): XmlNode | undefined =>
    labels.find((l) => attr(l, 'xml:lang') === undefined) ??
    (languages.length > 0 ? labels.find((l) => attr(l, 'xml:lang') === languages[0]) : undefined) ??
    labels[0];

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
 * Every entry gets `date` (local time, as zip dates are). Collect Earth applies it when it
 * extracts the file and caches the plot file by path and modification time, so a new
 * upload must carry a new date: pass the upload time. The same entries and date always
 * give the same bytes.
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
    const deflated = data.length > 0 ? deflateRawSync(data, { level: 6 }) : null;
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

/** A date as zip (MS-DOS) date and time fields: local time, two-second steps, 1980-2107. */
function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
  if (Number.isNaN(date.getTime())) throw new Error('zipCep: invalid date');
  const year = date.getFullYear();
  if (year < 1980) return { dosDate: (1 << 5) | 1, dosTime: 0 };
  if (year > 2107) return { dosDate: (127 << 9) | (12 << 5) | 31, dosTime: (23 << 11) | (59 << 5) | 29 };
  return {
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
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

/**
 * Serves an id-only project file with a hidden `round` key added to its survey, balloons and
 * KML template. Hands back the original bytes, and why, in every other case.
 * `date` stamps every entry of the served zip (see zipCep): the upload time.
 */
export function addRound(zip: Buffer, date: Date = new Date()): { cep: Buffer; info: RoundInfo } {
  const none = (refusal: RefusalCode, keyCount = 0) => ({
    cep: zip,
    info: { state: 'none', refusal, keyCount, roundIndex: null, roundCodes: [], reassessmentCode: null } as RoundInfo,
  });

  let files: CepFiles;
  let info: SurveyInfo;
  try {
    files = readCep(zip);
    info = surveyInfo(decodeUtf8(files.entries.get(files.surveyPath)!));
  } catch (e) {
    if (e instanceof CepError) return none(e.code);
    throw e;
  }
  const keyCount = info.keys.length;
  if (info.rootEntityCount > 1) return none('several_entities', keyCount);

  const roundIndex = info.keys.findIndex((k) => k.name === 'round');
  if (roundIndex >= 0) {
    const roundCodes = info.codeLists.get(info.keys[roundIndex].list ?? '') ?? [];
    return {
      cep: zip,
      info: {
        state: 'own',
        refusal: null,
        keyCount,
        roundIndex,
        roundCodes,
        reassessmentCode: roundCodes.some((c) => c.code === '2') ? '2' : null,
      },
    };
  }
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
  const served = readCep(cep);
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

  // Labels: unmarked in the survey's default language, then its other languages we have.
  const defaultLang = info.languages[0] ?? 'en';
  const unmarked: Lang = isLang(defaultLang) ? defaultLang : 'en';
  const marked = (info.languages.length > 0 ? info.languages : ['en', 'es', 'fr', 'pt']).filter(
    (l): l is Lang => isLang(l) && l !== defaultLang && l !== unmarked,
  );
  const labels = (texts: Record<Lang, string>, type: string) => [
    `<label${type}>${xmlAscii(texts[unmarked])}</label>`,
    ...marked.map((l) => `<label${type} xml:lang="${l}">${xmlAscii(texts[l])}</label>`),
  ];

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
