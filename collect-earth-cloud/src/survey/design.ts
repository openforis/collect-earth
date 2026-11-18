// The designer model (docs/plans/2026-11-18-survey-designer.md, "The model"): a survey read from its lossless tree
// as the designer shows it, with its pages and questions as the interpreter meets them (the rules of the desktop's
// SurveyFormModelBuilder: one page per tab, nested tabs after their parent, the fields Collect Earth fills itself,
// the keys, the plot file's values and the hidden ones kept off the pages), its lists, and its conditions and rules
// in rows where they can be. Read only: nothing here changes the survey.

import type {
  DesignCondition,
  DesignItem,
  DesignList,
  DesignListItem,
  DesignPage,
  DesignQuestion,
  DesignRule,
  DesignTable,
  Formula,
  Localized,
  QuestionType,
  RuleBound,
  SurveyDesign,
} from '../wire/survey.js';
import { namesUsed, readCondition, type QuestionLookup } from './condition.js';
import { attrValue, childElements, childrenNamed, firstChild, readXml, textValue, type XmlDocument, type XmlElement } from './xmlTree.js';

/** The fields Collect Earth fills itself (SurveyFormModelBuilder.BUILT_IN_ATTRIBUTE_NAMES) */
const BUILT_IN = new Set(['operator', 'location', 'plot_file', 'actively_saved', 'actively_saved_on']);
const ATTRIBUTE_TAGS = new Set(['text', 'number', 'range', 'code', 'boolean', 'date', 'time', 'coordinate', 'taxon', 'file']);
const CHECK_TAGS = new Set(['check', 'compare', 'distance', 'pattern', 'unique']);

const localName = (e: XmlElement) => e.name.slice(e.name.indexOf(':') + 1);

/** An attribute by its local name, whatever prefix the survey gives its namespace (ui:hide, n0:hide…) */
function attrLocal(doc: XmlDocument, e: XmlElement, local: string, prefixes: string[]): string | undefined {
  for (const p of prefixes) {
    const v = attrValue(doc, e, `${p}:${local}`);
    if (v !== undefined) return v;
  }
  return undefined;
}

/** The prefixes the survey's root gives a namespace */
function prefixesOf(doc: XmlDocument, uri: string): string[] {
  return doc.root.attrs.filter((a) => a.name.startsWith('xmlns:') && a.raw === uri).map((a) => a.name.slice(6));
}

/** The survey's designer model, from the bytes of its placemark.idm.xml */
export function surveyDesign(bytes: Uint8Array): SurveyDesign {
  return new DesignReader(readXml(bytes)).read();
}

class DesignReader {
  private readonly ui: string[];
  private readonly collect: string[];
  private readonly earth: string[];
  private readonly languages: string[];
  /** Every node of the schema by its name: what conditions and formulas name */
  private readonly byName = new Map<string, XmlElement>();
  private formulas = 0;

  constructor(private readonly doc: XmlDocument) {
    this.ui = prefixesOf(doc, 'http://www.openforis.org/collect/3.0/ui');
    this.collect = prefixesOf(doc, 'http://www.openforis.org/collect/3.0/collect');
    this.earth = prefixesOf(doc, 'http://www.openforis.org/collect/3.0/collectearth');
    this.languages = childrenNamed(doc.root, 'language').map((l) => textValue(doc, l).trim()).filter((l) => l !== '');
    if (this.languages.length === 0) this.languages.push('en');
  }

  read(): SurveyDesign {
    const schema = firstChild(this.doc.root, 'schema');
    const plot = schema && childrenNamed(schema, 'entity')[0];
    if (!plot) throw new Error('The survey has no plot.');
    const walk = (e: XmlElement) => {
      for (const c of childElements(e)) {
        if (c.name === 'entity' || ATTRIBUTE_TAGS.has(c.name)) {
          const name = attrValue(this.doc, c, 'name');
          if (name && !this.byName.has(name)) this.byName.set(name, c);
          if (c.name === 'entity') walk(c);
        }
      }
    };
    walk(plot);

    const tabs = this.tabs();
    const rootTab = attrLocal(this.doc, plot, 'tab', this.ui);
    const pages = new Map<string, DesignPage>(tabs.map((t) => [t.name, { name: t.name, label: t.label, items: [] }]));
    const fallbackPage = (): DesignPage => {
      const name = rootTab !== undefined && pages.has(rootTab) ? rootTab : (tabs[0]?.name ?? '');
      let page = pages.get(name);
      if (!page) {
        page = { name, label: this.labels(plot, 'instance'), items: [] };
        pages.set(name, page);
      }
      return page;
    };
    const fromPlotFile: DesignQuestion[] = [];
    const calculated: DesignQuestion[] = [];
    const hidden: DesignQuestion[] = [];
    for (const node of childElements(plot)) {
      if (node.name !== 'entity' && !ATTRIBUTE_TAGS.has(node.name)) continue;
      const tab = attrLocal(this.doc, node, 'tab', this.ui);
      const page = (tab !== undefined ? pages.get(tab) : undefined) ?? fallbackPage();
      if (node.name === 'entity') {
        const table = this.table(node, plot);
        // A hidden table is left off the form, as the desktop does (SurveyFormModelBuilder.addEntityItem)
        if (attrLocal(this.doc, node, 'hide', this.ui) === 'true' || table.shownWhen?.kind === 'never') hidden.push(...table.columns);
        else page.items.push(table);
        continue;
      }
      const q = this.question(node, plot);
      if (q.formulas) calculated.push(q);
      else if (q.fromPlotFile) fromPlotFile.push(q);
      else if (q.hidden || q.key || BUILT_IN.has(q.name)) hidden.push(q);
      else page.items.push(q);
    }
    const lists = this.lists();
    return {
      languages: this.languages,
      title: this.localized(this.doc.root, 'project'),
      pages: [...pages.values()].filter((p) => p.items.length > 0),
      fromPlotFile,
      calculated,
      hidden,
      lists,
      counts: { formulas: this.formulas },
    };
  }

  /** The tabs of the root's tab set, nested ones after their parent, named "Parent › Child" */
  private tabs(): Array<{ name: string; label: Localized }> {
    const options = firstChild(this.doc.root, 'applicationOptions');
    const out: Array<{ name: string; label: Localized }> = [];
    const tabSet = options && this.findLocal(options, 'tabSet');
    const add = (tab: XmlElement, parent: Localized | null) => {
      const own: Localized = {};
      for (const l of childElements(tab).filter((c) => localName(c) === 'label')) {
        own[attrValue(this.doc, l, 'xml:lang') ?? this.languages[0]] = textValue(this.doc, l).trim();
      }
      const label: Localized = {};
      for (const language of new Set([...Object.keys(own), ...Object.keys(parent ?? {})])) {
        const mine = own[language] ?? own[this.languages[0]] ?? '';
        label[language] = parent ? `${parent[language] ?? parent[this.languages[0]] ?? ''} › ${mine}` : mine;
      }
      const name = attrValue(this.doc, tab, 'name');
      if (name) out.push({ name, label });
      for (const child of childElements(tab).filter((c) => localName(c) === 'tab')) add(child, label);
    };
    for (const tab of tabSet ? childElements(tabSet).filter((c) => localName(c) === 'tab') : []) add(tab, null);
    return out;
  }

  private findLocal(e: XmlElement, local: string): XmlElement | undefined {
    for (const c of childElements(e)) {
      if (localName(c) === local) return c;
      const inner = this.findLocal(c, local);
      if (inner) return inner;
    }
    return undefined;
  }

  /** Labels of a kind (instance, item…), or with no kind when none has it */
  private labels(e: XmlElement, type: string): Localized {
    const all = childrenNamed(e, 'label');
    const typed = all.filter((l) => attrValue(this.doc, l, 'type') === type);
    return this.localizedOf(typed.length > 0 ? typed : all.filter((l) => attrValue(this.doc, l, 'type') === undefined));
  }

  private localized(e: XmlElement, tag: string): Localized {
    return this.localizedOf(childrenNamed(e, tag));
  }

  private localizedOf(elements: XmlElement[]): Localized {
    const out: Localized = {};
    for (const l of elements) {
      const language = attrValue(this.doc, l, 'xml:lang') ?? this.languages[0];
      if (!(language in out)) out[language] = textValue(this.doc, l).trim();
    }
    return out;
  }

  /** What the condition reader needs: questions of the entity first, then of the plot */
  private lookup(scope: XmlElement, plot: XmlElement): QuestionLookup {
    return (name) => {
      for (const where of scope === plot ? [plot] : [scope, plot]) {
        const found = childElements(where).find((c) => ATTRIBUTE_TAGS.has(c.name) && attrValue(this.doc, c, 'name') === name);
        if (found) return { yesNo: found.name === 'boolean' };
      }
      return undefined;
    };
  }

  private condition(text: string | undefined, scope: XmlElement, plot: XmlElement): DesignCondition | null {
    if (text === undefined || text.trim() === '' || text.trim() === 'true()') return null;
    return readCondition(text, this.lookup(scope, plot));
  }

  private typeOf(e: XmlElement): QuestionType {
    switch (e.name) {
      case 'code':
        return attrValue(this.doc, e, 'multiple') === 'true' ? 'choices' : 'choice';
      case 'boolean':
        return 'yesNo';
      case 'number':
        return attrValue(this.doc, e, 'type') === 'real' ? 'decimal' : 'integer';
      case 'text':
        return attrValue(this.doc, e, 'type') === 'memo' ? 'memo' : 'text';
      case 'taxon':
        return 'species';
      default:
        return e.name as QuestionType;
    }
  }

  private question(e: XmlElement, plot: XmlElement): DesignQuestion {
    const scope = e.parent ?? plot;
    const required = attrValue(this.doc, e, 'required') === 'true' || attrValue(this.doc, e, 'requiredIf')?.trim() === 'true()';
    const requiredIf = attrValue(this.doc, e, 'requiredIf');
    const relevant = attrValue(this.doc, e, 'relevant');
    const layoutType = attrLocal(this.doc, e, 'layoutType', this.ui);
    const isCalculated = attrValue(this.doc, e, 'calculated') === 'true';
    const formulas: Formula[] = [];
    const used = new Set<string>();
    for (const d of childrenNamed(e, 'default')) {
      const formula: Formula = {
        value: attrValue(this.doc, d, 'value') ?? null,
        expression: attrValue(this.doc, d, 'expr') ?? null,
        when: attrValue(this.doc, d, 'if') ?? null,
      };
      formulas.push(formula);
      for (const text of [formula.expression, formula.when]) {
        if (text) for (const n of namesUsed(text, new Set(this.byName.keys()))) used.add(n);
      }
    }
    if (isCalculated) this.formulas += formulas.length;
    const parentExpr = attrValue(this.doc, e, 'parent');
    const shownWhen = relevant !== undefined && relevant.trim() !== '' ? this.condition(relevant, scope, plot) : null;
    return {
      kind: 'question',
      id: Number(attrValue(this.doc, e, 'id')),
      name: attrValue(this.doc, e, 'name') ?? '',
      type: this.typeOf(e),
      label: this.labels(e, 'instance'),
      help: this.localized(e, 'description'),
      list: attrValue(this.doc, e, 'list') ?? null,
      parentQuestion: parentExpr ? (/([a-z][a-z0-9_]*)\s*$/.exec(parentExpr)?.[1] ?? parentExpr) : null,
      layout: layoutType === 'radio' ? 'buttons' : layoutType === 'dropdown' ? 'dropdown' : null,
      required: required ? 'always' : requiredIf ? { when: this.condition(requiredIf, scope, plot) ?? { kind: 'all', parts: [] } } : 'never',
      shownWhen,
      rules: childElements(e)
        .filter((c) => CHECK_TAGS.has(c.name))
        .map((c) => this.rule(c, scope, plot)),
      key: attrValue(this.doc, e, 'key') === 'true',
      fromPlotFile: attrLocal(this.doc, e, 'fromcsv', this.earth) === 'true',
      hidden: attrLocal(this.doc, e, 'hide', this.ui) === 'true' || shownWhen?.kind === 'never',
      formulas: isCalculated ? formulas : null,
      uses: isCalculated ? [...used] : [],
      notExported: attrLocal(this.doc, e, 'includeInDataExport', this.collect) === 'false',
    };
  }

  private rule(c: XmlElement, scope: XmlElement, plot: XmlElement): DesignRule {
    const base = {
      flag: attrValue(this.doc, c, 'flag') === 'warning' ? ('warning' as const) : ('error' as const),
      message: this.localized(c, 'message'),
      when: this.condition(attrValue(this.doc, c, 'if'), scope, plot),
    };
    if (c.name === 'compare') {
      const bound = (name: string): { bound: RuleBound; inclusive: boolean } | null => {
        for (const [attr, inclusive] of [[`${name}e`, true], [name, false]] as const) {
          const v = attrValue(this.doc, c, attr)?.trim();
          if (v === undefined || v === '') continue;
          if (/^-?\d+(\.\d+)?$/.test(v)) return { bound: { number: Number(v) }, inclusive };
          if (this.lookup(scope, plot)(v.replace(/^parent\(\)\//, ''))) return { bound: { question: v.replace(/^parent\(\)\//, '') }, inclusive };
          return { bound: { expression: v }, inclusive };
        }
        return null;
      };
      // gt / gte: the answer is above; lt / lte: below
      return { ...base, kind: 'range', min: bound('gt'), max: bound('lt') };
    }
    const text =
      c.name === 'check'
        ? (attrValue(this.doc, c, 'expr') ?? '')
        : c.attrs
            .filter((a) => a.name !== 'flag' && a.name !== 'if')
            .map((a) => `${c.name} ${a.name}=${attrValue(this.doc, c, a.name)}`)
            .join(', ');
    return { ...base, kind: 'advanced', text: text.trim() };
  }

  private table(e: XmlElement, plot: XmlElement): DesignTable {
    const multiple = attrValue(this.doc, e, 'multiple') === 'true';
    const enumerated = attrLocal(this.doc, e, 'enumerate', this.collect) === 'true';
    const keyCode = childrenNamed(e, 'code').find((c) => attrValue(this.doc, c, 'key') === 'true');
    const layout = attrLocal(this.doc, e, 'layout', this.ui);
    const relevant = attrValue(this.doc, e, 'relevant');
    return {
      kind: 'table',
      id: Number(attrValue(this.doc, e, 'id')),
      name: attrValue(this.doc, e, 'name') ?? '',
      label: this.labels(e, 'instance'),
      help: this.localized(e, 'description'),
      rowsList: enumerated && keyCode ? (attrValue(this.doc, keyCode, 'list') ?? null) : null,
      layout: !multiple ? 'group' : layout === 'table' ? 'table' : 'block',
      shownWhen: this.condition(relevant, plot, plot),
      columns: childElements(e)
        .filter((c) => ATTRIBUTE_TAGS.has(c.name))
        .map((c) => this.question(c, plot)),
    };
  }

  private lists(): DesignList[] {
    const lists = firstChild(this.doc.root, 'codeLists');
    const usedBy = new Map<string, string[]>();
    for (const [name, node] of this.byName) {
      if (node.name !== 'code') continue;
      const list = attrValue(this.doc, node, 'list');
      if (list) usedBy.set(list, [...(usedBy.get(list) ?? []), name]);
    }
    const items = (parent: XmlElement | undefined): DesignListItem[] =>
      (parent ? childrenNamed(parent, 'item') : []).map((i) => ({
        code: textValue(this.doc, firstChild(i, 'code') ?? i).trim(),
        label: this.localized(i, 'label'),
        help: this.localized(i, 'description'),
        items: items(i),
      }));
    return (lists ? childrenNamed(lists, 'list') : []).map((l) => {
      const name = attrValue(this.doc, l, 'name') ?? '';
      return {
        id: Number(attrValue(this.doc, l, 'id')),
        name,
        label: this.labels(l, 'item'),
        items: items(firstChild(l, 'items')),
        external: attrValue(this.doc, l, 'lookup') !== undefined,
        usedBy: usedBy.get(name) ?? [],
      };
    });
  }
}

/** Every item of a page, tables' columns included (for counts and tests) */
export function pageQuestions(items: DesignItem[]): DesignQuestion[] {
  return items.flatMap((i) => (i.kind === 'table' ? i.columns : [i]));
}
