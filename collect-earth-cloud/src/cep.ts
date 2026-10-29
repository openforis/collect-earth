// Reading a Collect Earth project file (CEP): a zip holding the survey (an IDML file),
// the balloons, the KML template and project_definition.properties.
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
