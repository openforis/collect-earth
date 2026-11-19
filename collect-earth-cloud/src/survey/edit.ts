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
import type { ConditionRows, NewRule, SurveyOperation } from '../wire/survey.js';
import { isFixed } from './design.js';
import { codeUsers } from './codeUses.js';
import { SurveyEditError } from './errors.js';
import { conditionExpression, listCodes, ruleCheck, type LogicScope } from './logic.js';
import { namesUsed } from './condition.js';
import { checkExpression, checkSurvey, problemText, schemaOf, type ExpressionKind, type SchemaNode, type SurveyProblem } from './check.js';

export const IDML_NS = 'http://www.openforis.org/idml/3.0';
export const UI_NS = 'http://www.openforis.org/collect/3.0/ui';
export const COLLECT_NS = 'http://www.openforis.org/collect/3.0/collect';

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
/** The longest expression the designer writes */
export const MAX_EXPRESSION = 4000;
const localName = (e: XmlElement) => e.name.slice(e.name.indexOf(':') + 1);

export { SurveyEditError };

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

  /** The path of names of a question or table from the root entity (as node() takes it), or null when there is none */
  pathOf(id: number): string | null {
    let node: XmlElement;
    try {
      node = this.nodeById(id);
    } catch {
      return null;
    }
    const root = this.rootEntity();
    const names: string[] = [];
    for (let at: XmlElement | null = node; at && at !== root; at = at.parent) {
      if (!isNode(at)) return null;
      names.unshift(attrValue(this.doc, at, 'name') ?? '');
    }
    return names.join('/');
  }

  /** The id of a question or table by its path of names, or null when there is none */
  idOfPath(path: string): number | null {
    try {
      const id = Number(attrValue(this.doc, this.node(path), 'id'));
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
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

  /** The highest id given so far, once read */
  private top: number | undefined;

  /** The highest id the survey gives anything: lastId, or a higher id in it (read once: new ids only come from nextId) */
  private highestId(): number {
    if (this.top !== undefined) return this.top;
    let top = Number(attrValue(this.doc, this.survey, 'lastId') ?? 0) || 0;
    for (const e of descendants(this.survey)) {
      if (!isNode(e) && e.name !== 'list' && e.name !== 'item') continue;
      const id = Number(attrValue(this.doc, e, 'id'));
      if (Number.isFinite(id) && id > top) top = id;
    }
    this.top = top;
    return top;
  }

  /** A new id, recorded in the survey's lastId as Collect does */
  nextId(): number {
    const id = this.highestId() + 1;
    this.top = id;
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
    switch (op.op) {
      case 'addLanguage':
        return this.addLanguage(op.language);
      case 'setText':
        return this.applyText(op);
      case 'addPage':
        return void this.addPage(op.label, op.before);
      case 'movePage':
        return this.movePage(op.name, op.before);
      case 'deletePage':
        return this.deletePage(op.name);
      case 'addQuestion':
        return void this.addNewQuestion(op);
      case 'moveQuestion':
        return this.moveQuestion(op.id, op.page, op.before);
      case 'deleteQuestion':
        return this.deleteQuestion(op.id);
      case 'setRequired':
        return this.setQuestionRequired(op.id, op.required);
      case 'setShownWhen':
        return this.setNodeShownWhen(op.id, op.when);
      case 'addRule':
        return void this.putRule(op.id, op.rule);
      case 'setRule':
        return void this.putRule(op.id, op.rule, op.index);
      case 'deleteRule':
        return this.deleteRule(op.id, op.index);
      case 'setExpression':
        return this.setExpressionText(op.id, op.part, op.text);
      case 'setFormulas':
        return this.setFormulas(op.id, op.formulas);
      case 'addList':
        return void this.addNewList(op.label, op.items, op.name);
      case 'deleteList':
        return this.removeList(this.list(op.name));
      case 'addItem': {
        const list = this.list(op.list);
        return void this.addItem(
          list,
          op.item.code,
          this.checkedLabels(op.item.label),
          op.before === undefined ? undefined : this.item(list, op.before),
          op.under === undefined ? undefined : this.item(list, op.under),
        );
      }
      case 'addTable':
        return void this.addTable(op);
      case 'deleteTable':
        return this.deleteTable(op.id);
      case 'moveItem': {
        const list = this.list(op.list);
        const item = this.item(list, op.code);
        const before = op.before === undefined ? undefined : this.item(list, op.before);
        if (before === item) return;
        if (before && before.parent !== item.parent) throw new SurveyEditError('An answer moves among the answers of its level.');
        return moveElement(this.doc, item, before);
      }
      case 'deleteItem':
        return this.deleteItem(op.list, op.code);
    }
  }

  private applyText(op: Extract<SurveyOperation, { op: 'setText' }>): void {
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

  // -------------------------------------------------------------------------------------
  // The designer's operations on pages, questions and lists (stage 3)

  /** Labels by language: in the survey's languages, not empty, not too long */
  private checkedLabels(labels: Record<string, string>): Record<string, string> {
    const languages = this.languages();
    const out: Record<string, string> = {};
    for (const [language, text] of Object.entries(labels ?? {})) {
      if (!languages.includes(language)) throw new SurveyEditError(`The survey has no language ${language}: add it first.`);
      if (typeof text !== 'string' || text.trim() === '') continue;
      if (text.length > MAX_TEXT) throw new SurveyEditError(`A text has at most ${MAX_TEXT} characters.`);
      out[language] = text.trim();
    }
    if (Object.keys(out).length === 0) throw new SurveyEditError('A text is needed in at least one language.');
    return out;
  }

  /** Every name of the schema: a new one is none of them, so conditions and exports name one question */
  private schemaNames(): Set<string> {
    const names = new Set<string>();
    for (const e of descendants(this.schema())) if (isNode(e)) names.add(attrValue(this.doc, e, 'name') ?? '');
    return names;
  }

  /** The tab set of the plot's pages */
  private tabSet(): XmlElement {
    const options = firstChild(this.survey, 'applicationOptions');
    if (options) for (const e of descendants(options)) if (localName(e) === 'tabSet') return e;
    throw new SurveyEditError('The survey has no pages: add them in Collect\'s Survey Designer.');
  }

  /** The prefixed name of a child of the tab set (n0:tab, n0:label) */
  private tabTag(local: string): string {
    const set = this.tabSet();
    return set.name.includes(':') ? `${set.name.slice(0, set.name.indexOf(':'))}:${local}` : local;
  }

  /** A new page, before another or last; its name is made from a new id, as Collect names tabs */
  addPage(labels: Record<string, string>, before?: string): XmlElement {
    const set = this.tabSet();
    const checked = this.checkedLabels(labels);
    const tab = newElement(
      this.tabTag('tab'),
      [['name', `tab_${this.nextId()}`]],
      Object.entries(checked).map(([language, text]) => newElement(this.tabTag('label'), [['xml:lang', language]], [text])),
    );
    const at = before === undefined ? undefined : this.page(before);
    if (at && at.parent !== set) throw new SurveyEditError('A page goes among the pages.');
    insertElement(this.doc, set, tab, at);
    return tab;
  }

  movePage(name: string, before?: string): void {
    const tab = this.page(name);
    const at = before === undefined ? undefined : this.page(before);
    if (at === tab) return;
    if (at && at.parent !== tab.parent) throw new SurveyEditError('A page moves among the pages.');
    moveElement(this.doc, tab, at);
  }

  /** The page of a question of the plot: its own, else the plot's */
  private pageOf(e: XmlElement): string | undefined {
    const prefix = this.uiPrefix();
    if (!prefix) return undefined;
    return attrValue(this.doc, e, `${prefix}:tab`) ?? attrValue(this.doc, this.rootEntity(), `${prefix}:tab`);
  }

  deletePage(name: string): void {
    const tab = this.page(name);
    const prefix = this.uiPrefix();
    for (const e of descendants(this.rootEntity())) {
      if (prefix && attrValue(this.doc, e, `${prefix}:tab`) === name) throw new SurveyEditError('Only a page nothing is on can be deleted: move its questions first.');
    }
    if (childElements(tab).some((c) => localName(c) === 'tab')) throw new SurveyEditError('The page has pages inside it.');
    removeElement(tab);
  }

  /**
   * Where a question goes on a page of the plot: before `before` (of the same parent), else after the last question of
   * that page, else last. The element to insert it before; undefined: at the end.
   */
  private placeOnPage(parent: XmlElement, page: string | undefined, moving: XmlElement | null, before?: number): XmlElement | undefined {
    if (before !== undefined) {
      const at = this.nodeById(before);
      if (at.parent !== parent) throw new SurveyEditError('A question goes before another of the same page or table.');
      return at;
    }
    const nodes = childElements(parent).filter((c) => isNode(c) && c !== moving);
    if (parent === this.rootEntity() && page !== undefined) {
      const onPage = nodes.filter((n) => this.pageOf(n) === page);
      const last = onPage[onPage.length - 1];
      if (last) return nodes[nodes.indexOf(last) + 1];
    }
    return undefined;
  }

  /** A question added to a page of the plot, or a column to a table */
  addNewQuestion(op: Extract<SurveyOperation, { op: 'addQuestion' }>): XmlElement {
    const parent = op.table === undefined ? this.rootEntity() : this.nodeById(op.table);
    if (parent.name !== 'entity') throw new SurveyEditError('A column goes into a table.');
    if (parent === this.rootEntity() && op.page === undefined) throw new SurveyEditError('A question goes on a page.');
    if (op.page !== undefined) this.page(op.page);
    const labels = this.checkedLabels(op.label);
    const name = op.name ?? this.nameFrom(labels, 'question');
    checkName(name);
    if (this.schemaNames().has(name)) throw new SurveyEditError(`There is a question ${name} already.`);
    const attrs: Array<[string, string]> = [['id', String(this.nextId())], ['name', name]];
    if (op.required) attrs.push(['required', 'true']);
    const prefix = this.uiPrefix();
    if (parent === this.rootEntity()) {
      if (!prefix) throw new SurveyEditError('The survey has no pages: add them in Collect\'s Survey Designer.');
      attrs.push([`${prefix}:tab`, op.page!]);
    }
    const tags: Record<string, [string, Array<[string, string]>]> = {
      choice: ['code', []],
      choices: ['code', [['multiple', 'true']]],
      yesNo: ['boolean', []],
      integer: ['number', [['type', 'integer']]],
      decimal: ['number', [['type', 'real']]],
      text: ['text', [['type', 'short']]],
      memo: ['text', [['type', 'memo']]],
      date: ['date', []],
    };
    const kind = tags[op.type];
    if (!kind) throw new SurveyEditError(`The designer adds no question of type ${op.type}.`);
    attrs.push(...kind[1]);
    if (kind[0] === 'code') {
      if (op.parent !== undefined) {
        // A sub-list: the answers under the answer given to another question of the same place
        const of = childElements(parent).find((c) => c.name === 'code' && attrValue(this.doc, c, 'name') === op.parent);
        if (!of) throw new SurveyEditError(`A sub-list follows a choice of the same page or table: ${op.parent} is not one.`);
        if (attrValue(this.doc, of, 'multiple') === 'true') throw new SurveyEditError(`${op.parent} takes several answers: a sub-list follows a question of one answer.`);
        const list = attrValue(this.doc, of, 'list') ?? '';
        if (op.list !== undefined && op.list !== list) throw new SurveyEditError(`A sub-list takes the list of ${op.parent}.`);
        attrs.push(['list', list], ['parent', op.parent]);
      } else {
        if (!op.list) throw new SurveyEditError('A choice needs its answer list.');
        this.list(op.list);
        attrs.push(['list', op.list]);
      }
    }
    const question = newElement(kind[0], attrs, this.labelsOf(labels, 'instance'));
    insertElement(this.doc, parent, question, this.placeOnPage(parent, op.page, null, op.before));
    return question;
  }

  /** Whether a node holds a value of the plot file (read by its place among them) */
  private fromPlotFile(node: XmlElement): boolean {
    return node.attrs.some((a) => a.name.endsWith(':fromcsv') && attrValue(this.doc, node, a.name) === 'true');
  }

  /**
   * Refuses to move or delete a key, a field Collect Earth fills or a value of the plot file: Collect Earth reads the
   * plot's id and the plot file's columns by their order among them
   */
  private keepInPlace(node: XmlElement): void {
    const name = attrValue(this.doc, node, 'name') ?? '';
    if (isFixed(name, attrValue(this.doc, node, 'key') === 'true')) throw new SurveyEditError(`${name} is one of the fields Collect Earth needs.`);
    if (this.fromPlotFile(node)) throw new SurveyEditError(`${name} comes from the plot file, read in the order of its columns: it stays as it is.`);
  }

  moveQuestion(id: number, page?: string, before?: number): void {
    const node = this.nodeById(id);
    this.keepInPlace(node);
    const parent = node.parent!;
    if (page !== undefined) {
      if (parent !== this.rootEntity()) throw new SurveyEditError('A table\'s column stays in its table.');
      this.page(page);
      const prefix = this.uiPrefix();
      if (!prefix) throw new SurveyEditError('The survey has no pages.');
      setAttr(node, `${prefix}:tab`, page);
    }
    const at = this.placeOnPage(parent, page ?? (parent === this.rootEntity() ? this.pageOf(node) : undefined), node, before);
    if (at === node) return;
    moveElement(this.doc, node, at);
  }

  deleteQuestion(id: number): void {
    const node = this.nodeById(id);
    this.keepInPlace(node);
    if (node.name === 'entity') throw new SurveyEditError('A table is deleted with its own button.');
    this.removeQuestion(node);
  }

  /** The prefix the survey gives Collect's own namespace (collect:enumerate), declared when it has none */
  private collectPrefix(): string {
    for (const a of this.survey.attrs) if (a.name.startsWith('xmlns:') && a.raw === COLLECT_NS) return a.name.slice(6);
    setAttr(this.survey, 'xmlns:collect', COLLECT_NS);
    return 'collect';
  }

  /**
   * A table on a page of the plot: one row per answer of the list's first level, the answer as the row's key (as
   * Collect Earth's templates make them: an enumerated multiple entity, laid out as a table). Its columns are added
   * as questions with its id.
   */
  addTable(op: Extract<SurveyOperation, { op: 'addTable' }>): XmlElement {
    const plot = this.rootEntity();
    this.page(op.page);
    const labels = this.checkedLabels(op.label);
    const name = op.name ?? this.nameFrom(labels, 'table');
    checkName(name);
    if (this.schemaNames().has(name)) throw new SurveyEditError(`There is a question ${name} already.`);
    const list = this.list(op.rows);
    if (attrValue(this.doc, list, 'lookup') !== undefined) throw new SurveyEditError(`The answers of ${op.rows} come from a table of the server: rows need a list of the survey.`);
    const items = firstChild(list, 'items');
    if (!items || childrenNamed(items, 'item').length === 0) throw new SurveyEditError(`The list ${op.rows} has no answers to make rows of.`);
    const ui = this.uiPrefix();
    if (!ui) throw new SurveyEditError('The survey has no pages: add them in Collect\'s Survey Designer.');
    const collect = this.collectPrefix();
    const id = this.nextId();
    const taken = this.schemaNames();
    taken.add(name);
    // The row's key: named after the table, labelled with the list's name
    const listLabels: Record<string, string> = {};
    for (const l of childrenNamed(list, 'label')) {
      const language = attrValue(this.doc, l, 'xml:lang') ?? this.languages()[0];
      if (!(language in listLabels)) listLabels[language] = textValue(this.doc, l).trim();
    }
    const keyName = uniqueName(`${name.slice(0, 36)}_row`, taken);
    const key = newElement(
      'code',
      [['id', String(id + 1)], ['name', keyName], ['required', 'true'], ['key', 'true'], ['list', op.rows]],
      this.labelsOf(Object.keys(listLabels).length > 0 ? listLabels : { [this.languages()[0]]: op.rows }, 'instance'),
    );
    const table = newElement(
      'entity',
      [['id', String(id)], ['name', name], ['multiple', 'true'], [`${ui}:tab`, op.page], [`${ui}:layout`, 'table'], [`${collect}:enumerate`, 'true']],
      [...this.labelsOf(labels, 'instance'), key],
    );
    insertElement(this.doc, plot, table, this.placeOnPage(plot, op.page, null, op.before));
    return table;
  }

  /** Deletes a table nothing outside it uses, with its columns */
  deleteTable(id: number): void {
    const table = this.nodeById(id);
    if (table.name !== 'entity' || table === this.rootEntity()) throw new SurveyEditError('Not a table.');
    const names = [table, ...childElements(table).filter(isNode)].map((e) => attrValue(this.doc, e, 'name') ?? '');
    for (const name of names) {
      const users = this.referencesTo(name).filter((e) => !isInside(e, table));
      if (users.length > 0) throw new SurveyEditError(`${name} is used by ${users.map((u) => attrValue(this.doc, nodeOf(u), 'name')).join(', ')}.`);
    }
    removeElement(table);
  }

  setQuestionRequired(id: number, required: boolean | ConditionRows): void {
    const node = this.askedNode(id);
    if (node.name === 'entity') throw new SurveyEditError('A table is not answered itself: its questions are.');
    if (typeof required !== 'boolean' && (required === null || typeof required !== 'object')) throw new SurveyEditError('Required is yes, no or a condition.');
    this.setRequired(node, typeof required === 'boolean' ? required : conditionExpression(this.logicScope(), node, required, false));
  }

  /** A question or table the designer can give logic to: not a field Collect Earth fills, nor a calculated or hidden one */
  private askedNode(id: number): XmlElement {
    const node = this.nodeById(id);
    const name = attrValue(this.doc, node, 'name') ?? '';
    if (node === this.rootEntity()) throw new SurveyEditError('The plot is always there.');
    if (isFixed(name, attrValue(this.doc, node, 'key') === 'true')) throw new SurveyEditError(`${name} is one of the fields Collect Earth needs.`);
    if (attrValue(this.doc, node, 'calculated') === 'true') throw new SurveyEditError('A calculated value is never asked.');
    if (attrValue(this.doc, node, 'relevant')?.trim() === 'false()') throw new SurveyEditError(`${name} is never shown in the form.`);
    return node;
  }

  /** What the logic builder reads: the document, the plot and the lists */
  private logicScope(): LogicScope {
    return {
      doc: this.doc,
      plot: this.rootEntity(),
      list: (name) => {
        const lists = firstChild(this.survey, 'codeLists');
        return lists ? childrenNamed(lists, 'list').find((l) => attrValue(this.doc, l, 'name') === name) : undefined;
      },
    };
  }

  /** When a question or table is shown, from rows; null: always. Refused when shows would depend on each other in a circle. */
  setNodeShownWhen(id: number, when: ConditionRows | null): void {
    const node = this.askedNode(id);
    if (when === null) {
      setAttr(node, 'relevant', undefined);
      return;
    }
    this.setShownWhen(node, conditionExpression(this.logicScope(), node, when, false));
    const cycle = this.shownCycle(attrValue(this.doc, node, 'name') ?? '');
    if (cycle) throw new SurveyEditError(`Shown when would go round in a circle: ${cycle.join(' → ')}.`);
  }

  /** A circle of questions each shown depending on the next, through `start`; null when there is none */
  private shownCycle(start: string): string[] | null {
    const names = this.schemaNames();
    const uses = new Map<string, string[]>();
    for (const e of descendants(this.schema())) {
      const relevant = isNode(e) ? attrValue(this.doc, e, 'relevant') : undefined;
      if (relevant) uses.set(attrValue(this.doc, e, 'name') ?? '', namesUsed(relevant, names));
    }
    const path: string[] = [];
    const seen = new Set<string>();
    const walk = (name: string): boolean => {
      path.push(name);
      for (const next of uses.get(name) ?? []) {
        if (next === start) return true;
        if (!seen.has(next)) {
          seen.add(next);
          if (walk(next)) return true;
        }
      }
      path.pop();
      return false;
    };
    return walk(start) ? [...path, start] : null;
  }

  /** The rules (checks) of a question, in order */
  private rulesOf(node: XmlElement): XmlElement[] {
    return childElements(node).filter((c) => CHECK_TAGS.includes(c.name));
  }

  /**
   * A rule from the builder, after the question's others, or in place of its rule `index`: the messages of the
   * languages not given stay
   */
  putRule(id: number, rule: NewRule, index?: number): XmlElement {
    const node = this.askedNode(id);
    if (node.name === 'entity') throw new SurveyEditError('A rule is on a question: a table\'s are on its columns.');
    if (this.fromPlotFile(node)) throw new SurveyEditError(`${attrValue(this.doc, node, 'name')} comes from the plot file: nobody answers it.`);
    const old = index === undefined ? undefined : this.rulesOf(node)[index];
    if (index !== undefined && !old) throw new SurveyEditError(`The question has no rule ${index + 1}.`);
    const { tag, attrs } = rule.kind === 'expression' ? this.expressionRule(node, rule) : ruleCheck(this.logicScope(), node, rule);
    const languages = this.languages();
    const messages = new Map<string, string>();
    if (old) for (const m of childrenNamed(old, 'message')) messages.set(attrValue(this.doc, m, 'xml:lang') ?? languages[0], textValue(this.doc, m));
    for (const [language, text] of Object.entries(rule.message ?? {})) {
      if (!languages.includes(language)) throw new SurveyEditError(`The survey has no language ${language}: add it first.`);
      if (typeof text !== 'string') continue;
      if (text.length > MAX_TEXT) throw new SurveyEditError(`A text has at most ${MAX_TEXT} characters.`);
      if (text.trim() === '') messages.delete(language);
      else messages.set(language, text.trim());
    }
    const check = newElement(
      tag,
      attrs,
      [...messages].map(([language, text]) => newElement('message', [['xml:lang', language]], [text])),
    );
    if (old) {
      insertElement(this.doc, node, check, old);
      removeElement(old);
    } else {
      this.insertInOrder(node, check, NODE_ORDER, this.rulesOf(node).pop());
    }
    return check;
  }

  /** The survey's identifier (Collect's uri): Collect Earth tells surveys apart by it */
  setUri(uri: string): void {
    const e = firstChild(this.survey, 'uri');
    if (!e) throw new SurveyEditError('The survey has no uri.');
    setText(e, uri);
  }

  /**
   * A list of years (the years list of the templates: a year of change, a base year) from `last` down to `first`, a
   * code and a label each; a calculated base year of the list (its fixed default value) becomes the last year
   */
  setYears(listName: string, first: number, last: number): void {
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1900 || last > 2100 || first > last || last - first > 100) {
      throw new SurveyEditError('The years go from a first year to a last one, between 1900 and 2100.');
    }
    const list = this.list(listName);
    const items = firstChild(list, 'items');
    for (const item of items ? childrenNamed(items, 'item') : []) removeElement(item);
    this.codes.delete(list);
    const languages = this.languages();
    for (let y = last; y >= first; y--) this.addItem(list, String(y), Object.fromEntries(languages.map((l) => [l, String(y)])));
    for (const e of descendants(this.schema())) {
      if (e.name !== 'code' || attrValue(this.doc, e, 'list') !== listName || attrValue(this.doc, e, 'calculated') !== 'true') continue;
      for (const d of childrenNamed(e, 'default')) if (attrValue(this.doc, d, 'value') !== undefined) setAttr(d, 'value', String(last));
    }
  }

  /** A rule written as an expression: a check whose expression the answer must make true */
  private expressionRule(node: XmlElement, rule: Extract<NewRule, { kind: 'expression' }>): { tag: 'check'; attrs: Array<[string, string]> } {
    if (rule.flag !== 'error' && rule.flag !== 'warning') throw new SurveyEditError('A rule is an error or a warning.');
    const text = typeof rule.text === 'string' ? rule.text.trim() : '';
    if (text === '' || text.length > MAX_EXPRESSION) throw new SurveyEditError(`A rule's expression has 1 to ${MAX_EXPRESSION} characters.`);
    const attrs: Array<[string, string]> = [['flag', rule.flag === 'warning' ? 'warn' : 'error']];
    const when = typeof rule.whenText === 'string' ? rule.whenText.trim() : '';
    if (when !== '') attrs.push(['if', this.checked(node, 'boolean', when)]);
    else if (rule.when) attrs.push(['if', conditionExpression(this.logicScope(), node, rule.when, true)]);
    attrs.push(['expr', this.checked(node, 'boolean', text)]);
    return { tag: 'check', attrs };
  }

  /** A show-when or required-when written as an expression, checked as Collect checks it; null takes it away */
  setExpressionText(id: number, part: 'shownWhen' | 'required', text: string | null): void {
    const node = this.askedNode(id);
    const value = text === null ? '' : text.trim();
    if (value.length > MAX_EXPRESSION) throw new SurveyEditError(`An expression has at most ${MAX_EXPRESSION} characters.`);
    if (part === 'required') {
      if (node.name === 'entity') throw new SurveyEditError('A table is not answered itself: its questions are.');
      this.setRequired(node, value === '' ? false : value);
      return;
    }
    if (value === '') {
      setAttr(node, 'relevant', undefined);
      return;
    }
    this.setShownWhen(node, value);
    const cycle = this.shownCycle(attrValue(this.doc, node, 'name') ?? '');
    if (cycle) throw new SurveyEditError(`Shown when would go round in a circle: ${cycle.join(' → ')}.`);
  }

  /**
   * A calculated value's formulas, replacing its own: each a value or an expression, with its condition; the first that
   * holds gives the value (Collect's default values of a calculated attribute)
   */
  setFormulas(id: number, formulas: ReadonlyArray<{ expression?: string; value?: string; when?: string }>): void {
    const node = this.nodeById(id);
    if (attrValue(this.doc, node, 'calculated') !== 'true') throw new SurveyEditError('Only a calculated value has formulas.');
    if (!Array.isArray(formulas) || formulas.length === 0 || formulas.length > 100) throw new SurveyEditError('A calculated value has 1 to 100 formulas.');
    const list = node.name === 'code' ? this.logicScope().list(attrValue(this.doc, node, 'list') ?? '') : undefined;
    const elements = formulas.map((f, i) => {
      const expression = typeof f.expression === 'string' ? f.expression.trim() : '';
      const value = typeof f.value === 'string' ? f.value.trim() : '';
      const when = typeof f.when === 'string' ? f.when.trim() : '';
      if ((expression === '') === (value === '')) throw new SurveyEditError(`Formula ${i + 1} gives a value or an expression.`);
      if ([expression, value, when].some((x) => x.length > MAX_EXPRESSION)) throw new SurveyEditError(`A formula has at most ${MAX_EXPRESSION} characters.`);
      const attrs: Array<[string, string]> = [];
      if (expression !== '') attrs.push(['expr', this.checked(node, 'value', expression)]);
      else {
        // A value as it is: one of the list's codes, a number, yes or no
        if (list && !listCodes(this.doc, list).has(value)) throw new SurveyEditError(`Formula ${i + 1}: the list has no code ${value}.`);
        if (node.name === 'number' && !/^-?\d+(\.\d+)?$/.test(value)) throw new SurveyEditError(`Formula ${i + 1}: ${value} is not a number.`);
        if (node.name === 'boolean' && value !== 'true' && value !== 'false') throw new SurveyEditError(`Formula ${i + 1}: a yes/no value is true or false.`);
        attrs.push(['value', value]);
      }
      if (when !== '') attrs.push(['if', this.checked(node, 'boolean', when)]);
      return newElement('default', attrs);
    });
    for (const d of childrenNamed(node, 'default')) removeElement(d);
    let after = childElements(node).filter((c) => ['label', 'description', 'prompt', 'fieldLabel'].includes(c.name)).pop();
    for (const e of elements) {
      this.insertInOrder(node, e, NODE_ORDER, after);
      after = e;
    }
  }

  /** An expression typed in the designer, checked as Collect checks it, from the place of a question or table */
  checkText(id: number, kind: ExpressionKind, text: string) {
    return checkExpression(this.schemaNode(this.nodeById(id)), kind, text);
  }

  deleteRule(id: number, index: number): void {
    const node = this.nodeById(id);
    const rule = this.rulesOf(node)[index];
    if (!rule) throw new SurveyEditError(`The question has no rule ${index + 1}.`);
    removeElement(rule);
  }

  /** A new answer list with its answers, its name made from its label when not given */
  addNewList(labels: Record<string, string>, items: Array<{ code: string; label: Record<string, string> }>, name?: string): XmlElement {
    const checked = this.checkedLabels(labels);
    const lists = firstChild(this.survey, 'codeLists');
    const taken = new Set(lists ? childrenNamed(lists, 'list').map((l) => attrValue(this.doc, l, 'name') ?? '') : []);
    const listName = name ?? uniqueName(slugName(Object.values(checked)[0], 'list'), taken);
    const list = this.addList(listName, []);
    for (const [language, text] of Object.entries(checked)) this.setLocalized(list, 'label', language, text, 'item', LIST_ORDER);
    for (const item of items ?? []) this.addItem(list, item.code, this.checkedLabels(item.label));
    return list;
  }

  /** Deletes an answer; refused while a condition, rule or formula compares a question of its list with its code */
  deleteItem(listName: string, code: string): void {
    const list = this.list(listName);
    const item = this.item(list, code);
    if (childrenNamed(item, 'item').length > 0) throw new SurveyEditError(`The answer ${code} has answers under it: delete them first.`);
    const users = codeUsers(this.doc, this.schema()).get(listName)?.get(code);
    if (users && users.size > 0) throw new SurveyEditError(`The answer ${code} is used by ${[...users].join(', ')}: change that first.`);
    removeElement(item);
    this.codeIndex(list).delete(code);
  }

  /** A name made from a label, unused in the schema */
  private nameFrom(labels: Record<string, string>, fallback: string): string {
    const text = labels[this.languages()[0]] ?? Object.values(labels)[0] ?? '';
    return uniqueName(slugName(text, fallback), this.schemaNames());
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

  /**
   * An item at the end of a list's first level, or of the answers under another (`under`: a sub-list's answers), or
   * before one of the same level; its code is the list's only one of that code
   */
  addItem(list: XmlElement, code: string, labels: Record<string, string>, before?: XmlElement, under?: XmlElement): XmlElement {
    if (!/^[A-Za-z0-9_.-]+$/.test(code)) throw new SurveyEditError(`The code ${code} has characters a code cannot have.`);
    let items = firstChild(list, 'items');
    if (!items) {
      items = newElement('items');
      insertElement(this.doc, list, items);
    }
    const index = this.codeIndex(list);
    if (index.has(code)) throw new SurveyEditError(`The list has a code ${code} already.`);
    const parent = under ?? items;
    if (before && before.parent !== parent) throw new SurveyEditError('An answer goes before another of the same level.');
    const item = newElement('item', [['id', String(this.nextId())]], [newElement('code', [], [code]), ...this.labelsOf(labels, undefined)]);
    insertElement(this.doc, parent, item, before);
    index.set(code, item);
    if (under) this.ensureLevels(list, this.depthOf(item));
    return item;
  }

  /** An item of a list by its code, at any level */
  item(list: XmlElement, code: string): XmlElement {
    const found = this.codeIndex(list).get(code);
    if (!found) throw new SurveyEditError(`The list has no code ${code}.`);
    return found;
  }

  /** The items of each list by their codes, read once (a list of thousands of answers is not read again per answer) */
  private readonly codes = new WeakMap<XmlElement, Map<string, XmlElement>>();

  private codeIndex(list: XmlElement): Map<string, XmlElement> {
    let index = this.codes.get(list);
    if (!index) {
      index = new Map();
      const items = firstChild(list, 'items');
      for (const i of items ? descendants(items) : []) {
        if (i.name !== 'item') continue;
        const code = textValue(this.doc, firstChild(i, 'code') ?? i).trim();
        if (!index.has(code)) index.set(code, i);
      }
      this.codes.set(list, index);
    }
    return index;
  }

  /** How deep an item is in its list: 1 for an answer of the first level */
  private depthOf(item: XmlElement): number {
    let depth = 0;
    for (let x: XmlElement | null = item; x && x.name === 'item'; x = x.parent) depth++;
    return depth;
  }

  /** The list's levels, named as Collect names them, as deep as its answers go */
  private ensureLevels(list: XmlElement, depth: number): void {
    if (depth < 2) return;
    let hierarchy = firstChild(list, 'hierarchy');
    if (!hierarchy) {
      hierarchy = newElement('hierarchy');
      this.insertInOrder(list, hierarchy, LIST_ORDER);
    }
    const levels = childrenNamed(hierarchy, 'level');
    const taken = new Set(levels.map((l) => attrValue(this.doc, l, 'name') ?? ''));
    for (let n = levels.length + 1; n <= depth; n++) {
      let level = `level${n}`;
      for (let k = 0; taken.has(level); k++) level = `level${n}${String.fromCharCode(97 + k)}`;
      taken.add(level);
      insertElement(this.doc, hierarchy, newElement('level', [['name', level]]));
    }
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

/**
 * A name made from a text as Collect and Collect Earth take names (checkName): lower case ASCII letters, digits and _,
 * starting with a letter, not ending in _ and digits, at most 40 characters
 */
export function slugName(text: string, fallback: string): string {
  let name = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (name === '') name = fallback;
  if (/^[0-9]/.test(name)) name = `${fallback}_${name}`;
  name = name.slice(0, 40).replace(/_+$/, '');
  // "tree_cover_2020" would read as a repeated value's index: "tree_cover2020"
  return name.replace(/_(\d+)$/, '$1');
}

/** A name not taken: the name, else with _b, _c... after it (letters, as digits at the end are refused) */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 1; i < 26 * 26; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    const candidate = `${name.slice(0, 37)}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new SurveyEditError(`No name is left for ${name}.`);
}


/**
 * An operation made on one survey (`from`, the served one) as it reads on another (`to`, the uploaded one), whose
 * ids differ: each question or table it names by id is found again by its path of names; null when one is not there
 * (the operation is then left out there)
 */
export function operationFor(op: SurveyOperation, from: SurveyEdit, to: SurveyEdit): SurveyOperation | null {
  const map = (id: number): number | null => {
    const path = from.pathOf(id);
    return path === null ? null : to.idOfPath(path);
  };
  const mapOptional = (id: number | undefined): number | undefined | null => (id === undefined ? undefined : map(id));
  switch (op.op) {
    case 'setText': {
      const t = op.target;
      if (t.kind === 'node') {
        const id = map(t.id);
        return id === null ? null : { ...op, target: { ...t, id } };
      }
      if (t.kind === 'rule') {
        const node = map(t.node);
        return node === null ? null : { ...op, target: { ...t, node } };
      }
      return op;
    }
    case 'addQuestion': {
      const table = mapOptional(op.table);
      const before = mapOptional(op.before);
      if (table === null) return null;
      return { ...op, table, before: before ?? undefined };
    }
    case 'moveQuestion': {
      const id = map(op.id);
      const before = mapOptional(op.before);
      if (id === null) return null;
      return { ...op, id, before: before ?? undefined };
    }
    case 'addTable': {
      const before = mapOptional(op.before);
      return { ...op, before: before ?? undefined };
    }
    case 'deleteQuestion':
    case 'setRequired':
    case 'setShownWhen':
    case 'addRule':
    case 'setRule':
    case 'deleteRule':
    case 'setExpression':
    case 'setFormulas':
    case 'deleteTable': {
      const id = map(op.id);
      return id === null ? null : { ...op, id };
    }
    default:
      return op;
  }
}
