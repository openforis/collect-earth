// Anonymising a former member's work: once someone has left a project, a coordinator can replace their username, on
// everything they collected, by "former-member-N" (N per project). Their username is part of each record's identity (the
// records' key is the plot and the operator), of the summaries and of the record XML Collect Earth sent (<operator>
// <value>…</value></operator>), of the record history, of the training records and of the quality decisions' "seen";
// all of it is renamed at once, so the figures (who agreed with whom, the time per plot, the work per week) stay as
// they were, without the name. Accounts are left alone: deleting one is the person's or the administrator's decision.

export const PSEUDONYM_PREFIX = 'former-member-';

/** The summary key Collect Earth puts the operator under (EarthConstants.OPERATOR_PARAMETER). */
export const OPERATOR_SUMMARY_KEY = 'collect_text_operator';

export const isPseudonym = (operator: string) => operator.startsWith(PSEUDONYM_PREFIX) && /^\d+$/.test(operator.slice(PSEUDONYM_PREFIX.length));

/** The next free pseudonym of a project, given the operators its records have. */
export function nextPseudonym(operators: Iterable<string>): string {
  let max = 0;
  for (const o of operators) if (isPseudonym(o)) max = Math.max(max, Number(o.slice(PSEUDONYM_PREFIX.length)));
  return `${PSEUDONYM_PREFIX}${max + 1}`;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern of the operator's value in a record's XML (for JavaScript, and for PostgreSQL's regexp_replace). */
export function operatorXmlPattern(username: string): string {
  return `(<operator>\\s*<value>)${escapeRegExp(username)}(</value>)`;
}

/** A record's XML with the operator's value renamed (nothing else in it: an answer that happens to equal the name stays). */
export function renameOperatorInXml(xml: string | null, from: string, to: string): string | null {
  if (xml === null) return null;
  return xml.replace(new RegExp(operatorXmlPattern(from), 'g'), (_m, open: string, close: string) => `${open}${to}${close}`);
}

/** A summary with the operator renamed, when it has the operator's key with that value. */
export function renameOperatorInSummary<T extends Record<string, string> | null>(summary: T, from: string, to: string): T {
  if (!summary || summary[OPERATOR_SUMMARY_KEY] !== from) return summary;
  return { ...summary, [OPERATOR_SUMMARY_KEY]: to } as T;
}
