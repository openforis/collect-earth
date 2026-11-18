// The survey designer's stage 2 (docs/plans/2026-11-18-survey-designer.md): the words changed in the dashboard before
// they are saved. Each text is kept by what it belongs to, its part and its language, with the text it had, so that
// only what differs is sent, and a text typed back to what it was is no change.

import type { DesignItem, NewItem, SurveyOperation, WordTarget } from "../api";

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
