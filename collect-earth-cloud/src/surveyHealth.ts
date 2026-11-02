// Survey health (Task 6): per question of the survey, how often the first assessments
// leave it empty, how often they give an answer that looks like "other", "unknown",
// "none" or "no data", how far the checks agree with them, and how often a decision for
// the check changed it. For the next version of the survey: the questions worth
// rewording come first, each with its reasons. Two steps, as the answers per person:
// - healthTable, on the quality worker in the same job as the report (from the answer
//   table and the report's pairs, no new pass over the records);
// - surveyHealth, on the server per request, with the decisions as they are now.
import type { AnswerTable, CodeCount } from './answerStats.js';
import { MIN_PLOTS, type QualityReport } from './quality.js';
import type { Question } from './surveyOutline.js';
import type { DecisionKind } from './types.js';

// ---------------------------------------------------------------------------
// "Other", "unknown", "none", "no data"

/**
 * Whole labels (lower case, accents left out) that say other, unknown, none or no data,
 * in en, es, fr and pt. Kept short on purpose: a label matches only when it is one of
 * these, or one of these followed by a bracket, colon, slash, comma or a spaced dash
 * ("Other (specify)", "Unknown / not visible"). "Other land" and "Other wooded land" (land
 * classes), "Otherwise forested" or "No change" do not.
 */
export const OTHER_PHRASES: readonly string[] = [
  // other
  'other', 'others', 'otro', 'otra', 'otros', 'otras', 'autre', 'autres', 'outro', 'outra', 'outros', 'outras',
  // unknown
  'unknown', 'not known', "don't know", 'do not know', 'not sure', 'desconocido', 'desconocida', 'no se', 'no se sabe', 'no sabe',
  'inconnu', 'inconnue', 'ne sait pas', 'je ne sais pas', 'desconhecido', 'desconhecida', 'nao sei', 'nao sabe',
  // none
  'none', 'none of the above', 'ninguno', 'ninguna', 'ninguno de los anteriores', 'ninguna de las anteriores', 'aucun', 'aucune',
  'nenhum', 'nenhuma', 'nenhuma das anteriores',
  // no data
  'no data', 'n/a', 'not applicable', 'sin datos', 'sin informacion', 'no aplica', 'pas de donnees', 'aucune donnee', 'sans donnees',
  'non applicable', 'sans objet', 'sem dados', 'sem informacao', 'nao se aplica',
];

/** Codes that say so by themselves, for an option without a label of its own (besides the phrases). */
export const OTHER_CODES: readonly string[] = ['oth', 'unk', 'nodata', 'no_data', 'na', 'nd', '99', '999', '9999'];

const PHRASES = new Set(OTHER_PHRASES);
const CODES = new Set([...OTHER_PHRASES, ...OTHER_CODES]);
/** What may follow a phrase at the start of a label. */
const AFTER_PHRASE = /^(?:\s*[([:/,]|\s+[-–—])/;

/** Lower case, accents left out, one space between words, no full stop or asterisk at the end. */
function normal(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.…*!]+$/, '');
}

function labelSays(label: string): boolean {
  const t = normal(label);
  if (PHRASES.has(t)) return true;
  for (const p of OTHER_PHRASES) {
    if (t.startsWith(p) && AFTER_PHRASE.test(t.slice(p.length))) return true;
  }
  return false;
}

/**
 * Whether an answer option looks like "other", "unknown", "none" or "no data". With
 * labels of its own (any language), the labels decide: code 99 labelled "Forest" does
 * not, code O labelled "Other (specify)" or "Otro" does. Without (no label, or only the
 * code itself), the code decides: "other", "unknown", "99"...
 */
export function looksLikeOther(code: string, labels: readonly string[]): boolean {
  const own = labels.filter((l) => l.trim() !== '' && l.trim() !== code.trim());
  if (own.length > 0) return own.some(labelSays);
  return CODES.has(normal(code));
}

// ---------------------------------------------------------------------------
// The worker's part

export interface HealthQuestion {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  /** Collect works it out from other answers. */
  calculated: boolean;
  /** Required whatever the other answers are (Question.required): an empty one is not expected. */
  required: boolean;
  /** First assessments answering it (a code, a number). */
  answered: number;
  /** First assessments holding it with no answer ('', "null"). */
  blank: number;
  /** First assessments of a number question holding something else (text, several values). */
  nonNumeric: number;
  /** First assessments answering it with an option that looks like other (each plot once). */
  other: number;
  /** Those options, with the plots holding each (a plot of a multiple question counts once per code). */
  otherAnswers: CodeCount[];
}

/** The checked plots, with the questions that differ between the main record and the latest check. */
export interface CheckedPlots {
  groups: string[];
  /** Plot i's questions are keys[offsets[i]..offsets[i+1]), as indexes into keyNames. */
  offsets: Int32Array;
  keys: Uint32Array;
  keyNames: string[];
}

export interface HealthTable {
  /** First assessments looked at: the answer table's rows. */
  plots: number;
  questions: HealthQuestion[];
  checked: CheckedPlots;
}

/** Gathers qualityReport's checked plots (its onCheckedPlot) into typed arrays. */
export function checkedPlots(): { add: (plot: string, differing: readonly string[]) => void; done: () => CheckedPlots } {
  const groups: string[] = [];
  const offsets: number[] = [0];
  const keys: number[] = [];
  const keyNames: string[] = [];
  const keyIndex = new Map<string, number>();
  return {
    add(plot, differing) {
      groups.push(plot);
      for (const key of differing) {
        let i = keyIndex.get(key);
        if (i === undefined) {
          i = keyNames.length;
          keyNames.push(key);
          keyIndex.set(key, i);
        }
        keys.push(i);
      }
      offsets.push(keys.length);
    },
    done: () => ({ groups, offsets: Int32Array.from(offsets), keys: Uint32Array.from(keys), keyNames }),
  };
}

/** The typed arrays of a health table, to hand it over between threads without copying. */
export function healthBuffers(h: HealthTable): ArrayBufferView[] {
  return [h.checked.offsets, h.checked.keys];
}

/**
 * Per question of the answer table (asked: also those every first assessment left blank),
 * its counts; the other-like options matched on the code's labels in every language of
 * the survey (the outline's optionLabels).
 */
export function healthTable(outline: ReadonlyMap<string, Question> | null, answers: AnswerTable, checked: CheckedPlots): HealthTable {
  const choices = new Map(answers.choices.map((c) => [c.key, c]));
  const numbers = new Map(answers.numbers.map((n) => [n.key, n]));
  const questions: HealthQuestion[] = [];
  for (const a of answers.asked) {
    const q = outline?.get(a.key);
    const row: HealthQuestion = {
      key: a.key,
      label: a.label,
      kind: a.kind,
      calculated: q?.calculated === true,
      required: q?.required === true,
      answered: 0,
      blank: a.blank,
      nonNumeric: 0,
      other: 0,
      otherAnswers: [],
    };
    const n = numbers.get(a.key);
    if (n) {
      row.answered = n.rows.length;
      row.nonNumeric = n.nonNumeric.length;
    }
    const c = choices.get(a.key);
    if (c) {
      const k = c.codes.length;
      const mask = new Uint8Array(k);
      let any = false;
      for (let i = 0; i < k; i++) {
        const more = q?.optionLabels?.[c.codes[i]] ?? [];
        if (looksLikeOther(c.codes[i], [c.codeLabels[i], ...more])) {
          mask[i] = 1;
          any = true;
        }
      }
      const perCode = new Int32Array(k);
      let s = 0;
      const len = c.rows ? c.rows.length : answers.size;
      for (let j = 0; j < len; j++) {
        const v = c.values[j];
        if (v === 0) continue;
        row.answered += 1;
        if (!any) continue;
        if (v === 0xffff) {
          const r = c.rows ? c.rows[j] : j;
          while (c.several.rows[s] < r) s++;
          let hit = false;
          for (let x = c.several.offsets[s]; x < c.several.offsets[s + 1]; x++) {
            const code = c.several.codes[x];
            if (mask[code]) {
              perCode[code] += 1;
              hit = true;
            }
          }
          if (hit) row.other += 1;
        } else if (mask[v - 1]) {
          perCode[v - 1] += 1;
          row.other += 1;
        }
      }
      for (let i = 0; i < k; i++) {
        if (perCode[i] > 0) row.otherAnswers.push({ code: c.codes[i], label: c.codeLabels[i], count: perCode[i] });
      }
    }
    questions.push(row);
  }
  return { plots: answers.size, questions, checked };
}

// ---------------------------------------------------------------------------
// Per request

/** Agreement under this (with at least MIN_PLOTS checks compared) is a reason to look at the wording. */
export const LOW_AGREEMENT = 0.8;
/** An other-like answer on at least this share of the plots answering (at least MIN_PLOTS of them). */
export const OFTEN_OTHER = 0.1;
/** Left empty on at least this share of the plots where that is known (at least MIN_PLOTS of them). */
export const OFTEN_EMPTY = 0.2;
/** Changed on at least this many plots decided for the check... */
export const MIN_CHANGED = 5;
/** ...and on at least this share of them. */
export const OFTEN_CHANGED = 0.25;
/** Rows sent at most (an entity of many items can give hundreds of questions). */
export const MAX_HEALTH_ROWS = 1000;

export type HealthReason = 'low_agreement' | 'often_other' | 'often_empty' | 'often_changed';

export interface HealthRow {
  key: string;
  label: string;
  kind: 'choice' | 'number';
  calculated: boolean;
  required: boolean;
  /** First assessments answering it; holding it blank; not holding it (not known); holding a non-number in a number question. */
  answered: number;
  blank: number;
  notKnown: number;
  nonNumeric: number;
  /** blank / the plots where it is known (answered + blank + nonNumeric); null under MIN_PLOTS of those. */
  emptyShare: number | null;
  /** For a choice: the plots answering with an other-like option, its share of those answering (null under MIN_PLOTS), and the options. */
  other: { count: number; share: number | null; answers: CodeCount[] } | null;
  /** From the quality report: checks compared on it, agreeing, the rate (null under MIN_PLOTS); null when never compared. */
  agreement: { compared: number; agreeing: number; rate: number | null } | null;
  /** Plots decided for the check where its answer differs between the first assessment and that check, and the share of decidedForCheck. */
  decisions: { changed: number; share: number | null };
  /** Why it is worth rewording, the strongest first; empty when nothing stands out. */
  reasons: HealthReason[];
}

export interface SurveyHealth {
  /** First assessments looked at. */
  plots: number;
  /** Plots with a first assessment and a check (the report's). */
  plotsChecked: number;
  /** Checked plots whose decision is "the check" (the check's answers were taken). */
  decidedForCheck: number;
  /** Worth rewording first (see sortRows), then the others in the survey's order; up to MAX_HEALTH_ROWS. */
  questions: HealthRow[];
  questionsTotal: number;
  thresholds: {
    minPlots: number;
    lowAgreement: number;
    oftenOther: number;
    oftenEmpty: number;
    minChanged: number;
    oftenChanged: number;
  };
}

const groupIndexes = new WeakMap<CheckedPlots, Map<string, number>>();

function groupIndex(c: CheckedPlots): Map<string, number> {
  let m = groupIndexes.get(c);
  if (!m) {
    m = new Map(c.groups.map((g, i) => [g, i]));
    groupIndexes.set(c, m);
  }
  return m;
}

const share = (part: number, whole: number) => (whole >= MIN_PLOTS ? part / whole : null);

/**
 * The survey's health from the worker's table, the report's agreement and the decisions
 * as they are now. A question comes in when the first assessments hold its key or the
 * checks compared it.
 */
export function surveyHealth(
  figures: { report: QualityReport; health: HealthTable },
  decisions: readonly { plot: string; decision: DecisionKind }[],
): SurveyHealth {
  const { report, health } = figures;
  const { checked } = health;
  // How often each question changed on the plots decided for the check.
  const index = groupIndex(checked);
  const changedOf = new Int32Array(checked.keyNames.length);
  let decidedForCheck = 0;
  for (const d of decisions) {
    if (d.decision !== 'check') continue;
    const i = index.get(d.plot);
    if (i === undefined) continue;
    decidedForCheck += 1;
    for (let x = checked.offsets[i]; x < checked.offsets[i + 1]; x++) changedOf[checked.keys[x]] += 1;
  }
  const changed = new Map(checked.keyNames.map((k, i) => [k, changedOf[i]]));
  const agreement = new Map(report.questions.map((q) => [q.key, q]));

  const rows: HealthRow[] = [];
  const seen = new Set<string>();
  const add = (q: HealthQuestion) => {
    seen.add(q.key);
    const known = q.answered + q.blank + q.nonNumeric;
    const a = agreement.get(q.key);
    const c = changed.get(q.key) ?? 0;
    const row: HealthRow = {
      key: q.key,
      label: q.label,
      kind: q.kind,
      calculated: q.calculated,
      required: q.required,
      answered: q.answered,
      blank: q.blank,
      notKnown: Math.max(0, health.plots - known),
      nonNumeric: q.nonNumeric,
      emptyShare: share(q.blank, known),
      other: q.kind === 'choice' ? { count: q.other, share: share(q.other, q.answered), answers: q.otherAnswers } : null,
      agreement: a ? { compared: a.compared, agreeing: a.agreeing, rate: a.rate } : null,
      decisions: { changed: c, share: decidedForCheck > 0 ? c / decidedForCheck : null },
      reasons: [],
    };
    if (row.agreement?.rate != null && row.agreement.rate < LOW_AGREEMENT) row.reasons.push('low_agreement');
    if (row.other?.share != null && row.other.share >= OFTEN_OTHER) row.reasons.push('often_other');
    if (row.emptyShare !== null && row.emptyShare >= OFTEN_EMPTY) row.reasons.push('often_empty');
    if (c >= MIN_CHANGED && row.decisions.share! >= OFTEN_CHANGED) row.reasons.push('often_changed');
    rows.push(row);
  };
  for (const q of health.questions) add(q);
  // Compared by the checks but never held by a first assessment.
  for (const a of report.questions) {
    if (seen.has(a.key)) continue;
    add({ key: a.key, label: a.label, kind: a.kind, calculated: false, required: false, answered: 0, blank: 0, nonNumeric: 0, other: 0, otherAnswers: [] });
  }
  const sorted = sortRows(rows);
  return {
    plots: health.plots,
    plotsChecked: report.plotsChecked,
    decidedForCheck,
    questions: sorted.slice(0, MAX_HEALTH_ROWS),
    questionsTotal: sorted.length,
    thresholds: {
      minPlots: MIN_PLOTS,
      lowAgreement: LOW_AGREEMENT,
      oftenOther: OFTEN_OTHER,
      oftenEmpty: OFTEN_EMPTY,
      minChanged: MIN_CHANGED,
      oftenChanged: OFTEN_CHANGED,
    },
  };
}

/**
 * "Worth rewording" first: the questions with a reason, ordered by low agreement (the
 * lowest rate first), then a frequent other-like answer (the highest share first), then
 * a frequent empty answer, then a frequent change by decisions; then the others. Within
 * equal rows, the survey's order. No score: each row says its reasons.
 */
export function sortRows(rows: readonly HealthRow[]): HealthRow[] {
  const has = (r: HealthRow, why: HealthReason) => r.reasons.includes(why);
  const keyOf = (r: HealthRow): number[] => [
    r.reasons.length > 0 ? 0 : 1,
    has(r, 'low_agreement') ? r.agreement!.rate! : 2,
    has(r, 'often_other') ? -r.other!.share! : 0,
    has(r, 'often_empty') ? -r.emptyShare! : 0,
    has(r, 'often_changed') ? -r.decisions.share! : 0,
  ];
  return rows
    .map((r, i) => ({ r, i, k: keyOf(r) }))
    .sort((a, b) => {
      for (let x = 0; x < a.k.length; x++) if (a.k[x] !== b.k[x]) return a.k[x] - b.k[x];
      return a.i - b.i;
    })
    .map(({ r }) => r);
}
