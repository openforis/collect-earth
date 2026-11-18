// The survey designer's stage 2 (docs/plans/2026-11-18-survey-designer.md): the words changed in the dashboard before
// they are saved. Each text is kept by what it belongs to, its part and its language, with the text it had, so that
// only what differs is sent, and a text typed back to what it was is no change.

import type { SurveyOperation, WordTarget } from "../api";

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
