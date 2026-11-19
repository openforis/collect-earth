// The survey designer's stage 2 (docs/plans/2026-11-18-survey-designer.md): the words changed in the dashboard before
// they are saved. Each text is kept by what it belongs to, its part and its language, with the text it had, so that
// only what differs is sent, and a text typed back to what it was is no change.

import type { DesignItem, DesignListItem, DesignQuestion, Localized, NewItem, SurveyDesign, SurveyOperation, WordTarget } from "../api";

export type WordPart = "label" | "help" | "message";

export interface PendingText {
  target: WordTarget;
  part: WordPart;
  language: string;
  text: string;
  /** The text it had when the survey was read */
  current: string;
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

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

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
   * change any more)
   */
  settle(design: SurveyDesign, sent: readonly PendingText[] = []): void {
    const next = new Map(this.texts);
    for (const p of sent) {
      const key = editKey(p.target, p.part, p.language);
      if (next.get(key)?.text.trim() === p.text.trim()) next.delete(key);
    }
    const texts = surveyTexts(design);
    for (const [key, p] of next) {
      const now = textOf(texts, p.target, p.part, p.language);
      if (now === undefined) continue;
      if (p.text.trim() === now.trim()) next.delete(key);
      else if (now !== p.current) next.set(key, { ...p, current: now });
    }
    this.replace(next);
  }

  private replace(texts: ReadonlyMap<string, PendingText>): void {
    this.texts = texts;
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

/** Answers typed one per line, each with a code made from it, in a language; blank lines left out */
export function itemsFromLines(text: string, language: string): NewItem[] {
  const taken = new Set<string>();
  const items: NewItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const label = line.trim();
    if (label === "") continue;
    const code = uniqueName(slugName(label, "answer"), taken);
    taken.add(code);
    items.push({ code, label: { [language]: label } });
  }
  return items;
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
