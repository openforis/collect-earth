// A repeat survey (docs/plans/2026-11-11-repeat-survey.md): a project made to collect the plots of an earlier one again,
// years later, keeps the earlier project's answers as an earlier period ("2020"). This module chooses the earlier
// record of each plot, matches its answers to the new project's survey (the same survey, or a newer version of it),
// and picks the questions the form's header shows of the earlier period: the plot's main characteristics, against
// which the collector says whether the plot is still the same, has changed, or was interpreted wrongly then.
import type { RecordRound } from './rounds.js';
import { QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR, type Question } from './surveyOutline.js';

/** A record of the earlier project, as it is read (listRecordSummaries). */
export interface SourceRecord {
  recordKey: string;
  operator: string;
  modifiedOn: number;
  activelySaved: boolean;
  deleted: boolean;
  summary: Record<string, string>;
}

/** The earlier record of one plot. */
export interface EarlierRecord {
  plot: string;
  operator: string;
  savedAt: number;
  answers: Record<string, string>;
}

/**
 * One record per plot of the earlier project: the one the coordinator took when the plot was decided (the export's
 * final "yes", a check's when it was the check), else the latest submitted first assessment. Drafts, deleted records,
 * and checks not taken are left out; a plot with no submitted first assessment has none.
 */
export function earlierRecords(
  records: readonly SourceRecord[],
  roundOf: (r: SourceRecord) => RecordRound,
  finalOf: (r: SourceRecord) => string,
): EarlierRecord[] {
  const chosen = new Map<string, { record: SourceRecord; taken: boolean }>();
  for (const r of records) {
    if (!r.activelySaved || r.deleted) continue;
    const round = roundOf(r);
    const taken = finalOf(r) === 'yes';
    if (!taken && round.assessment !== 'main') continue;
    const current = chosen.get(round.plot);
    // The coordinator's choice first, then the latest
    if (!current || (taken && !current.taken) || (taken === current.taken && r.modifiedOn > current.record.modifiedOn)) {
      chosen.set(round.plot, { record: r, taken });
    }
  }
  return [...chosen].map(([plot, { record }]) => ({ plot, operator: record.operator, savedAt: record.modifiedOn, answers: { ...record.summary } }));
}

/** A summary key with its rows' keys left out: collect_entity_land_use[F].code_coverage -> collect_entity_land_use[].code_coverage */
const shapeOf = (key: string) => key.replace(/\[[^\]]*\]/g, '[]');

/** What could not be matched to the new survey, for the coordinator. */
export interface MatchReport {
  /** Questions of the earlier answers the new survey does not have (by key, rows' keys left out), with their plots */
  questionsLeftOut: { key: string; plots: number }[];
  /** Answers whose code the new survey's question does not offer, kept as they were */
  unknownAnswers: { key: string; code: string; plots: number }[];
}

/**
 * The earlier answers matched to the new survey (`outline`, surveyOutline of its served survey): the answers to its
 * questions only (not the plot file's columns, the keys nor the bookkeeping, which the new records have themselves),
 * by question and answer code. Questions it no longer has are left out, and codes it no longer offers are kept as they
 * were; both are reported.
 */
export function matchToSurvey(earlier: readonly EarlierRecord[], outline: ReadonlyMap<string, Question>): { records: EarlierRecord[]; report: MatchReport } {
  const questions = new Map<string, Question>();
  for (const q of outline.values()) if (!q.excluded) questions.set(shapeOf(q.key), q);
  const excluded = new Set([...outline.values()].filter((q) => q.excluded).map((q) => shapeOf(q.key)));
  const leftOut = new Map<string, Set<string>>();
  const unknown = new Map<string, { key: string; code: string; plots: Set<string> }>();
  const records = earlier.map((r) => {
    const answers: Record<string, string> = {};
    for (const [key, value] of Object.entries(r.answers)) {
      const shape = shapeOf(key);
      const q = questions.get(shape);
      if (!q) {
        // The new records have the keys and the plot file's columns themselves; only a question that went is reported
        if (!excluded.has(shape) && !BOOKKEEPING_SHAPES.has(shape) && value !== '') {
          let plots = leftOut.get(shape);
          if (!plots) leftOut.set(shape, (plots = new Set()));
          plots.add(r.plot);
        }
        continue;
      }
      answers[key] = value;
      if (q.kind !== 'choice' || !q.options || q.options.length === 0 || value === '') continue;
      for (const part of value.split(SUMMARY_VALUES_SEPARATOR)) {
        const code = part.split(QUALIFIER_SEPARATOR)[0];
        if (q.options.some((o) => o.code === code)) continue;
        const id = `${shape}\u0000${code}`;
        let u = unknown.get(id);
        if (!u) unknown.set(id, (u = { key: shape, code, plots: new Set() }));
        u.plots.add(r.plot);
      }
    }
    return { ...r, answers };
  });
  return {
    records,
    report: {
      questionsLeftOut: [...leftOut].map(([key, plots]) => ({ key, plots: plots.size })).sort((a, b) => b.plots - a.plots || a.key.localeCompare(b.key)),
      unknownAnswers: [...unknown.values()].map((u) => ({ key: u.key, code: u.code, plots: u.plots.size })).sort((a, b) => b.plots - a.plots || a.key.localeCompare(b.key)),
    },
  };
}

/** Kept by each record itself, never compared (surveyOutline's BOOKKEEPING_KEYS): who, when, the plot file, the place, the round */
const BOOKKEEPING_SHAPES = new Set([
  'collect_text_operator',
  'collect_boolean_actively_saved',
  'collect_date_actively_saved_on',
  'collect_text_actively_saved_on',
  'collect_text_plot_file',
  'collect_coord_location',
  // the round each record has as a key (the server adds it to a survey without one)
  'collect_code_round',
]);

/** How many questions the header shows by default. */
export const DEFAULT_HEADER_QUESTIONS = 4;
const LAND = /land_?use|land_?cover|lulc|landcover|landuse/i;

/**
 * The questions the form's header shows by default: the plot's single-choice questions about its land (land use, land
 * cover: the IPCC surveys' category and subdivision), else the survey's first single-choice questions; at most four.
 * Only questions of the plot itself (not of its tables), never its keys nor the plot file's columns.
 */
export function defaultHeaderQuestions(outline: ReadonlyMap<string, Question>): string[] {
  const choices = [...outline.values()].filter((q) => q.kind === 'choice' && !q.excluded && !q.multiple && !q.key.includes('.') && !q.key.includes('['));
  const land = choices.filter((q) => LAND.test(q.key));
  return (land.length > 0 ? land : choices).slice(0, DEFAULT_HEADER_QUESTIONS).map((q) => q.key);
}

/** The questions a header can show: the plot's own questions (not its tables'), its keys and the plot file's left out. */
export function headerCandidates(outline: ReadonlyMap<string, Question>): Question[] {
  return [...outline.values()].filter((q) => !q.excluded && !q.key.includes('.') && !q.key.includes('[') && q.kind !== 'other');
}

/** A period's label: 1 to 40 characters, trimmed; null when not one. */
export function labelOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const label = raw.trim();
  return label.length >= 1 && label.length <= 40 && !/[\u0000-\u001f]/.test(label) ? label : null;
}

/** The year of most of the records (the default label of the earlier period), null when none. */
export function yearOf(records: readonly { savedAt: number }[]): string | null {
  const years = new Map<number, number>();
  for (const r of records) {
    const y = new Date(r.savedAt).getUTCFullYear();
    years.set(y, (years.get(y) ?? 0) + 1);
  }
  let best: [number, number] | null = null;
  for (const entry of years) if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] > best[0])) best = entry;
  return best ? String(best[0]) : null;
}
