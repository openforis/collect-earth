import { useEffect, useState } from "react";
import { apiGet } from "./apiClient";

/** The texts of Messages*.properties by key, as MessagesController sends them. */
export type Texts = Record<string, string>;

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

/**
 * A text of Messages*.properties (MessagesController), as plain text: many carry the HTML of Swing labels (<html>,
 * <br>, <b>...), with tags misspelt (</hml>) or machine translated (</ Б> in Mongolian), and "&" could mark a mnemonic.
 * A missing one shows as "!key!", as Messages.getString does, so it is noticed; while the texts are still loading
 * (null or undefined) every text is empty, so the labels do not show their keys for a moment.
 */
export function serverText(texts: Texts | null | undefined, key: string): string {
  if (texts == null) return "";
  const text = texts[key];
  if (text === undefined) return "!" + key + "!";
  return text
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    // Only a "<" followed by a letter opens a tag, so "a < b" is kept
    .replace(/<\/?\s*\p{L}[^<>]*>/gu, "")
    // A mnemonic "&" starts a word and is not an entity: "Save & Apply" and "R&D" keep theirs
    .replace(/(^|\s)&(?=\p{L})(?!#?\w+;)/gu, "$1")
    // The spaces around the tags, which Swing's HTML collapses
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    // Last, and in one pass, so that a decoded "&" or "<" is not read again
    .replace(/&(#[xX][0-9a-fA-F]+|#\d+|\w+);/g, (entity, name: string) => {
      if (!name.startsWith("#")) return ENTITIES[name] ?? entity;
      const hex = name[1] === "x" || name[1] === "X";
      const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      // fromCodePoint throws beyond U+10FFFF: a stray character code stays as it was written rather than break the page
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
}

/** The texts of a language from the server: none rather than a crash when the answer has no texts. */
export async function loadServerTexts(language: string, signal?: AbortSignal): Promise<Texts> {
  const r = await apiGet<{ texts?: Texts } | undefined>("messages?lang=" + encodeURIComponent(language), signal);
  return r?.texts ?? {};
}

/**
 * The texts of the language, loaded once per language: null until the first ones arrive. On a change of language the
 * texts of the previous one stay until the new ones come, and if loading fails the keys show ("!key!"), so it is
 * noticed, and the next change of language tries again.
 */
export function useServerTexts(language: string): Texts | null {
  const [texts, setTexts] = useState<Texts | null>(null);
  useEffect(() => {
    // Aborted when the language changes again or the page goes: the answer of a language no longer wanted is dropped
    const controller = new AbortController();
    loadServerTexts(language, controller.signal)
      // An abort that comes once the answer is in does not stop the promise: the check drops it all the same
      .then((t) => { if (!controller.signal.aborted) setTexts(t); })
      .catch(() => { if (!controller.signal.aborted) setTexts((t) => t ?? {}); });
    return () => controller.abort();
  }, [language]);
  return texts;
}
