// Importing a Collect Earth backup (the desktop's Data Import/Export > Export data, format "XML (compressed)", the layout collectBackup.ts
// writes the other way: idml.xml, then <step>/<n>.xml per record) into a project: each record becomes the envelope
// Collect Earth's CloudRecordSerializer would have sent for it, its summary made from the XML against the project's
// served survey as BalloonInputFieldsUtils.getValuesByHtmlParameters makes it from the record Collect loads
// (DataUnmarshaller, then RecordUpdater.initializeRecord: every attribute of the root entity has a node, every item of
// an enumerated entity's list a row). test/collectImport.test.ts compares it with summaries the Java code made.
import { XMLValidator } from 'fast-xml-parser';
import { attr, childrenOf, elements, parser, parseSurvey, surveyInfo, tagOf, textOf, type RoundInfo, type XmlNode } from './cep.js';
import { prefixOf, QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR } from './surveyOutline.js';

export interface BackupFile {
  name: string;
  /** Collect's workflow step: the folder (1 entry, 2 cleansing, 3 analysis). */
  step: number;
  xml: string;
}

/** The survey's <uri>, or null. */
export function surveyUriOf(idmXml: string): string | null {
  const uri = elements(parseSurvey(idmXml).surveyChildren, 'uri')[0];
  return uri ? textOf(uri) || null : null;
}

/** One record of the backup, as Collect Earth would have uploaded it. */
export interface ImportedRecord {
  recordKey: string;
  operator: string;
  modifiedOn: number | null;
  activelySaved: boolean;
  step: number;
  xml: string;
  summary: Record<string, string>;
}

interface Def {
  name: string;
  tag: string;
  /** The handler's prefix (surveyOutline.prefixOf); null: no handler (taxon, file). */
  prefix: string | null;
  multiple: boolean;
  key: boolean;
  type: string | undefined;
  children: Def[];
  /** An entity's enumerating key (its first key, a code attribute) and, when Collect adds a row per item, the items. */
  keyCode: Def | null;
  items: string[];
}

const NODE_TAGS = new Set(['entity', 'text', 'code', 'number', 'range', 'date', 'time', 'boolean', 'coordinate', 'taxon', 'file']);

function defsOf(parent: XmlNode, lists: Map<string, { code: string }[]>): Def[] {
  return childrenOf(parent)
    .filter((n) => NODE_TAGS.has(tagOf(n) ?? '') && attr(n, 'name'))
    .map((n) => {
      const children = tagOf(n) === 'entity' ? defsOf(n, lists) : [];
      const firstKey = children.find((c) => c.key) ?? null;
      const keyCode = firstKey && firstKey.tag === 'code' ? firstKey : null;
      const keyList = keyCode ? childrenOf(n).find((c) => attr(c, 'name') === keyCode.name) : undefined;
      const enumerate = attr(n, 'collect:enumerate') === 'true' && attr(n, 'multiple') === 'true';
      return {
        name: attr(n, 'name')!,
        tag: tagOf(n)!,
        prefix: prefixOf(n),
        multiple: attr(n, 'multiple') === 'true',
        key: attr(n, 'key') === 'true',
        type: attr(n, 'type'),
        children,
        keyCode,
        items: enumerate && keyList ? (lists.get(attr(keyList, 'list') ?? '') ?? []).map((i) => i.code) : [],
      };
    });
}

/** Java's Double.toString (JDK 19 and later: the shortest digits): 2015.0, 0.5, 5.0E-4, 1.0E7. */
export function javaDouble(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  if (n === 0) return Object.is(n, -0) ? '-0.0' : '0.0';
  const abs = Math.abs(n);
  if (abs >= 1e-3 && abs < 1e7) {
    const s = String(n);
    return s.includes('.') ? s : `${s}.0`;
  }
  const [m, e] = n.toExponential().split('e');
  return `${m.includes('.') ? m : `${m}.0`}E${Number(e)}`;
}

/** BigDecimal.valueOf(n).stripTrailingZeros().toPlainString(): 100, 1.5, 0.0001. */
function plainNumber(n: number): string {
  if (n === 0) return '0';
  const [m, e] = n.toExponential().split('e');
  const digits = m.replace('-', '').replace('.', '');
  const point = Number(e) + 1;
  const body = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return (n < 0 ? '-' : '') + body;
}

const two = (n: number) => String(n).padStart(2, '0');

/** A field of an attribute element (Collect's Field.parseValue: blank is null). */
function field(node: XmlNode, name: string): string | null {
  const f = elements(childrenOf(node), name)[0];
  const text = f ? textOf(f) : '';
  return text === '' ? null : text;
}

const javaInt = (s: string | null): number | null => (s === null || !/^[+-]?\d+$/.test(s) ? null : Number.parseInt(s, 10));
const javaReal = (s: string | null): number | null => (s === null || Number.isNaN(Number(s)) ? null : Number(s));

/** AbstractAttributeHandler.getParameterValue of the attribute's value: null for none. */
function valueOf(def: Def, node: XmlNode): string | null {
  switch (def.tag) {
    case 'text':
      return field(node, 'value');
    case 'boolean': {
      const v = field(node, 'value');
      return v === null ? null : String(v.toLowerCase() === 'true');
    }
    case 'code': {
      const code = field(node, 'code');
      const qualifier = field(node, 'qualifier');
      return code === null ? null : qualifier === null ? code : `${code}${QUALIFIER_SEPARATOR}${qualifier}`;
    }
    case 'coordinate': {
      // A Coordinate is made even with no x and y: Java's StringBuilder writes them as "null"
      const x = javaReal(field(node, 'x'));
      const y = javaReal(field(node, 'y'));
      return `${y === null ? 'null' : javaDouble(y)},${x === null ? 'null' : javaDouble(x)}`;
    }
    case 'date': {
      const [y, m, d] = ['year', 'month', 'day'].map((f) => javaInt(field(node, f)));
      if (y === null || m === null || d === null) return null;
      // Collect's calendar is not lenient: an impossible date has no value
      const date = new Date(Date.UTC(2000, m - 1, d));
      date.setUTCFullYear(y);
      if (y < 1 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
      return `${two(m)}/${two(d)}/${String(y).padStart(4, '0')}`;
    }
    case 'time': {
      const h = javaInt(field(node, 'hour'));
      const min = javaInt(field(node, 'minute'));
      if (h === null || min === null) return null;
      // Time.toCalendar is lenient: 25:00 is 01:00
      const total = (((h * 60 + min) % 1440) + 1440) % 1440;
      return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
    }
    case 'number': {
      const raw = field(node, 'value');
      if (def.type === 'integer') {
        const v = javaInt(raw);
        return v === null ? null : String(v);
      }
      const v = javaReal(raw);
      return v === null ? null : javaDouble(v);
    }
    case 'range': {
      const integer = def.type === 'integer';
      const read = (s: string | null) => (integer ? javaInt(s) : javaReal(s));
      const format = (n: number) => (integer ? String(n) : plainNumber(n));
      const from = read(field(node, 'from'));
      const to = read(field(node, 'to'));
      if (from === null) return null;
      return to === null || to === from ? format(from) : `${format(from)}-${format(to)}`;
    }
    default:
      return null;
  }
}

/** Node.hasData: a value, a remark or a symbol somewhere in it (DataUnmarshaller removes a node without). */
function hasData(node: XmlNode): boolean {
  if (attr(node, 'remarks')?.trim() || attr(node, 'symbol')?.trim()) return true;
  return childrenOf(node).some((c) => (c['#text'] !== undefined ? String(c['#text']).trim() !== '' : hasData(c)));
}

/** The element children of a record node that Collect keeps (with data), by name. */
function byName(node: XmlNode): Map<string, XmlNode[]> {
  const out = new Map<string, XmlNode[]>();
  for (const child of childrenOf(node)) {
    const tag = tagOf(child);
    if (!tag || tag.startsWith('#') || !hasData(child)) continue;
    const list = out.get(tag);
    if (list) list.push(child);
    else out.set(tag, [child]);
  }
  return out;
}

/**
 * The summary of a record (its root element's children by name) as getValuesByHtmlParameters makes it, a null kept
 * as '' (records.ts summaryOf). Attributes without a handler (taxon, file) and entities inside entities are left
 * out: Collect Earth cannot summarize, so cannot send, a record holding them.
 */
function summaryOf(defs: Def[], children: Map<string, XmlNode[]>): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const def of defs) {
    if (!def.prefix) continue;
    const nodes = children.get(def.name) ?? [];
    if (def.tag !== 'entity') {
      // initializeRecord gives every attribute a node; a second value is joined at the index the first ones count
      const values = nodes.length === 0 ? [valueOf(def, {})] : nodes.map((n) => valueOf(def, n));
      let value: string | null = null;
      for (let i = 0; i < values.length; i++) {
        if (value === null) value = values[0];
        else {
          const index: number = value.split(SUMMARY_VALUES_SEPARATOR).length;
          if (index < values.length) value = `${value}${SUMMARY_VALUES_SEPARATOR}${values[index] ?? 'null'}`;
        }
      }
      summary[`collect_${def.prefix}${def.name}`] = value ?? '';
      continue;
    }
    const rows = nodes.map(byName);
    const keyCode = def.keyCode;
    if (keyCode) {
      // Collect adds the rows of an enumerated entity's items the record lacks, the key their only value
      const have = new Set(rows.map((r) => valueOf(keyCode, (r.get(keyCode.name) ?? [])[0] ?? {})));
      for (const code of def.items) {
        if (!have.has(code)) rows.push(new Map([[keyCode.name, [{ [keyCode.name]: [{ code: [{ '#text': code }] }] }]]]));
      }
    }
    rows.forEach((row, i) => {
      let base = `collect_${def.prefix}${def.name}`;
      if (def.multiple) {
        const keyNode = keyCode ? (row.get(keyCode.name) ?? [])[0] : undefined;
        base += `[${keyCode ? ((keyNode ? valueOf(keyCode, keyNode) : null) ?? 'null') : i + 1}]`;
      }
      for (const child of def.children) {
        if (!child.prefix || child.tag === 'entity') continue;
        const values = (row.get(child.name) ?? []).map((n) => valueOf(child, n)).filter((v): v is string => v !== null && v.trim() !== '');
        if (values.length > 0) summary[`${base}.${child.prefix}${child.name}`] = values.join(SUMMARY_VALUES_SEPARATOR);
      }
    });
  }
  return summary;
}

const ROUND_NAME = 'round';

/**
 * Reads the records of a backup against the project's served survey. `info` is the project's RoundInfo: when the
 * server added round to the survey (state added), a record without it (collected before the project had a round) is
 * the first round's, as the CEO import makes its records.
 */
export function backupReader(servedSurveyXml: string, info: RoundInfo | null) {
  const { root, rootEntity } = parseSurvey(servedSurveyXml);
  const defs = defsOf(root, surveyInfo(servedSurveyXml).codeLists);
  const keys = defs.filter((d) => d.key);
  const firstRound = info?.state === 'added' ? (info.roundCodes.find((c) => c.code !== info.reassessmentCode)?.code ?? null) : null;

  /** The record of one file, or why it cannot be read; with its key values and its root's nodes with data, by name. */
  return (file: BackupFile): (ImportedRecord & { keyValues: string[]; children: Map<string, XmlNode[]> }) | { problem: string } => {
    if (/<!DOCTYPE/i.test(file.xml) || XMLValidator.validate(file.xml) !== true) return { problem: `${file.name}: not valid XML` };
    let document: XmlNode[];
    try {
      document = parser.parse(file.xml) as XmlNode[];
    } catch {
      return { problem: `${file.name}: not valid XML` };
    }
    const element = document.find((n) => tagOf(n) !== null && !tagOf(n)!.startsWith('?') && !tagOf(n)!.startsWith('#'));
    if (!element || tagOf(element) !== rootEntity) return { problem: `${file.name}: not a record of this survey (its root is not "${rootEntity}")` };
    const children = byName(element);
    let xml = file.xml;
    if (firstRound !== null && !children.has(ROUND_NAME)) {
      const round = { [ROUND_NAME]: [{ code: [{ '#text': firstRound }] }] };
      children.set(ROUND_NAME, [round]);
      xml = xml.replace(new RegExp(`(<${rootEntity}(\\s[^>]*)?>)`), `$1\n  <${ROUND_NAME}>\n    <code>${firstRound}</code>\n  </${ROUND_NAME}>`);
    }
    const keyValues = keys.map((k) => {
      const node = (children.get(k.name) ?? [])[0];
      return node ? valueOf(k, node) : null;
    });
    if (keyValues.length === 0 || keyValues.some((v) => v === null || v === '')) return { problem: `${file.name}: its plot id (key) is empty` };
    const summary = summaryOf(defs, children);
    const time = (name: string) => {
      const t = Date.parse(attr(element, name) ?? '');
      return Number.isFinite(t) ? t : null;
    };
    return {
      recordKey: keyValues.join(','),
      keyValues: keyValues as string[],
      children,
      operator: summary.collect_text_operator ?? '',
      modifiedOn: time('modified') ?? time('created'),
      activelySaved: summary.collect_boolean_actively_saved === 'true',
      step: file.step,
      xml,
      summary,
    };
  };
}
