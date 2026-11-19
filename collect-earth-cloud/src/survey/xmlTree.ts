// A survey (placemark.idm.xml) as a tree that keeps every byte it was read with: the survey designer's
// model (docs/plans/2026-11-18-survey-designer.md). An element nothing changed is written back exactly as it was
// read, so a survey opened and saved without a change is the same file, and a change touches only what it changes:
// whatever the designer does not know (a formula, an option it has no control for, a comment) travels untouched.
//
// The text is held as Latin-1 (one character per byte of the file), as the project file's other edits do (cep.ts):
// the bytes come back unchanged whatever the file's encoding, and everything written here is ASCII, any other
// character as a character reference (&#233;), which every encoding reads the same way.

/** An element of the survey. */
export interface XmlElement {
  kind: 'element';
  name: string;
  attrs: XmlAttr[];
  children: XmlChild[];
  /** Written as <name/> */
  selfClosing: boolean;
  /** The element as it was read, kept while nothing in it changes; undefined once it did, or for a new one */
  source: string | undefined;
  /** Its start tag as read, kept while its attributes do not change */
  startTag: string | undefined;
  /** Its end tag as read */
  endTag: string | undefined;
  parent: XmlElement | null;
}

/** Text, a comment, CDATA or a processing instruction: kept as read. */
export interface XmlLeaf {
  kind: 'text' | 'comment' | 'cdata' | 'pi';
  /** As in the file (Latin-1, still escaped) */
  raw: string;
}

export type XmlChild = XmlElement | XmlLeaf;

/** An attribute, its value as in the file (still escaped). */
export interface XmlAttr {
  name: string;
  raw: string;
  quote: '"' | "'";
}

export interface XmlDocument {
  /** What comes before the root element: the XML declaration, a byte order mark, comments, line breaks */
  before: XmlLeaf[];
  root: XmlElement;
  after: XmlLeaf[];
  /** The file is UTF-8 (declared so, or not declared): the raw text is decoded as UTF-8 when read */
  utf8: boolean;
  /** The line break the file uses */
  eol: string;
  /** One step of indentation in the file: a tab, or some spaces */
  indentUnit: string;
}

export class XmlTreeError extends Error {}

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?:[^>"']|"[^"]*"|'[^']*')*>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Reads a survey from the bytes of its file. Refuses a DOCTYPE, and text that is not well-formed XML. */
export function readXml(bytes: Uint8Array): XmlDocument {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  const before: XmlLeaf[] = [];
  const after: XmlLeaf[] = [];
  let root: XmlElement | null = null;
  const stack: Array<{ element: XmlElement; start: number }> = [];
  let at = 0;
  const leaf = (kind: XmlLeaf['kind'], raw: string) => {
    if (raw === '') return;
    const node: XmlLeaf = { kind, raw };
    if (stack.length > 0) stack[stack.length - 1].element.children.push(node);
    else if (root) after.push(node);
    else before.push(node);
  };
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    const whole = m[0];
    const between = text.slice(at, start);
    if (between !== '') {
      if (stack.length === 0 && /\S/.test(between.replace(/^ï»¿/, ''))) {
        throw new XmlTreeError('There is text outside the survey element.');
      }
      if (between.includes('<')) throw new XmlTreeError('The survey is not well-formed XML.');
      leaf('text', between);
    }
    at = start + whole.length;
    if (whole.startsWith('<!--')) leaf('comment', whole);
    else if (whole.startsWith('<![CDATA[')) leaf('cdata', whole);
    else if (whole.startsWith('<?')) leaf('pi', whole);
    else if (whole.startsWith('<!')) throw new XmlTreeError('A survey has no DOCTYPE.');
    else if (m[1] !== undefined) {
      const open = stack.pop();
      if (!open || open.element.name !== m[1]) throw new XmlTreeError(`</${m[1]}> closes nothing open.`);
      open.element.endTag = whole;
      open.element.source = text.slice(open.start, at);
    } else {
      const name = m[2];
      const attrs: XmlAttr[] = [];
      for (const a of m[3].matchAll(ATTRIBUTE)) {
        attrs.push({ name: a[1], raw: a[2] ?? a[3], quote: a[2] !== undefined ? '"' : "'" });
      }
      const parent = stack.length > 0 ? stack[stack.length - 1].element : null;
      if (!parent && root) throw new XmlTreeError('A survey has one root element.');
      const element: XmlElement = {
        kind: 'element',
        name,
        attrs,
        children: [],
        selfClosing: m[4] === '/',
        source: undefined,
        startTag: whole,
        endTag: undefined,
        parent,
      };
      if (parent) parent.children.push(element);
      else root = element;
      if (element.selfClosing) element.source = whole;
      else stack.push({ element, start });
    }
  }
  const rest = text.slice(at);
  if (rest !== '') {
    if (stack.length > 0 || /\S/.test(rest) || rest.includes('<')) throw new XmlTreeError('The survey is not well-formed XML.');
    leaf('text', rest);
  }
  if (stack.length > 0) throw new XmlTreeError(`<${stack[stack.length - 1].element.name}> is never closed.`);
  if (!root) throw new XmlTreeError('There is no survey element.');
  const declaration = before.find((l) => l.kind === 'pi' && l.raw.startsWith('<?xml'));
  const encoding = declaration ? /encoding\s*=\s*["']([^"']+)["']/.exec(declaration.raw)?.[1] : undefined;
  return {
    before,
    root,
    after,
    utf8: encoding === undefined || /^utf-?8$/i.test(encoding),
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    indentUnit: indentUnitOf(text),
  };
}

/** The survey's bytes: what nothing changed exactly as read. */
export function writeXml(doc: XmlDocument): Buffer {
  const parts: string[] = [];
  for (const l of doc.before) parts.push(l.raw);
  writeElement(doc.root, parts);
  for (const l of doc.after) parts.push(l.raw);
  return Buffer.from(parts.join(''), 'latin1');
}

function writeElement(e: XmlElement, out: string[]): void {
  if (e.source !== undefined) {
    out.push(e.source);
    return;
  }
  if (e.selfClosing && e.children.length === 0) {
    out.push(e.startTag ?? `<${e.name}${attrsText(e)} />`);
    return;
  }
  out.push(e.startTag ?? `<${e.name}${attrsText(e)}>`);
  for (const c of e.children) {
    if (c.kind === 'element') writeElement(c, out);
    else out.push(c.raw);
  }
  out.push(e.endTag ?? `</${e.name}>`);
}

const attrsText = (e: XmlElement) => e.attrs.map((a) => ` ${a.name}=${a.quote}${a.raw}${a.quote}`).join('');

/** The most common step between the indentations of the file's lines: a tab, or some spaces. */
function indentUnitOf(text: string): string {
  const counts = new Map<string, number>();
  let previous = '';
  for (const m of text.matchAll(/\n([ \t]*)</g)) {
    const indent = m[1];
    if (indent.length > previous.length && indent.startsWith(previous)) {
      const step = indent.slice(previous.length);
      counts.set(step, (counts.get(step) ?? 0) + 1);
    }
    previous = indent;
  }
  let best = '  ';
  let most = 0;
  for (const [step, n] of counts) if (n > most) [best, most] = [step, n];
  return best;
}

// ---------------------------------------------------------------------------------------
// Reading values

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** A raw text or attribute value as the string it stands for. */
export function decodeRaw(doc: XmlDocument, raw: string): string {
  const text = doc.utf8 ? Buffer.from(raw, 'latin1').toString('utf8') : raw;
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (whole, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? whole;
  });
}

/** An attribute's value, or undefined when the element has none of that name. */
export function attrValue(doc: XmlDocument, e: XmlElement, name: string): string | undefined {
  const a = e.attrs.find((x) => x.name === name);
  return a === undefined ? undefined : decodeRaw(doc, a.raw);
}

/** An element's text: its text and CDATA children, decoded. */
export function textValue(doc: XmlDocument, e: XmlElement): string {
  let out = '';
  for (const c of e.children) {
    if (c.kind === 'text') out += decodeRaw(doc, c.raw);
    else if (c.kind === 'cdata') {
      const raw = c.raw.slice(9, -3); // CDATA is literal: no references in it
      out += doc.utf8 ? Buffer.from(raw, 'latin1').toString('utf8') : raw;
    }
    else if (c.kind === 'element') out += textValue(doc, c);
  }
  return out;
}

export const childElements = (e: XmlElement): XmlElement[] => e.children.filter((c): c is XmlElement => c.kind === 'element');
export const childrenNamed = (e: XmlElement, name: string): XmlElement[] => childElements(e).filter((c) => c.name === name);
export const firstChild = (e: XmlElement, name: string): XmlElement | undefined => childElements(e).find((c) => c.name === name);

/** Every element under e, e first, in the order of the file. */
export function* descendants(e: XmlElement): Generator<XmlElement> {
  yield e;
  for (const c of e.children) if (c.kind === 'element') yield* descendants(c);
}

// ---------------------------------------------------------------------------------------
// Changing the tree

/**
 * Text as raw XML, ASCII only: & < > and any non-ASCII character as references; in an attribute value between the
 * quotes given, that quote and line breaks too.
 */
export function escapeText(value: string, quote?: '"' | "'"): string {
  let out = xmlChars(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (quote) {
    out = (quote === '"' ? out.replace(/"/g, '&quot;') : out.replace(/'/g, '&apos;')).replace(/\n/g, '&#10;').replace(/\r/g, '&#13;').replace(/\t/g, '&#9;');
  }
  return out.replace(/[^\x00-\x7f]/gu, (c) => `&#${c.codePointAt(0)};`);
}

/**
 * A text with only the characters XML 1.0 allows (a pasted text can bring others: Word's line break, a control
 * character, half of an emoji): a vertical tab or a form feed becomes a line break, the others are left out
 */
export function xmlChars(value: string): string {
  return value
    .replace(/[\v\f]/g, '\n')
    .replace(/[\x00-\x08\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '');
}

/** Marks an element, and every element around it, as changed: they are written again rather than copied. */
function touch(e: XmlElement): void {
  for (let x: XmlElement | null = e; x; x = x.parent) x.source = undefined;
}

/** Sets an attribute (added last when it is new), or removes it with undefined. */
export function setAttr(e: XmlElement, name: string, value: string | undefined): void {
  const i = e.attrs.findIndex((a) => a.name === name);
  if (value === undefined && i < 0) return;
  const quote = i >= 0 ? e.attrs[i].quote : '"';
  const raw = value === undefined ? '' : escapeText(value, quote);
  if (i >= 0 && e.attrs[i].raw === raw && value !== undefined) return;
  // The start tag as read keeps its layout (attributes on lines of their own, spaces around =): only the attribute
  // changes in it
  let tag = e.startTag;
  if (tag !== undefined) {
    const at = attributeSpan(tag, name);
    if (value === undefined) {
      tag = at ? tag.slice(0, at.lead) + tag.slice(at.end) : undefined;
    } else if (at) {
      tag = tag.slice(0, at.valueStart) + raw + tag.slice(at.valueEnd);
    } else {
      // A new one after the last, on a line of its own when they are so laid out
      const end = /\s*\/?>$/.exec(tag)!.index;
      const lastLine = /(\r?\n[ \t]*)\S[^\n]*$/.exec(tag.slice(0, end));
      const gap = lastLine ? lastLine[1] : ' ';
      tag = `${tag.slice(0, end)}${gap}${name}="${raw}"${tag.slice(end)}`;
    }
  }
  if (value === undefined) e.attrs.splice(i, 1);
  else if (i >= 0) e.attrs[i] = { ...e.attrs[i], raw };
  else e.attrs.push({ name, raw, quote });
  e.startTag = tag;
  touch(e);
}

/**
 * Where an attribute is in a start tag: its leading space, its value between the quotes, its end. The attributes are
 * read one after the other, so a name inside another's value is never taken for it.
 */
function attributeSpan(tag: string, name: string): { lead: number; valueStart: number; valueEnd: number; end: number } | undefined {
  const start = /^<[^\s/>]+/.exec(tag);
  if (!start) return undefined;
  const attribute = /(\s+)([^\s=/>]+)(\s*=\s*)("[^"]*"|'[^']*')/y;
  attribute.lastIndex = start[0].length;
  for (let m = attribute.exec(tag); m; m = attribute.exec(tag)) {
    if (m[2] === name) {
      const valueStart = m.index + m[1].length + name.length + m[3].length + 1;
      return { lead: m.index, valueStart, valueEnd: m.index + m[0].length - 1, end: m.index + m[0].length };
    }
  }
  return undefined;
}

/** Replaces an element's content with a text. */
export function setText(e: XmlElement, value: string): void {
  e.children = value === '' ? [] : [{ kind: 'text', raw: escapeText(value) }];
  if (e.children.length > 0) openUp(e);
  touch(e);
}

/** A new element, not yet in the tree. */
export function newElement(name: string, attrs: Array<[string, string]> = [], children: Array<XmlElement | string> = []): XmlElement {
  const e: XmlElement = {
    kind: 'element',
    name,
    attrs: attrs.map(([n, v]) => ({ name: n, raw: escapeText(v, '"'), quote: '"' })),
    children: [],
    selfClosing: children.length === 0,
    source: undefined,
    startTag: undefined,
    endTag: undefined,
    parent: null,
  };
  for (const c of children) {
    if (typeof c === 'string') e.children.push({ kind: 'text', raw: escapeText(c) });
    else {
      c.parent = e;
      e.children.push(c);
    }
  }
  return e;
}

/** An element written as <x/> that now gets content is written <x>…</x>. */
function openUp(e: XmlElement): void {
  if (!e.selfClosing) return;
  e.selfClosing = false;
  if (e.startTag !== undefined) e.startTag = e.startTag.replace(/\s*\/>$/, '>');
  e.endTag = `</${e.name}>`;
}

/** The indentation of the line an element starts on. */
function indentOf(e: XmlElement): string {
  const parent = e.parent;
  if (!parent) return '';
  const i = parent.children.indexOf(e);
  const before = i > 0 ? parent.children[i - 1] : undefined;
  if (before?.kind === 'text') {
    const m = /\n([ \t]*)$/.exec(before.raw);
    if (m) return m[1];
  }
  return indentOf(parent) + '';
}

/** The indentation of an element's children: as its children have it, else one step more than the element. */
function childIndentOf(doc: XmlDocument, parent: XmlElement): string {
  const first = childElements(parent)[0];
  if (first) return indentOf(first);
  return indentOf(parent) + doc.indentUnit;
}

/** Lays out a new element over several lines when it holds elements, as the file lays out its own. */
function layOut(doc: XmlDocument, e: XmlElement, indent: string): void {
  if (e.source !== undefined) return;
  const elementsInside = childElements(e);
  if (elementsInside.length === 0 || e.children.some((c) => c.kind === 'text' && /\S/.test(c.raw))) return;
  const inner = indent + doc.indentUnit;
  const laid: XmlChild[] = [];
  for (const c of elementsInside) {
    laid.push({ kind: 'text', raw: doc.eol + inner }, c);
    layOut(doc, c, inner);
  }
  laid.push({ kind: 'text', raw: doc.eol + indent });
  e.children = laid;
}

/**
 * Puts a new element into parent, before `before` (one of parent's elements), else after its last element, on a
 * line of its own with the indentation of its siblings.
 */
export function insertElement(doc: XmlDocument, parent: XmlElement, e: XmlElement, before?: XmlElement): void {
  if (e.parent) throw new XmlTreeError('The element is in the tree already.');
  const indent = childIndentOf(doc, parent);
  e.parent = parent;
  layOut(doc, e, indent);
  openUp(parent);
  const kids = parent.children;
  if (before) {
    const i = kids.indexOf(before);
    if (i < 0) throw new XmlTreeError('Not a child of that element.');
    // [.., ws, before] -> [.., ws, e, ws', before]: the new element takes the line `before` was on
    kids.splice(i, 0, e, { kind: 'text', raw: doc.eol + indent });
  } else {
    const lastElement = [...kids].reverse().find((c) => c.kind === 'element');
    const at = lastElement ? kids.indexOf(lastElement) + 1 : 0;
    if (lastElement) {
      kids.splice(at, 0, { kind: 'text', raw: doc.eol + indent }, e);
    } else {
      // The first element inside: on its own line, the end tag on the next one
      const rest = kids.splice(0);
      const closing = indentOf(parent);
      kids.push(...rest.filter((c) => c.kind !== 'text' || /\S/.test(c.raw)), { kind: 'text', raw: doc.eol + indent }, e, {
        kind: 'text',
        raw: doc.eol + closing,
      });
    }
  }
  touch(parent);
}

/** Takes an element out of the tree, with the line it was on. */
export function removeElement(e: XmlElement): void {
  const parent = e.parent;
  if (!parent) throw new XmlTreeError('The root element cannot be removed.');
  const kids = parent.children;
  const i = kids.indexOf(e);
  const before = i > 0 ? kids[i - 1] : undefined;
  if (before?.kind === 'text' && /^\s*$/.test(before.raw)) kids.splice(i - 1, 2);
  else kids.splice(i, 1);
  e.parent = null;
  touch(parent);
}

/** Moves an element of the tree before another of the same parent, or to the end of its parent. */
export function moveElement(doc: XmlDocument, e: XmlElement, before?: XmlElement): void {
  const parent = e.parent;
  if (!parent) throw new XmlTreeError('The root element cannot be moved.');
  if (before && before.parent !== parent) throw new XmlTreeError('Elements move within their parent.');
  removeElement(e);
  const source = e.source;
  insertElement(doc, parent, e, before);
  // insertElement only re-lays out new elements: one that moved keeps its own text
  e.source = source;
}
