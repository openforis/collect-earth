// CEO's survey rules as Collect checks (docs/plans/2026-11-09-ceo-bridge.md, B2). Every CEO rule type has a Collect
// check; a rule is left out only when a question or answer it names did not come across (hidden in CEO, or not a
// number where it adds numbers). A rule over several questions is checked on the one asked last, so the message shows
// once they are all answered. All are errors, as CEO's rules stop a plot from being saved.
import type { CeoProject } from './project.js';
import type { Report } from './report.js';
import type { PlannedAttribute, SurveyPlan } from './survey.js';

export type PlannedCheck =
  | { attribute: string; kind: 'pattern'; regex: string; message: string }
  | { attribute: string; kind: 'compare'; gte: number | null; lte: number | null; message: string }
  | { attribute: string; kind: 'custom'; expr: string; when: string | null; message: string };

/** A question's text, short enough for a message */
const quote = (a: PlannedAttribute): string => `“${a.label.length > 60 ? `${a.label.slice(0, 57)}…` : a.label}”`;
const listOf = (items: string[]): string => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const plain = (n: number): string => String(n);

/** The rules of `project` as checks on the attributes of `plan`; what was left out goes to `report`. */
export function planChecks(project: CeoProject, plan: SurveyPlan, report: Report): PlannedCheck[] {
  const position = new Map(plan.attributes.map((a, i) => [a.name, i]));
  const last = (attrs: PlannedAttribute[]): PlannedAttribute => attrs.reduce((a, b) => ((position.get(b.name) ?? 0) > (position.get(a.name) ?? 0) ? b : a));
  /** The value of a question as a number in XPath, or null when it holds no number */
  const numberOf = (a: PlannedAttribute): string | null => (a.kind === 'number' ? a.name : a.kind === 'code' && a.numericCodes ? `number(${a.name})` : null);
  const allAnswered = (attrs: PlannedAttribute[]): string => attrs.map((a) => `not(idm:blank(${a.name}))`).join(' and ');
  const codeOf = (a: PlannedAttribute, answerId: string): string | null => a.items.find((i) => i.answerId === answerId)?.code ?? null;
  const labelOf = (a: PlannedAttribute, answerId: string): string => a.items.find((i) => i.answerId === answerId)?.label ?? answerId;

  const checks: PlannedCheck[] = [];
  for (const rule of project.rules) {
    const subject = `${rule.ruleType} ${rule.id}`.trim();
    const skip = (why: string) => report.add('rule', subject, 'skipped', why);
    const done = (check: PlannedCheck, note?: string) => {
      checks.push(check);
      report.add('rule', subject, note ? 'changed' : 'imported', `On "${check.attribute}": ${check.message}${note ? ` (${note})` : ''}`);
    };
    /** The attributes of these question ids, or the reason one is missing */
    const attributesOf = (ids: string[]): PlannedAttribute[] | string => {
      const found: PlannedAttribute[] = [];
      for (const qid of ids) {
        const a = plan.byCeoId.get(qid);
        if (!a) return `question ${qid} did not come across (hidden in CEO, or left out)`;
        found.push(a);
      }
      return found.length ? found : 'it names no question';
    };

    if ('unknown' in rule) {
      skip(`A rule type this import does not know (${rule.ruleType}).`);
      continue;
    }
    switch (rule.ruleType) {
      case 'text-match': {
        const attrs = attributesOf([rule.questionId]);
        if (typeof attrs === 'string') { skip(`Not checked: ${attrs}.`); break; }
        const [a] = attrs;
        if (a.kind !== 'text') { skip(`Not checked: ${quote(a)} is not a text answer.`); break; }
        try {
          new RegExp(rule.regex);
        } catch {
          skip(`Not checked: its pattern cannot be read (${rule.regex}).`);
          break;
        }
        // CEO tests the pattern anywhere in the text (JavaScript); Collect matches the whole text (Java)
        const anchored = rule.regex.startsWith('^') && rule.regex.endsWith('$') && !rule.regex.endsWith('\\$');
        const regex = anchored ? rule.regex.slice(1, -1) : `.*(?:${rule.regex}).*`;
        done({ attribute: a.name, kind: 'pattern', regex, message: `The answer to ${quote(a)} must match the pattern ${rule.regex}.` },
          anchored ? undefined : 'the pattern may be found anywhere in the answer, as in CEO');
        break;
      }
      case 'numeric-range': {
        const attrs = attributesOf([rule.questionId]);
        if (typeof attrs === 'string') { skip(`Not checked: ${attrs}.`); break; }
        const [a] = attrs;
        if (rule.min === null && rule.max === null) { skip('Not checked: it has neither a minimum nor a maximum.'); break; }
        const range = rule.min !== null && rule.max !== null ? `between ${plain(rule.min)} and ${plain(rule.max)}`
          : rule.min !== null ? `at least ${plain(rule.min)}` : `at most ${plain(rule.max!)}`;
        const message = `The answer to ${quote(a)} must be ${range}.`;
        if (a.kind === 'number') {
          done({ attribute: a.name, kind: 'compare', gte: rule.min, lte: rule.max, message });
        } else if (a.kind === 'code' && a.numericCodes) {
          const parts = [rule.min !== null ? `number($this) >= ${plain(rule.min)}` : null, rule.max !== null ? `number($this) <= ${plain(rule.max)}` : null];
          done({ attribute: a.name, kind: 'custom', expr: parts.filter(Boolean).join(' and '), when: null, message });
        } else {
          skip(`Not checked: ${quote(a)} does not hold a number.`);
        }
        break;
      }
      case 'sum-of-answers': {
        const attrs = attributesOf(rule.questionIds);
        if (typeof attrs === 'string') { skip(`Not checked: ${attrs}.`); break; }
        if (!Number.isFinite(rule.validSum)) { skip('Not checked: it has no total to reach.'); break; }
        const terms = attrs.map(numberOf);
        if (terms.some((t) => t === null)) { skip('Not checked: one of its questions does not hold a number.'); break; }
        done({
          attribute: last(attrs).name, kind: 'custom', expr: `${terms.join(' + ')} = ${plain(rule.validSum)}`, when: allAnswered(attrs),
          message: `The answers to ${listOf(attrs.map(quote))} must add up to ${plain(rule.validSum)}.`,
        });
        break;
      }
      case 'matching-sums': {
        const one = attributesOf(rule.questionIds1);
        const two = attributesOf(rule.questionIds2);
        if (typeof one === 'string' || typeof two === 'string') { skip(`Not checked: ${typeof one === 'string' ? one : two}.`); break; }
        const t1 = one.map(numberOf);
        const t2 = two.map(numberOf);
        if ([...t1, ...t2].some((t) => t === null)) { skip('Not checked: one of its questions does not hold a number.'); break; }
        const all = [...one, ...two];
        done({
          attribute: last(all).name, kind: 'custom', expr: `${t1.join(' + ')} = ${t2.join(' + ')}`, when: allAnswered(all),
          message: `The answers to ${listOf(one.map(quote))} must add up to the same as those to ${listOf(two.map(quote))}.`,
        });
        break;
      }
      case 'incompatible-answers':
      case 'multiple-incompatible-answers': {
        const pairs: [string, string][] = rule.ruleType === 'incompatible-answers'
          ? [[rule.questionId1, rule.answerId1], [rule.questionId2, rule.answerId2]]
          : [...Object.entries(rule.answers), [rule.incompatQuestionId, rule.incompatAnswerId]];
        const attrs = attributesOf(pairs.map(([q]) => q));
        if (typeof attrs === 'string') { skip(`Not checked: ${attrs}.`); break; }
        const terms: string[] = [];
        const said: string[] = [];
        let missing: string | null = null;
        pairs.forEach(([, aid], i) => {
          const a = attrs[i];
          const code = a.kind === 'code' ? codeOf(a, aid) : null;
          if (code === null) missing ??= `the answer ${aid} of ${quote(a)} did not come across (hidden in CEO)`;
          terms.push(`${a.name} = '${code}'`);
          said.push(`${quote(a)}: “${labelOf(a, aid)}”`);
        });
        if (missing) { skip(`Not checked: ${missing}.`); break; }
        const message = said.length === 2 ? `${said[0]} cannot go with ${said[1]}.` : `${listOf(said.slice(0, -1))} cannot go with ${said[said.length - 1]}.`;
        done({ attribute: last(attrs).name, kind: 'custom', expr: `not(${terms.join(' and ')})`, when: null, message });
        break;
      }
    }
  }
  return checks;
}
