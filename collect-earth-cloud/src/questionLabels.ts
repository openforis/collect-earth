// Question keys in texts people read, replaced by the questions' labels. Coordinators know
// "Land use", not "collect_code_land_use": the AI assistant's texts and guidance notes it
// drafted earlier can hold a key, and are shown with the label instead.

/** Not a letter, digit or "_" right before or after a key: no key is matched inside a longer one. */
const BEFORE = '(?<![\\p{L}\\p{N}_])';
const AFTER = '(?![\\p{L}\\p{N}_])';

const cache = new WeakMap<ReadonlyMap<string, string>, RegExp | null>();

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One pattern for every key with a label of its own, longest first (a key may start another). */
function patternOf(labels: ReadonlyMap<string, string>): RegExp | null {
  if (cache.has(labels)) return cache.get(labels)!;
  const keys = [...labels].filter(([key, label]) => key !== '' && label.trim() !== '' && label !== key).map(([key]) => key);
  keys.sort((a, b) => b.length - a.length);
  const pattern = keys.length === 0 ? null : new RegExp(`${BEFORE}(?:${keys.map(escape).join('|')})${AFTER}`, 'gu');
  cache.set(labels, pattern);
  return pattern;
}

/**
 * The text with each exact question key it holds (by `labels`: key -> label) replaced by
 * its label. A key without a label of its own is left as it is.
 */
export function withQuestionLabels(text: string, labels: ReadonlyMap<string, string>): string {
  const pattern = patternOf(labels);
  if (!pattern) return text;
  return text.replace(pattern, (key) => labels.get(key) ?? key);
}
