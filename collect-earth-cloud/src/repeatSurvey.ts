// A repeat survey (docs/plans/2026-11-11-repeat-survey.md): a project made to collect the plots of an earlier one again,
// years later, keeps the earlier project's answers as an earlier period ("2020"). This module chooses the earlier
// record of each plot, matches its answers to the new project's survey (the same survey, or a newer version of it),
// and picks the questions the form's header shows of the earlier period: the plot's main characteristics, against
// which the collector says whether the plot is still the same, has changed, or was interpreted wrongly then.
import type { AnalysisColumn, AnalysisModel } from './analysis.js';
import type { RecordRound } from './rounds.js';
import { QUALIFIER_SEPARATOR, SUMMARY_VALUES_SEPARATOR, type Question } from './surveyOutline.js';
import { stratifiedTotal } from './uncertainty.js';

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

// ---------------------------------------------------------------------------------------------------------------
// The comparison (stage 3): an earlier period's answers against this period's, for one question

/** What the collector said of a plot against the earlier period (the survey's period_status) */
export type PeriodStatusAnswer = 'same' | 'changed' | 'corrected';

/** How a plot compares between the two periods, for the question compared. */
export type ChangeOutcome =
  /** the same answer in both periods */
  | 'unchanged'
  /** another answer: a change of the land */
  | 'changed'
  /** another answer, the collector having said the earlier one was wrong: a correction, not a change */
  | 'corrected'
  /** collected now, with no earlier answer */
  | 'new'
  /** an earlier answer, not collected yet (or not submitted) */
  | 'pending';

export interface ChangeRow {
  plot: string;
  earlier: string | null;
  now: string | null;
  /** the collector's answer to the header (period_status), null when none */
  status: PeriodStatusAnswer | null;
  outcome: ChangeOutcome;
  /**
   * The collector's answer and the answers disagree: said "still the same" with another answer now, or "changed" with
   * the same answer (to look at again)
   */
  mismatch: 'sameButDiffers' | 'changedButSame' | null;
}

export interface Change {
  rows: ChangeRow[];
  /** plots by earlier answer and answer now, real changes and unchanged only (not the corrections), by code */
  matrix: { from: string; to: string; plots: number }[];
  /** the corrections, by earlier answer and the answer that corrects it */
  corrections: { from: string; to: string; plots: number }[];
  counts: Record<ChangeOutcome, number> & { mismatches: number };
}

/** A choice answer as compared: its code (the first, its qualifier left out); null when empty */
const codeOf = (value: string | undefined): string | null => {
  const code = (value ?? '').split(SUMMARY_VALUES_SEPARATOR)[0].split(QUALIFIER_SEPARATOR)[0].trim();
  return code === '' ? null : code;
};

const STATUSES = new Set<PeriodStatusAnswer>(['same', 'changed', 'corrected']);

/**
 * One question (`key`) of every plot compared between an earlier period (`earlier`: its answers, period_answers) and
 * this one (`now`: the record taken for each plot, as earlierRecords takes it), with the collectors' answers to the
 * header (`statusKey`, the survey's period_status). A plot said to be wrongly interpreted then is a correction, kept
 * out of the transition matrix of real changes and counted apart.
 */
export function compareRepeat(
  earlier: readonly { plot: string; answers: Record<string, string> }[],
  now: readonly { plot: string; answers: Record<string, string> }[],
  key: string,
  statusKey: string,
): Change {
  const before = new Map(earlier.map((r) => [r.plot, codeOf(r.answers[key])]));
  const after = new Map(now.map((r) => [r.plot, r]));
  const plots = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const counts: Change['counts'] = { unchanged: 0, changed: 0, corrected: 0, new: 0, pending: 0, mismatches: 0 };
  const matrix = new Map<string, number>();
  const corrections = new Map<string, number>();
  const bump = (m: Map<string, number>, from: string, to: string) => m.set(`${from}\u0000${to}`, (m.get(`${from}\u0000${to}`) ?? 0) + 1);
  const rows: ChangeRow[] = [];
  for (const plot of plots) {
    const from = before.get(plot) ?? null;
    const record = after.get(plot);
    const to = record ? codeOf(record.answers[key]) : null;
    const raw = record?.answers[statusKey];
    const status = raw && STATUSES.has(raw as PeriodStatusAnswer) ? (raw as PeriodStatusAnswer) : null;
    let outcome: ChangeOutcome;
    if (to === null) outcome = 'pending';
    else if (from === null) outcome = 'new';
    else if (status === 'corrected' && from !== to) outcome = 'corrected';
    else outcome = from === to ? 'unchanged' : 'changed';
    const mismatch = from === null || to === null ? null : status === 'same' && from !== to ? 'sameButDiffers' : status === 'changed' && from === to ? 'changedButSame' : null;
    counts[outcome] += 1;
    if (mismatch) counts.mismatches += 1;
    if (from !== null && to !== null) bump(outcome === 'corrected' ? corrections : matrix, from, to);
    rows.push({ plot, earlier: from, now: to, status, outcome, mismatch });
  }
  const list = (m: Map<string, number>) =>
    [...m].map(([id, n]) => {
      const [from, to] = id.split('\u0000');
      return { from, to, plots: n };
    });
  return { rows, matrix: list(matrix), corrections: list(corrections), counts };
}

/** The questions a change can be shown for: the plot's single choices, answered in the earlier period. */
export function changeQuestions(outline: ReadonlyMap<string, Question>, earlier: readonly { answers: Record<string, string> }[], statusKey: string): Question[] {
  const answered = new Set(earlier.flatMap((r) => Object.keys(r.answers).filter((k) => r.answers[k] !== '')));
  return [...outline.values()].filter(
    (q) => q.kind === 'choice' && !q.multiple && !q.excluded && !q.key.includes('.') && !q.key.includes('[') && q.key !== statusKey && answered.has(q.key),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The areas of the changes (stage 4), with their uncertainty, as the IPCC uncertainty page has them (src/uncertainty.ts)

/** An area estimated from the plots, in hectares (or in shares of 1 when the area is not known). */
export interface AreaEstimate {
  plots: number;
  area: number;
  /** of the total area, 0–1 */
  share: number;
  se: number;
  /** half the 95% confidence interval: 1.96 · se */
  ci: number;
  /** ci / |area| · 100; null when the area is 0 */
  uncertainty: number | null;
}

export interface ChangeAreas {
  /** "simple": one stratum, every plot standing for the same area; "stratified": the areas file's strata */
  estimator: 'simple' | 'stratified';
  totalArea: number;
  /** the plots compared and used */
  plots: number;
  strata: { key: string; area: number; plots: number }[];
  /** strata with fewer than 2 plots used: no variance; with none their area is not counted */
  notEstimable: { key: string; area: number; plots: number }[];
  /** plots not used: not compared (new, or not collected yet), and in no stratum (no area) */
  skipped: { notCompared: number; noArea: number };
  outcomes: Record<'unchanged' | 'changed' | 'corrected', AreaEstimate>;
  /** the area of each cell of the transition matrix (unchanged and changed plots) */
  matrix: { from: string; to: string; estimate: AreaEstimate }[];
  /** the area of the corrections, by earlier answer and the answer that corrects it */
  corrections: { from: string; to: string; estimate: AreaEstimate }[];
  /**
   * Each answer's area in the earlier period (as now known: a corrected plot counts with the answer that corrects it,
   * the earlier one having been wrong), now, and the net change between them (now − then), each with its uncertainty
   */
  classes: { code: string; then: AreaEstimate; now: AreaEstimate; net: AreaEstimate }[];
}

const COMPARED = new Set<ChangeOutcome>(['unchanged', 'changed', 'corrected']);

/**
 * The areas of a comparison (compareRepeat's rows): the plots compared (unchanged, changed or corrected), each in its
 * stratum (`stratumOf`, null: in none), the strata's areas in hectares (`strata`; one of the total area when every plot
 * stands for the same area). The stratified estimator of src/uncertainty.ts: each area the share of its stratum's plots
 * times the stratum's area, summed over the strata, its variance from the plots' spread in each stratum.
 */
export function changeAreas(rows: readonly ChangeRow[], stratumOf: (plot: string) => string | null, strata: ReadonlyMap<string, number>): ChangeAreas {
  const skipped = { notCompared: 0, noArea: 0 };
  const used = new Map<string, ChangeRow[]>();
  for (const r of rows) {
    if (!COMPARED.has(r.outcome) || r.earlier === null || r.now === null) { skipped.notCompared++; continue; }
    const stratum = stratumOf(r.plot);
    if (stratum === null || !((strata.get(stratum) ?? 0) > 0)) { skipped.noArea++; continue; }
    let list = used.get(stratum);
    if (!list) used.set(stratum, (list = []));
    list.push(r);
  }
  const strataOut = [...strata].filter(([, area]) => area > 0).map(([key, area]) => ({ key, area, plots: used.get(key)?.length ?? 0 }));
  const counted = strataOut.filter((s) => s.plots > 0);
  const totalArea = counted.reduce((sum, s) => sum + s.area, 0);
  const estimate = (y: (r: ChangeRow) => number): AreaEstimate => {
    const { total, se, ci } = stratifiedTotal(counted.map((s) => ({ area: s.area, values: used.get(s.key)!.map(y) })));
    let plots = 0;
    for (const s of counted) for (const r of used.get(s.key)!) if (y(r) !== 0) plots++;
    return { plots, area: total, share: totalArea > 0 ? total / totalArea : 0, se, ci, uncertainty: total !== 0 ? (ci / Math.abs(total)) * 100 : null };
  };
  const all = counted.flatMap((s) => used.get(s.key)!);
  const pairs = (which: (r: ChangeRow) => boolean) =>
    [...new Set(all.filter(which).map((r) => `${r.earlier}\u0000${r.now}`))].sort().map((id) => {
      const [from, to] = id.split('\u0000');
      return { from, to, estimate: estimate((r) => (which(r) && r.earlier === from && r.now === to ? 1 : 0)) };
    });
  /** the answer the plot had in the earlier period, as now known */
  const then = (r: ChangeRow) => (r.outcome === 'corrected' ? r.now : r.earlier);
  const codes = [...new Set(all.flatMap((r) => [then(r)!, r.now!]))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return {
    estimator: counted.length > 1 ? 'stratified' : 'simple',
    totalArea,
    plots: all.length,
    strata: strataOut,
    notEstimable: strataOut.filter((s) => s.plots < 2),
    skipped,
    outcomes: {
      unchanged: estimate((r) => (r.outcome === 'unchanged' ? 1 : 0)),
      changed: estimate((r) => (r.outcome === 'changed' ? 1 : 0)),
      corrected: estimate((r) => (r.outcome === 'corrected' ? 1 : 0)),
    },
    matrix: pairs((r) => r.outcome !== 'corrected'),
    corrections: pairs((r) => r.outcome === 'corrected'),
    classes: codes.map((code) => ({
      code,
      then: estimate((r) => (then(r) === code ? 1 : 0)),
      now: estimate((r) => (r.now === code ? 1 : 0)),
      net: estimate((r) => (r.now === code ? 1 : 0) - (then(r) === code ? 1 : 0)),
    })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Both periods side by side: the export (one row per plot) and the analysis page's columns of the earlier periods

/** One period's records, as the export with both periods reads them: the earlier periods' answers, then this one's. */
export interface PeriodRecords {
  label: string;
  rows: readonly { plot: string; operator: string; savedAt: number; answers: Record<string, string> }[];
}

const byPlot = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const plain = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The periods side by side, one row per plot (every plot of any period): `plot`; each period's `<label>.operator` and
 * `<label>.saved_on`; this period's `period_status`; then each question of the survey (`outline`, in its order) answered in
 * some period, a column per period (`2020.<key>`, `2025.<key>`, next to each other); then this period's other columns
 * once (the plot file's, the keys, the places, the bookkeeping), unless `leaveOut`. `periods`: oldest first, this one last.
 */
export function bothPeriodsTable(
  periods: readonly PeriodRecords[],
  outline: ReadonlyMap<string, Question>,
  statusKey: string,
  leaveOut: (key: string) => boolean = () => false,
): { columns: string[]; rows: string[][] } {
  const order = new Map<string, number>();
  for (const q of outline.values()) if (!q.excluded && !order.has(shapeOf(q.key))) order.set(shapeOf(q.key), order.size);
  const isQuestion = (key: string) => key !== statusKey && order.has(shapeOf(key));
  const current = periods[periods.length - 1];
  const byPeriod = periods.map((p) => new Map(p.rows.map((r) => [r.plot, r])));
  const plots = [...new Set(periods.flatMap((p) => p.rows.map((r) => r.plot)))].sort(byPlot);
  const questions = [...new Set(periods.flatMap((p) => p.rows.flatMap((r) => Object.keys(r.answers).filter((k) => isQuestion(k) && r.answers[k] !== ''))))]
    .filter((k) => !leaveOut(k))
    .sort((a, b) => order.get(shapeOf(a))! - order.get(shapeOf(b))! || plain(a, b));
  const others = current
    ? [...new Set(current.rows.flatMap((r) => Object.keys(r.answers)))].filter((k) => k !== statusKey && !isQuestion(k) && !leaveOut(k)).sort(plain)
    : [];
  const columns = [
    'plot',
    ...periods.flatMap((p) => [`${p.label}.operator`, `${p.label}.saved_on`]),
    'period_status',
    ...questions.flatMap((k) => periods.map((p) => `${p.label}.${k}`)),
    ...others,
  ];
  const rows = plots.map((plot) => {
    const records = byPeriod.map((m) => m.get(plot));
    const now = records[records.length - 1];
    return [
      plot,
      ...records.flatMap((r) => (r ? [r.operator, new Date(r.savedAt).toISOString().slice(0, 10)] : ['', ''])),
      now?.answers[statusKey] ?? '',
      ...questions.flatMap((k) => records.map((r) => r?.answers[k] ?? '')),
      ...others.map((k) => now?.answers[k] ?? ''),
    ];
  });
  return { columns, rows };
}

/** The summary key the analysis reads an earlier period's answer from (added to each record's summary). */
export const periodSummaryKey = (label: string, key: string) => `period\u0000${label}\u0000${key}`;

/**
 * The analysis model with the earlier periods' answers as columns of the plot table, after its own: each question of
 * the plot answered in a period, named `<name>_<label>` ("land_use_category_2020"), labelled "<label> (2020)", of the
 * same type and list, with `period` set. Not the plot file's columns nor the keys, which do not change; not the
 * questions of multiple entities (the land cover's rows), which are tables of their own. `answered`: the summary keys
 * each period answered.
 */
export function withPeriodColumns(model: AnalysisModel, periods: readonly { label: string; answered: ReadonlySet<string> }[]): AnalysisModel {
  const [plot, ...rest] = model.tables;
  if (!plot || periods.length === 0) return model;
  const names = new Set(plot.columns.map((c) => c.name));
  const added: AnalysisColumn[] = [];
  for (const { label, answered } of periods) {
    const suffix = label.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'earlier';
    const nameOf = new Map<string, string>();
    const chosen = plot.columns.filter((c) => !c.keyAttr && !c.fromPlotFile && answered.has(c.key));
    for (const c of chosen) {
      let name = `${c.name}_${suffix}`;
      while (names.has(name)) name = `${name}_period`;
      names.add(name);
      nameOf.set(c.name, name);
    }
    for (const c of chosen) {
      added.push({
        ...c,
        name: nameOf.get(c.name)!,
        key: periodSummaryKey(label, c.key),
        labels: Object.fromEntries(Object.entries(c.labels).map(([lang, text]) => [lang, `${text} (${label})`])),
        parent: c.parent !== null ? (nameOf.get(c.parent) ?? null) : null,
        relevantIf: c.relevantIf !== null ? (nameOf.get(c.relevantIf) ?? null) : null,
        period: label,
      });
    }
  }
  return added.length === 0 ? model : { ...model, tables: [{ ...plot, columns: [...plot.columns, ...added] }, ...rest] };
}
