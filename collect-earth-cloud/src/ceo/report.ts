// The import report (docs/plans/2026-11-09-ceo-bridge.md, B5): each question, rule and setting of the CEO project
// with what became of it, in words for the coordinator, shown before the project is made.

/** imported as it is; changed on the way (the message says how); left out (the message says why); info: no action */
export type Outcome = 'imported' | 'changed' | 'skipped' | 'info';

export interface ReportEntry {
  /** what the entry is about */
  area: 'project' | 'question' | 'rule' | 'plots';
  /** the question's text, the rule's kind and id, the setting's name */
  subject: string;
  outcome: Outcome;
  message: string;
}

export class Report {
  readonly entries: ReportEntry[] = [];

  add(area: ReportEntry['area'], subject: string, outcome: Outcome, message: string): void {
    this.entries.push({ area, subject, outcome, message });
  }

  count(outcome: Outcome, area?: ReportEntry['area']): number {
    return this.entries.filter((e) => e.outcome === outcome && (area === undefined || e.area === area)).length;
  }
}
