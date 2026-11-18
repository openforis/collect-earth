// The survey designer's changes to a survey (docs/plans/2026-11-18-survey-designer.md), on the lossless tree of
// xmlTree.ts: each one changes the elements it is about and nothing else, and writes what it adds in the order and
// the form Collect writes them (collect-core's metamodel/xml/internal/marshal), so Collect and Collect Earth read the
// survey as if Collect's designer had saved it.

import {
  attrValue,
  childElements,
  childrenNamed,
  descendants,
  firstChild,
  insertElement,
  moveElement,
  newElement,
  readXml,
  removeElement,
  setAttr,
  setText,
  textValue,
  writeXml,
  type XmlDocument,
  type XmlElement,
} from './xmlTree.js';
import type { SurveyOperation } from '../wire/survey.js';
import { checkExpression, checkSurvey, problemText, schemaOf, type ExpressionKind, type SchemaNode, type SurveyProblem } from './check.js';

export const IDML_NS = 'http://www.openforis.org/idml/3.0';
export const UI_NS = 'http://www.openforis.org/collect/3.0/ui';

/** The kinds of node of a survey's schema */
export const NODE_TAGS = ['entity', 'text', 'number', 'range', 'code', 'boolean', 'date', 'time', 'coordinate', 'taxon', 'file'] as const;
export type NodeTag = (typeof NODE_TAGS)[number];
const isNode = (e: XmlElement) => (NODE_TAGS as readonly string[]).includes(e.name);

/** Collect's order of the children of a survey */
const SURVEY_ORDER = ['project', 'uri', 'cycle', 'description', 'language', 'applicationOptions', 'versioning', 'codeLists', 'units', 'spatialReferenceSystems', 'referenceDataSchema', 'schema'];
/** Collect's order of the children of a node of the schema (NodeDefinitionXS, AttributeDefinitionXS) */
const NODE_ORDER = ['label', 'description', 'prompt', 'fieldLabel', 'default', 'check', 'compare', 'distance', 'pattern', 'unique'];
/** Collect's order of the children of a code list, and of an item (CodeListXS, CodeListItemXS) */
const LIST_ORDER = ['label', 'description', 'codingScheme', 'hierarchy', 'items'];
const ITEM_ORDER = ['code', 'label', 'description', 'item'];
const CHECK_TAGS = ['check', 'compare', 'distance', 'pattern', 'unique'];
/** A language as Collect writes it: ISO 639 (en), with a country when needed (pt_BR) */
const LANGUAGE_CODE = /^[a-z]{2,3}(_[A-Z]{2})?$/;
/** The longest text the designer writes */
export const MAX_TEXT = 4000;
const localName = (e: XmlElement) => e.name.slice(e.name.indexOf(':') + 1);

export class SurveyEditError extends Error {}

/** A survey being changed. */
export class SurveyEdit {
  readonly doc: XmlDocument;

  constructor(bytes: Uint8Array) {
    this.doc = readXml(bytes);
    if (this.doc.root.name !== 'survey' && !this.doc.root.name.endsWith(':survey')) throw new SurveyEditError('Not a survey.');
  }

  bytes(): Buffer {
    return writeXml(this.doc);
  }

  get survey(): XmlElement {
    return this.doc.root;
  }

  /** The survey's languages, the default one first */
  languages(): string[] {
    return childrenNamed(this.survey, 'language').map((l) => textValue(this.doc, l).trim());
  }

  schema(): XmlElement {
    const s = firstChild(this.survey, 'schema');
    if (!s) throw new SurveyEditError('The survey has no schema.');
    return s;
  }

  /** The root entity (plot) */
  rootEntity(): XmlElement {
    const e = childrenNamed(this.schema(), 'entity')[0];
    if (!e) throw new SurveyEditError('The survey has no root entity.');
    return e;
  }

  /** A node of the schema by its path of names from the root entity's children ("land_use/lu"), or its name alone */
  node(path: string): XmlElement {
    const names = path.split('/');
    let at = this.rootEntity();
    for (const name of names) {
      const next = childElements(at).find((c) => isNode(c) && attrValue(this.doc, c, 'name') === name);
      if (!next) throw new SurveyEditError(`No question ${path}.`);
      at = next;
    }
    return at;
  }

  /** A code list by its name */
  list(name: string): XmlElement {
    const lists = firstChild(this.survey, 'codeLists');
    const l = lists && childrenNamed(lists, 'list').find((x) => attrValue(this.doc, x, 'name') === name);
    if (!l) throw new SurveyEditError(`No list ${name}.`);
    return l;
  }

  // -------------------------------------------------------------------------------------
  // Ids

  /** The highest id the survey gives anything: lastId, or a higher id in it */
  private highestId(): number {
    let top = Number(attrValue(this.doc, this.survey, 'lastId') ?? 0) || 0;
    for (const e of descendants(this.survey)) {
      if (!isNode(e) && e.name !== 'list' && e.name !== 'item') continue;
      const id = Number(attrValue(this.doc, e, 'id'));
      if (Number.isFinite(id) && id > top) top = id;
    }
    return top;
  }

  /** A new id, recorded in the survey's lastId as Collect does */
  nextId(): number {
    const id = this.highestId() + 1;
    setAttr(this.survey, 'lastId', String(id));
    return id;
  }

  // -------------------------------------------------------------------------------------
  // Words

  /**
   * Sets the label of a node, list or item in a language (with undefined, takes it away). `type` is the label's type
   * attribute (nodes: instance, heading..., lists: item, list); items' labels have none.
   */
  setLabel(e: XmlElement, language: string, text: string | undefined, type?: string): void {
    this.setLocalized(e, 'label', language, text, type);
  }

  setDescription(e: XmlElement, language: string, text: string | undefined): void {
    this.setLocalized(e, 'description', language, text);
  }

  /**
   * A text of an element in a language: the child `tag` of that language (and `type`), changed, added or taken away.
   * Added after the others of its kind, else where `order` (Collect's order of the children) puts it.
   */
  private setLocalized(
    e: XmlElement,
    tag: string,
    language: string,
    text: string | undefined,
    type?: string,
    order: readonly string[] = NODE_ORDER,
  ): void {
    const fallback = this.languages()[0];
    const same = childrenNamed(e, tag).filter((l) => type === undefined || (attrValue(this.doc, l, 'type') ?? '') === type);
    const existing =
      same.find((l) => attrValue(this.doc, l, 'xml:lang') === language) ??
      (language === fallback ? same.find((l) => attrValue(this.doc, l, 'xml:lang') === undefined) : undefined);
    if (text === undefined || text === '') {
      if (existing) removeElement(existing);
      return;
    }
    if (existing) {
      // The same text but for spaces around it (as the dashboard shows it): left as written
      if (textValue(this.doc, existing).trim() !== text.trim()) setText(existing, text);
      return;
    }
    const attrs: Array<[string, string]> = [];
    if (type !== undefined) attrs.push(['type', type]);
    attrs.push(['xml:lang', language]);
    const after = same[same.length - 1];
    this.insertInOrder(e, newElement(tag, attrs, [text]), order, after);
  }

  /**
   * Inserts a child in its place by `order` (the names of the children in their order): after `after` when given,
   * else after the last child that comes before it in the order.
   */
  private insertInOrder(parent: XmlElement, child: XmlElement, order: readonly string[], after?: XmlElement): void {
    const kids = childElements(parent);
    let before: XmlElement | undefined;
    if (after) {
      before = kids[kids.indexOf(after) + 1];
    } else {
      const rank = order.indexOf(child.name);
      before = kids.find((k) => {
        const r = order.indexOf(k.name);
        return r > rank || (r < 0 && rank >= 0 && isNode(k));
      });
    }
    insertElement(this.doc, parent, child, before);
  }

  // -------------------------------------------------------------------------------------
  // The designer's operations on words (stage 2)

  /** A question or table by its id */
  nodeById(id: number): XmlElement {
    for (const e of descendants(this.schema())) {
      if (isNode(e) && Number(attrValue(this.doc, e, 'id')) === id) return e;
    }
    throw new SurveyEditError(`No question ${id}.`);
  }

  /** A page (a tab of the root's tab set) by its name */
  page(name: string): XmlElement {
    const options = firstChild(this.survey, 'applicationOptions');
    if (options) {
      for (const e of descendants(options)) {
        if (localName(e) === 'tab' && attrValue(this.doc, e, 'name') === name) return e;
      }
    }
    throw new SurveyEditError(`No page ${name}.`);
  }

  /** Applies one of the designer's operations; throws SurveyEditError when it cannot be */
  apply(op: SurveyOperation): void {
    if (op.op === 'addLanguage') {
      this.addLanguage(op.language);
      return;
    }
    const languages = this.languages();
    if (!languages.includes(op.language)) throw new SurveyEditError(`The survey has no language ${op.language}: add it first.`);
    const text = op.text.trim() === '' ? undefined : op.text;
    if (text !== undefined && text.length > MAX_TEXT) throw new SurveyEditError(`A text has at most ${MAX_TEXT} characters.`);
    const t = op.target;
    switch (t.kind) {
      case 'title':
        if (op.part !== 'label') break;
        this.setLocalized(this.survey, 'project', op.language, text, undefined, SURVEY_ORDER);
        return;
      case 'page': {
        if (op.part !== 'label') break;
        const tab = this.page(t.name);
        // The tab's labels carry its prefix (n0:label)
        const prefix = tab.name.includes(':') ? tab.name.slice(0, tab.name.indexOf(':') + 1) : '';
        this.setLocalized(tab, `${prefix}label`, op.language, text, undefined, [`${prefix}label`, `${prefix}tab`]);
        return;
      }
      case 'node': {
        const node = this.nodeById(t.id);
        if (op.part === 'label') this.setLabel(node, op.language, text, 'instance');
        else if (op.part === 'help') this.setDescription(node, op.language, text);
        else break;
        return;
      }
      case 'list': {
        if (op.part !== 'label') break;
        this.setLocalized(this.list(t.name), 'label', op.language, text, 'item', LIST_ORDER);
        return;
      }
      case 'item': {
        const item = this.item(this.list(t.list), t.code);
        if (op.part === 'label') this.setLocalized(item, 'label', op.language, text, undefined, ITEM_ORDER);
        else if (op.part === 'help') this.setLocalized(item, 'description', op.language, text, undefined, ITEM_ORDER);
        else break;
        return;
      }
      case 'rule': {
        if (op.part !== 'message') break;
        const node = this.nodeById(t.node);
        const rule = childElements(node).filter((c) => CHECK_TAGS.includes(c.name))[t.index];
        if (!rule) throw new SurveyEditError(`The question has no rule ${t.index + 1}.`);
        this.setLocalized(rule, 'message', op.language, text, undefined, ['message']);
        return;
      }
    }
    throw new SurveyEditError(`A ${t.kind} has no ${op.part}.`);
  }

  /** Adds a language to the survey, after its others; its texts are then written in it */
  addLanguage(language: string): void {
    if (!LANGUAGE_CODE.test(language)) throw new SurveyEditError(`${language} is not a language code (such as fr, or pt_BR).`);
    const existing = childrenNamed(this.survey, 'language');
    if (existing.some((l) => textValue(this.doc, l).trim() === language)) return;
    this.insertInOrder(this.survey, newElement('language', [], [language]), SURVEY_ORDER, existing[existing.length - 1]);
  }

  // -------------------------------------------------------------------------------------
  // Questions

  /** Labels in every language given ({en: 'Is there water?'}) as the node's instance labels */
  private labelsOf(labels: Record<string, string>, type: string | undefined): XmlElement[] {
    return Object.entries(labels)
      .filter(([, text]) => text !== '')
      .map(([language, text]) => newElement('label', [...(type ? ([['type', type]] as Array<[string, string]>) : []), ['xml:lang', language]], [text]));
  }

  /**
   * Adds a question to an entity (the root entity when none), after `after` (one of its questions) or last, on the
   * page of the question before it.
   */
  addQuestion(
    tag: Exclude<NodeTag, 'entity'>,
    name: string,
    labels: Record<string, string>,
    options: { parent?: XmlElement; after?: XmlElement; attrs?: Array<[string, string]> } = {},
  ): XmlElement {
    checkName(name);
    const parent = options.parent ?? this.rootEntity();
    const siblings = childElements(parent).filter(isNode);
    if (siblings.some((s) => attrValue(this.doc, s, 'name') === name)) throw new SurveyEditError(`There is a question ${name} already.`);
    const previous = options.after ?? siblings[siblings.length - 1];
    const attrs: Array<[string, string]> = [['id', String(this.nextId())], ['name', name]];
    const tab = previous && attrValue(this.doc, previous, 'ui:tab');
    const uiPrefix = this.uiPrefix();
    attrs.push(...(options.attrs ?? []));
    if (tab !== undefined && parent === this.rootEntity() && uiPrefix) attrs.push([`${uiPrefix}:tab`, tab]);
    const question = newElement(tag, attrs, this.labelsOf(labels, 'instance'));
    const kids = childElements(parent);
    const before = previous ? kids[kids.indexOf(previous) + 1] : undefined;
    insertElement(this.doc, parent, question, before);
    return question;
  }

  /** The prefix the survey gives Collect's ui namespace */
  private uiPrefix(): string | undefined {
    for (const a of this.survey.attrs) {
      if (a.name.startsWith('xmlns:') && a.raw === UI_NS) return a.name.slice(6);
    }
    return undefined;
  }

  /** A yes/no question */
  addYesNo(name: string, labels: Record<string, string>, options: { after?: XmlElement } = {}): XmlElement {
    return this.addQuestion('boolean', name, labels, options);
  }

  /** A question of choices from a new list, its items given as [code, labels] */
  addChoice(
    name: string,
    labels: Record<string, string>,
    items: Array<[string, Record<string, string>]>,
    options: { after?: XmlElement; listName?: string } = {},
  ): { question: XmlElement; list: XmlElement } {
    const list = this.addList(options.listName ?? name, items);
    const question = this.addQuestion('code', name, labels, { after: options.after, attrs: [['list', attrValue(this.doc, list, 'name')!]] });
    return { question, list };
  }

  /** A new code list, with its items */
  addList(name: string, items: Array<[string, Record<string, string>]>): XmlElement {
    checkName(name);
    let lists = firstChild(this.survey, 'codeLists');
    if (lists && childrenNamed(lists, 'list').some((l) => attrValue(this.doc, l, 'name') === name)) {
      throw new SurveyEditError(`There is a list ${name} already.`);
    }
    if (!lists) {
      lists = newElement('codeLists');
      this.insertInOrder(this.survey, lists, SURVEY_ORDER);
    }
    const list = newElement('list', [['id', String(this.nextId())], ['name', name]], [newElement('items')]);
    insertElement(this.doc, lists, list);
    for (const [code, itemLabels] of items) this.addItem(list, code, itemLabels);
    return list;
  }

  /** An item at the end of a list (of its first level) */
  addItem(list: XmlElement, code: string, labels: Record<string, string>, before?: XmlElement): XmlElement {
    if (!/^[A-Za-z0-9_.-]+$/.test(code)) throw new SurveyEditError(`The code ${code} has characters a code cannot have.`);
    let items = firstChild(list, 'items');
    if (!items) {
      items = newElement('items');
      insertElement(this.doc, list, items);
    }
    if (childrenNamed(items, 'item').some((i) => textValue(this.doc, firstChild(i, 'code') ?? items!).trim() === code)) {
      throw new SurveyEditError(`The list has a code ${code} already.`);
    }
    const item = newElement('item', [['id', String(this.nextId())]], [newElement('code', [], [code]), ...this.labelsOf(labels, undefined)]);
    insertElement(this.doc, items, item, before);
    return item;
  }

  /** An item of a list by its code */
  item(list: XmlElement, code: string): XmlElement {
    const items = firstChild(list, 'items');
    const found = items && childrenNamed(items, 'item').find((i) => textValue(this.doc, firstChild(i, 'code') ?? i).trim() === code);
    if (!found) throw new SurveyEditError(`The list has no code ${code}.`);
    return found;
  }

  // -------------------------------------------------------------------------------------
  // Logic

  /** Everything Collect or Collect Earth would refuse in the survey as it is now: a survey is saved only without any */
  problems(): SurveyProblem[] {
    return checkSurvey(this.bytes());
  }

  /** The schema node of an element of the tree */
  private schemaNode(e: XmlElement): SchemaNode {
    const find = (n: SchemaNode): SchemaNode | undefined => (n.element === e ? n : n.children.map(find).find((x) => x));
    const node = find(schemaOf(this.doc));
    if (!node) throw new SurveyEditError('Not a question of the survey.');
    return node;
  }

  /** Refuses an expression Collect would refuse, or the form could not evaluate, before it is written */
  private checked(e: XmlElement, kind: ExpressionKind, text: string): string {
    const verdict = checkExpression(this.schemaNode(e), kind, text);
    if (!verdict.ok) throw new SurveyEditError(problemText(verdict));
    return text;
  }

  /** When a question is shown (Collect's relevance), an XPath condition; undefined: always */
  setShownWhen(question: XmlElement, condition: string | undefined): void {
    setAttr(question, 'relevant', condition === undefined ? undefined : this.checked(question, 'boolean', condition));
    const uiPrefix = this.uiPrefix();
    if (uiPrefix && condition !== undefined && attrValue(this.doc, question, `${uiPrefix}:hideWhenNotRelevant`) === undefined) {
      setAttr(question, `${uiPrefix}:hideWhenNotRelevant`, 'true');
    }
  }

  /** Required always (true), never (false) or when a condition holds */
  setRequired(question: XmlElement, required: boolean | string): void {
    setAttr(question, 'required', required === true ? 'true' : undefined);
    setAttr(question, 'requiredIf', typeof required === 'string' ? this.checked(question, 'boolean', required) : undefined);
  }

  /**
   * A number's range: an error when the answer is not between min and max (inclusive), with its message in each
   * language given
   */
  addRangeCheck(question: XmlElement, min: number | undefined, max: number | undefined, messages: Record<string, string>): XmlElement {
    const attrs: Array<[string, string]> = [['flag', 'error']];
    if (max !== undefined) attrs.push(['lte', String(max)]);
    if (min !== undefined) attrs.push(['gte', String(min)]);
    const check = newElement(
      'compare',
      attrs,
      Object.entries(messages).map(([language, text]) => newElement('message', [['xml:lang', language]], [text])),
    );
    this.insertInOrder(question, check, NODE_ORDER, childElements(question).filter((k) => NODE_ORDER.includes(k.name)).pop());
    return check;
  }

  // -------------------------------------------------------------------------------------
  // Order and removal

  /** Moves a question (or a list item) before another of the same parent, or last */
  move(e: XmlElement, before?: XmlElement): void {
    moveElement(this.doc, e, before);
  }

  /** The expressions of the survey that name a question (conditions, formulas, checks, defaults, parent lists) */
  referencesTo(name: string): XmlElement[] {
    const word = new RegExp(`(^|[^\\w$])${name}($|[^\\w(])`);
    const found: XmlElement[] = [];
    for (const e of descendants(this.schema())) {
      if (e.attrs.some((a) => ['relevant', 'requiredIf', 'expr', 'if', 'value', 'lt', 'lte', 'gt', 'gte', 'min', 'max', 'from', 'to', 'parent', 'minCount', 'maxCount'].includes(a.name) && word.test(attrValue(this.doc, e, a.name)!))) {
        found.push(e);
      }
    }
    return found;
  }

  /** Deletes a question nothing refers to; one that something refers to is refused, naming what */
  removeQuestion(question: XmlElement): void {
    const name = attrValue(this.doc, question, 'name')!;
    const users = this.referencesTo(name).filter((e) => !isInside(e, question));
    if (users.length > 0) {
      const names = users.map((u) => attrValue(this.doc, nodeOf(u), 'name')).join(', ');
      throw new SurveyEditError(`${name} is used by ${names}.`);
    }
    removeElement(question);
  }

  /** Deletes a list no question uses */
  removeList(list: XmlElement): void {
    const name = attrValue(this.doc, list, 'name');
    for (const e of descendants(this.schema())) {
      if (e.name === 'code' && attrValue(this.doc, e, 'list') === name) {
        throw new SurveyEditError(`The list ${name} is used by ${attrValue(this.doc, e, 'name')}.`);
      }
    }
    removeElement(list);
  }
}

/** Collect's rule for names, and Collect Earth's: lower case letters, digits and _, not ending in _ and digits */
export function checkName(name: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) throw new SurveyEditError(`${name}: a name has lower case letters, digits and _ only, and starts with a letter.`);
  if (/_\d*$/.test(name)) throw new SurveyEditError(`${name}: a name cannot end in _ or _ and digits.`);
}

const isInside = (e: XmlElement, ancestor: XmlElement): boolean => {
  for (let x: XmlElement | null = e; x; x = x.parent) if (x === ancestor) return true;
  return false;
};

/** The node of the schema an element (a check, a default) belongs to */
function nodeOf(e: XmlElement): XmlElement {
  for (let x: XmlElement | null = e; x; x = x.parent) if (isNode(x)) return x;
  return e;
}
