// The survey designer's stage 2 (docs/plans/2026-11-18-survey-designer.md): the words changed in the dashboard before
// they are saved. Each text is kept by what it belongs to, its part and its language, with the text it had, so that
// only what differs is sent, and a text typed back to what it was is no change.

import type { DesignItem, DesignListItem, DesignQuestion, DesignRule, Localized, NewItem, SurveyDesign, SurveyOperation, WordTarget } from "../api";

export type WordPart = "label" | "help" | "message";

export interface PendingText {
  target: WordTarget;
  part: WordPart;
  language: string;
  text: string;
  /** The text it had when the survey was read */
  current: string;
  /**
   * A rule's message: the rule it was typed for (ruleAnchor), found by its place among the question's rules; a text
   * whose place now holds another rule is dropped rather than written on that one
   */
  anchor?: string;
}

/** What a rule is, its message left out: a text typed for its message is aimed at it */
export function ruleAnchor(rule: DesignRule): string {
  return JSON.stringify({ ...rule, message: undefined });
}

/** The rules of each question of the survey, by its id */
export function rulesById(design: SurveyDesign): Map<number, readonly DesignRule[]> {
  const out = new Map<number, readonly DesignRule[]>();
  const add = (q: DesignQuestion) => out.set(q.id, q.rules);
  for (const p of design.pages) for (const i of p.items) (i.kind === "table" ? i.columns : [i]).forEach(add);
  [...design.fromPlotFile, ...design.calculated, ...design.hidden].forEach(add);
  return out;
}

/** Where a rule is now among a question's rules, found by what it is; null when it is not there, or not once */
export function ruleIndexOf(rules: readonly DesignRule[], anchor: string): number | null {
  const found = rules.flatMap((r, i) => (ruleAnchor(r) === anchor ? [i] : []));
  return found.length === 1 ? found[0] : null;
}

/** The key of a text: what it belongs to, its part and its language */
export function editKey(target: WordTarget, part: WordPart, language: string): string {
  return JSON.stringify([target, part, language]);
}

/** The texts changed, a text set back to what it was left out */
export function changedTexts(pending: ReadonlyMap<string, PendingText>): PendingText[] {
  return [...pending.values()].filter((p) => p.text.trim() !== p.current.trim());
}

/** What is sent to the server: the languages added first, so the texts in them can be written */
export function operationsOf(pending: ReadonlyMap<string, PendingText>, addedLanguages: readonly string[] = []): SurveyOperation[] {
  return [
    ...addedLanguages.map((language): SurveyOperation => ({ op: "addLanguage", language })),
    ...changedTexts(pending).map((p): SurveyOperation => ({ op: "setText", target: p.target, part: p.part, language: p.language, text: p.text.trim() })),
  ];
}

/** A pending text set, or taken away when it is back to what it was */
export function withText(pending: ReadonlyMap<string, PendingText>, change: PendingText): Map<string, PendingText> {
  const next = new Map(pending);
  const key = editKey(change.target, change.part, change.language);
  if (change.text === change.current) next.delete(key);
  else next.set(key, change);
  return next;
}

/**
 * The texts typed and not saved yet, kept outside React's state: a field reads its own text (useSyncExternalStore with
 * `get`), so a keystroke re-renders that field and what counts the changes, not the whole survey. Each change replaces
 * the map, so `all()` is a snapshot.
 */
export class PendingTexts {
  private texts: ReadonlyMap<string, PendingText> = new Map();
  private readonly listeners = new Set<() => void>();
  /** A field's own listeners: told only when its text changes (a keystroke re-renders one field, not every one) */
  private readonly keyListeners = new Map<string, Set<() => void>>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Listens to one text only */
  subscribeKey(key: string, listener: () => void): () => void {
    let set = this.keyListeners.get(key);
    if (!set) this.keyListeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.keyListeners.delete(key);
    };
  }

  all = (): ReadonlyMap<string, PendingText> => this.texts;

  get = (key: string): PendingText | undefined => this.texts.get(key);

  /** Some text changed, or more than one (a spreadsheet read) */
  set(...changes: PendingText[]): void {
    if (changes.length === 0) return;
    this.replace(changes.reduce<ReadonlyMap<string, PendingText>>((acc, change) => withText(acc, change), this.texts));
  }

  clear(): void {
    if (this.texts.size > 0) this.replace(new Map());
  }

  /**
   * After a save, or the survey read again: the texts sent leave when they still read as they were sent (one typed
   * further meanwhile stays), and the others are compared with the survey as it is now (a text now equal to it is no
   * change any more). A text whose question, page, list, answer or rule is no longer there is dropped (it could never
   * be saved): answers how many were.
   */
  settle(design: SurveyDesign, sent: readonly PendingText[] = []): number {
    const next = new Map(this.texts);
    for (const p of sent) {
      const key = editKey(p.target, p.part, p.language);
      if (next.get(key)?.text.trim() === p.text.trim()) next.delete(key);
    }
    const texts = surveyTexts(design);
    const rules = rulesById(design);
    let dropped = 0;
    for (const [key, p] of next) {
      const now = textOf(texts, p.target, p.part, p.language);
      const t = p.target;
      const moved = t.kind === "rule" && p.anchor !== undefined && (() => {
        const rule = rules.get(t.node)?.[t.index];
        return !rule || ruleAnchor(rule) !== p.anchor;
      })();
      if (now === undefined || moved) {
        next.delete(key);
        dropped++;
      } else if (p.text.trim() === now.trim()) next.delete(key);
      else if (now !== p.current) next.set(key, { ...p, current: now });
    }
    this.replace(next);
    return dropped;
  }

  /**
   * Before settling after changes saved from here: a rule deleted takes its texts with it, and the texts of the rules
   * after it follow them to their new place (one up). Answers how many texts were dropped.
   */
  afterOps(ops: readonly SurveyOperation[]): number {
    let next = this.texts;
    let dropped = 0;
    for (const op of ops) {
      if (op.op !== "deleteRule") continue;
      const out = new Map<string, PendingText>();
      for (const [key, p] of next) {
        const t = p.target;
        if (t.kind !== "rule" || t.node !== op.id || t.index < op.index) out.set(key, p);
        else if (t.index === op.index) dropped++;
        else {
          const target: WordTarget = { kind: "rule", node: t.node, index: t.index - 1 };
          out.set(editKey(target, p.part, p.language), { ...p, target });
        }
      }
      next = out;
    }
    if (next !== this.texts) this.replace(next);
    return dropped;
  }

  private replace(texts: ReadonlyMap<string, PendingText>): void {
    const before = this.texts;
    this.texts = texts;
    for (const [key, set] of this.keyListeners) {
      if (before.get(key) !== texts.get(key)) for (const l of [...set]) l();
    }
    for (const l of [...this.listeners]) l();
  }
}

/** A target's key, whatever the order of its fields */
export function targetKey(target: WordTarget, part: WordPart): string {
  switch (target.kind) {
    case "title":
      return `title|${part}`;
    case "page":
      return `page|${target.name}|${part}`;
    case "node":
      return `node|${target.id}|${part}`;
    case "list":
      return `list|${target.name}|${part}`;
    case "item":
      return `item|${target.list}|${target.code}|${part}`;
    case "rule":
      return `rule|${target.node}|${target.index}|${part}`;
  }
}

/**
 * The survey with its texts changed by `change(key, text)`, key as targetKey gives it: each text of the survey is
 * offered once, and kept as it is when `change` answers it unchanged
 */
function mapTexts(design: SurveyDesign, change: (key: string, text: Localized) => Localized): SurveyDesign {
  const question = (q: DesignQuestion): DesignQuestion => ({
    ...q,
    label: change(targetKey({ kind: "node", id: q.id }, "label"), q.label),
    help: change(targetKey({ kind: "node", id: q.id }, "help"), q.help),
    rules: q.rules.map((r, index) => ({ ...r, message: change(targetKey({ kind: "rule", node: q.id, index }, "message"), r.message) })),
  });
  const items = (list: string, all: readonly DesignListItem[]): DesignListItem[] =>
    all.map((i) => ({
      ...i,
      label: change(targetKey({ kind: "item", list, code: i.code }, "label"), i.label),
      help: change(targetKey({ kind: "item", list, code: i.code }, "help"), i.help),
      items: items(list, i.items),
    }));
  return {
    ...design,
    title: change(targetKey({ kind: "title" }, "label"), design.title),
    pages: design.pages.map((p) => ({
      ...p,
      label: change(targetKey({ kind: "page", name: p.name }, "label"), p.label),
      items: p.items.map((i) =>
        i.kind === "table"
          ? {
              ...i,
              label: change(targetKey({ kind: "node", id: i.id }, "label"), i.label),
              help: change(targetKey({ kind: "node", id: i.id }, "help"), i.help),
              columns: i.columns.map(question),
            }
          : question(i),
      ),
    })),
    emptyPages: design.emptyPages.map((p) => ({ ...p, label: change(targetKey({ kind: "page", name: p.name }, "label"), p.label) })),
    fromPlotFile: design.fromPlotFile.map(question),
    calculated: design.calculated.map(question),
    hidden: design.hidden.map(question),
    lists: design.lists.map((l) => ({ ...l, label: change(targetKey({ kind: "list", name: l.name }, "label"), l.label), items: items(l.name, l.items) })),
  };
}

/** Every text of the survey by targetKey */
export function surveyTexts(design: SurveyDesign): Map<string, Localized> {
  const out = new Map<string, Localized>();
  mapTexts(design, (key, text) => {
    out.set(key, text);
    return text;
  });
  return out;
}

/** A text of the survey as it is now in a language ("" when it has none there); undefined when the survey has no such text */
export function textOf(texts: ReadonlyMap<string, Localized>, target: WordTarget, part: WordPart, language: string): string | undefined {
  const text = texts.get(targetKey(target, part));
  return text === undefined ? undefined : (text[language] ?? "");
}

/** The survey as it reads with the texts typed and not saved yet (the preview shows them) */
export function withPendingTexts(design: SurveyDesign, pending: Iterable<PendingText>): SurveyDesign {
  const byKey = new Map<string, PendingText[]>();
  for (const p of pending) {
    const key = targetKey(p.target, p.part);
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  if (byKey.size === 0) return design;
  return mapTexts(design, (key, text) => {
    const changes = byKey.get(key);
    return changes ? { ...text, ...Object.fromEntries(changes.map((p) => [p.language, p.text.trim()])) } : text;
  });
}

/** The languages a survey is commonly translated into, offered first when a language is added (ISO 639-1) */
export const COMMON_LANGUAGES = [
  "en", "es", "fr", "pt", "ar", "ru", "zh", "hi", "bn", "id", "ms", "vi", "th", "km", "lo", "my", "ne", "si", "ta", "ur",
  "fa", "ps", "tr", "sw", "am", "ha", "yo", "ig", "so", "rw", "mg", "uk", "ka", "hy", "az", "kk", "uz", "mn", "tl",
] as const;

/** A language code as the survey writes it: two or three letters, a country after _ when needed (pt_BR) */
export const isLanguageCode = (code: string): boolean => /^[a-z]{2,3}(_[A-Z]{2})?$/.test(code);

/**
 * A name or code made from a text as the survey takes them (the server's slugName): lower case ASCII letters, digits
 * and _, starting with a letter, not ending in _ and digits, at most 40 characters
 */
export function slugName(text: string, fallback: string): string {
  let name = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (name === "") name = fallback;
  if (/^[0-9]/.test(name)) name = `${fallback}_${name}`;
  name = name.slice(0, 40).replace(/_+$/, "");
  return name.replace(/_(\d+)$/, "$1");
}

/** A name not taken: the name, else with _b, _c... after it (the server's uniqueName) */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 1; i < 26 * 26; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    const candidate = `${name.slice(0, 37)}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return name;
}

/**
 * Answers typed or pasted one per line, in a language; blank lines left out. A row copied from a spreadsheet, code then
 * answer (a tab between), keeps its code; the others get one made from their text, none of `taken` nor of each other's.
 * `bad`: the codes given that cannot be taken (not a code, one of `taken`, or given twice).
 */
export function itemsFromLines(text: string, language: string, taken: ReadonlySet<string> = new Set()): { items: NewItem[]; bad: string[] } {
  const rows = text.split(/\r?\n/).flatMap((line): Array<{ code: string | null; label: string }> => {
    // shortcut: the cells after the second are left out; a spreadsheet's third column would need its own place
    const [first = "", second = ""] = line.split("\t").map((c) => c.trim());
    // A row with one text only is an answer whose code is made from it
    if (first === "" || second === "") return first || second ? [{ code: null, label: first || second }] : [];
    return [{ code: first, label: second }];
  });
  // The codes given first, so that none made from a text takes one of them
  const used = new Set(taken);
  const bad: string[] = [];
  for (const { code } of rows) {
    if (code === null) continue;
    if (isItemCode(code) && !used.has(code)) used.add(code);
    else if (!bad.includes(code)) bad.push(code);
  }
  const items = rows.map(({ code, label }): NewItem => {
    const made = code ?? uniqueName(slugName(label, "answer"), used);
    used.add(made);
    return { code: made, label: { [language]: label } };
  });
  return { items, bad };
}

/** An answer's code as the survey takes it */
export const isItemCode = (code: string): boolean => /^[A-Za-z0-9_.-]+$/.test(code);

/**
 * Where a question or table goes when moved one step up or down among the items of its page or table: the id to put it
 * before (undefined: last); null when it cannot move that way
 */
export function moveTarget(items: readonly Pick<DesignItem, "id">[], id: number, step: -1 | 1): { before: number | undefined } | null {
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return null;
  if (step === -1) return i === 0 ? null : { before: items[i - 1].id };
  if (i === items.length - 1) return null;
  return { before: i + 2 < items.length ? items[i + 2].id : undefined };
}

/** Where a page goes when moved one step: the page to put it before (undefined: last); null when it cannot */
export function pageMoveTarget(order: readonly string[], name: string, step: -1 | 1): { before: string | undefined } | null {
  const i = order.indexOf(name);
  if (i < 0) return null;
  if (step === -1) return i === 0 ? null : { before: order[i - 1] };
  if (i === order.length - 1) return null;
  return { before: i + 2 < order.length ? order[i + 2] : undefined };
}

/** Where an answer goes when moved one step among the answers of its list */
export function itemMoveTarget(codes: readonly string[], code: string, step: -1 | 1): { before: string | undefined } | null {
  return pageMoveTarget(codes, code, step);
}

/** The question or table right after another among those of its page or table (a copy made below it) */
export function itemAfter(design: SurveyDesign, id: number): DesignItem | undefined {
  const places = design.pages.flatMap((p): readonly DesignItem[][] => [p.items, ...p.items.flatMap((i) => (i.kind === "table" ? [i.columns] : []))]);
  const place = places.find((items) => items.some((i) => i.id === id));
  return place?.[place.findIndex((i) => i.id === id) + 1];
}

/** Every question and table of the survey by its id, with its name */
function nodeNames(design: SurveyDesign): Map<number, string> {
  const out = new Map<number, string>();
  for (const p of design.pages) {
    for (const i of p.items) {
      out.set(i.id, i.name);
      if (i.kind === "table") for (const c of i.columns) out.set(c.id, c.name);
    }
  }
  for (const q of [...design.fromPlotFile, ...design.calculated, ...design.hidden]) out.set(q.id, q.name);
  return out;
}

/**
 * Whether two surveys are the same survey (one changed in the designer meanwhile), not another one put in its place: at
 * least one question or table keeps its id and its name. A new project file of another survey shares none.
 */
export function sameSurvey(a: SurveyDesign, b: SurveyDesign): boolean {
  const before = nodeNames(a);
  for (const [id, name] of nodeNames(b)) if (before.get(id) === name) return true;
  return false;
}

/** Every answer code of a list, at every level */
function listCodes(items: readonly DesignListItem[], into = new Set<string>()): Set<string> {
  for (const i of items) {
    into.add(i.code);
    listCodes(i.items, into);
  }
  return into;
}

/**
 * A change refused because the survey changed meanwhile (made on `before`), as it can be made again on the survey as it
 * is now (`after`): what it names by its id or name must still be there, and a rule named by its place is found again
 * by what it is. Null when it cannot be made again safely: a move (it names a neighbour, or a step from where the item
 * was), something put before another, or what it is about is gone.
 */
export function rebaseChange(ops: readonly SurveyOperation[], before: SurveyDesign, after: SurveyDesign): SurveyOperation[] | null {
  const nodes = nodeNames(after);
  const pages = new Set(after.pageOrder);
  const lists = new Map(after.lists.map((l) => [l.name, listCodes(l.items)]));
  const texts = surveyTexts(after);
  const rulesBefore = rulesById(before);
  const rulesAfter = rulesById(after);
  const ruleNow = (node: number, index: number): number | null => {
    const rule = rulesBefore.get(node)?.[index];
    return rule ? ruleIndexOf(rulesAfter.get(node) ?? [], ruleAnchor(rule)) : null;
  };
  const out: SurveyOperation[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "movePage":
      case "moveItem":
        return null;
      case "moveQuestion":
      case "copyQuestion":
        if (op.before !== undefined || !nodes.has(op.id) || (op.op === "moveQuestion" && op.page !== undefined && !pages.has(op.page))) return null;
        out.push(op);
        break;
      case "addPage":
        if (op.before !== undefined) return null;
        out.push(op);
        break;
      case "addQuestion":
        if (op.before !== undefined || (op.page !== undefined && !pages.has(op.page)) || (op.table !== undefined && !nodes.has(op.table))) return null;
        if (op.list !== undefined && !lists.has(op.list) && !ops.some((o) => o.op === "addList" && o.name === op.list)) return null;
        if (op.parent !== undefined && ![...nodes.values()].includes(op.parent)) return null;
        out.push(op);
        break;
      case "addTable":
        if (op.before !== undefined || !pages.has(op.page)) return null;
        if (!lists.has(op.rows) && !ops.some((o) => o.op === "addList" && o.name === op.rows)) return null;
        out.push(op);
        break;
      case "addItem": {
        const codes = lists.get(op.list);
        if (op.before !== undefined || !codes || codes.has(op.item.code) || (op.under !== undefined && !codes.has(op.under))) return null;
        out.push(op);
        break;
      }
      case "deleteItem":
        if (!lists.get(op.list)?.has(op.code)) return null;
        out.push(op);
        break;
      case "deleteList":
        if (!lists.has(op.name)) return null;
        out.push(op);
        break;
      case "deletePage":
        if (!after.emptyPages.some((p) => p.name === op.name && p.deletable)) return null;
        out.push(op);
        break;
      case "setRule":
      case "deleteRule": {
        const index = ruleNow(op.id, op.index);
        if (index === null) return null;
        out.push({ ...op, index });
        break;
      }
      case "setText": {
        if (op.target.kind === "rule") {
          const index = ruleNow(op.target.node, op.target.index);
          if (index === null) return null;
          out.push({ ...op, target: { ...op.target, index } });
        } else {
          if (textOf(texts, op.target, op.part, op.language) === undefined) return null;
          out.push(op);
        }
        break;
      }
      case "deleteQuestion":
      case "deleteTable":
      case "setRequired":
      case "setShownWhen":
      case "addRule":
      case "setExpression":
      case "setFormulas":
        if (!nodes.has(op.id)) return null;
        out.push(op);
        break;
      default:
        out.push(op);
    }
  }
  return out;
}

/** The languages the texts of changes are written in (a new question's label, an answer's, a rule's message) */
export function languagesUsed(ops: readonly SurveyOperation[]): Set<string> {
  const out = new Set<string>();
  const add = (text: Localized | undefined) => Object.keys(text ?? {}).forEach((l) => out.add(l));
  for (const op of ops) {
    switch (op.op) {
      case "setText":
        out.add(op.language);
        break;
      case "addPage":
      case "addQuestion":
      case "addTable":
        add(op.label);
        break;
      case "addList":
        add(op.label);
        op.items.forEach((i) => add(i.label));
        break;
      case "addItem":
        add(op.item.label);
        break;
      case "addRule":
      case "setRule":
        add(op.rule.message);
        break;
    }
  }
  return out;
}

/** The texts typed in the dialogs open and not added yet: they count as changes not saved */
export class Drafts {
  private readonly dirty = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private count = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** How many dialogs hold something typed */
  size = (): number => this.count;

  set(id: string, dirty: boolean): void {
    if (dirty === this.dirty.has(id)) return;
    if (dirty) this.dirty.add(id);
    else this.dirty.delete(id);
    this.count = this.dirty.size;
    for (const l of [...this.listeners]) l();
  }
}

/** The most characters a text of the survey has (the server's MAX_TEXT) */
export const MAX_TEXT = 4000;

/** How many levels a list's answers have (answers under answers make the next) */
export function listLevels(items: readonly DesignListItem[]): number {
  return items.length === 0 ? 0 : 1 + Math.max(...items.map((i) => listLevels(i.items)));
}

/**
 * The choices a new sub-list can follow, among those of a page or table: a sub-list offers the answers one level below
 * the answer chosen for the question it follows, so that question's list must have that level (the server refuses it
 * otherwise). A question that is itself a sub-list sits a level lower than the one it follows.
 */
export function subListParents(
  place: readonly DesignQuestion[],
  lists: ReadonlyMap<string, { items: readonly DesignListItem[] }>,
  questions: ReadonlyMap<string, DesignQuestion>,
): DesignQuestion[] {
  const depth = (q: DesignQuestion, seen = new Set<string>()): number => {
    const parent = q.parentQuestion ? questions.get(q.parentQuestion) : undefined;
    if (!parent || seen.has(q.name)) return 0;
    seen.add(q.name);
    return 1 + depth(parent, seen);
  };
  return place.filter((q) => q.type === "choice" && q.list && !q.fixed && listLevels(lists.get(q.list)?.items ?? []) > depth(q) + 1);
}

/**
 * Page names typed empty where the page would then have no name in any language (the server refuses a page without
 * one): how many
 */
export function namesEmptied(pending: ReadonlyMap<string, PendingText>, design: SurveyDesign): number {
  const typed = new Map<string, Map<string, string>>();
  for (const p of pending.values()) {
    if (p.target.kind !== "page" || p.part !== "label") continue;
    const page = p.target.name;
    typed.set(page, (typed.get(page) ?? new Map()).set(p.language, p.text.trim()));
  }
  let count = 0;
  for (const [name, texts] of typed) {
    const page = design.pages.find((p) => p.name === name) ?? design.emptyPages.find((p) => p.name === name);
    if (!page) continue;
    const all = { ...page.label, ...Object.fromEntries(texts) };
    if (Object.values(all).every((v) => v.trim() === "") && [...texts.values()].some((v) => v === "")) count++;
  }
  return count;
}
