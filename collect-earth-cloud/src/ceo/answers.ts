// The answers of a Collect Earth Online project (docs/plans/2026-11-09-ceo-bridge.md, Part C): CEO's sample data
// ("Download Sample Data", one row per sample point and collector) read against the project, one answer per plot and
// collector, and the records Collect Earth would have sent for them.
//
// The file's format is CEO's own (dump-project-raw-data! in src/clj/collect_earth_online/db/projects.clj and
// dump_project_sample_data in src/sql/functions/project.sql of github.com/openforis/collect-earth-online):
// - a UTF-8 mark, then the base columns, `pl_…` (the uploaded plot file's columns), `smpl_…` (the sample file's), one
//   column per question named by its text, in CEO's question order (sort-questions: the top questions by card, each
//   followed by its children, depth first, in the order of the survey's keys), and " Guest Interpreters" last;
// - a value is quoted only when it holds a comma, and its own quotes are taken out (csv-quotes); nothing else is
//   escaped, so a line break typed in an answer breaks its row;
// - one row per sample and per collector of the plot (a plot given to two people has two sets of rows); a plot nobody
//   answered has rows too, without an email;
// - a question's value is the text of the answer chosen (or typed), as saved;
// - collection_time is "YYYY-MM-dd HH:mm" (Java's week year: the last days of December can carry the next year),
//   analysis_duration "12.3 secs".
import { attr, childrenOf, parseSurvey, tagOf, type XmlNode } from '../cep.js';
import { prefixOf } from '../surveyOutline.js';
import { CeoImportError, type CeoProject, type CeoQuestion } from './project.js';
import type { Report } from './report.js';
import { CONFIDENCE_NAME, FLAGGED_NAME, type PlannedAttribute, type SurveyPlan } from './survey.js';

export { CONFIDENCE_NAME, FLAGGED_NAME };


/** CEO's base columns of the sample data (sample-base-headers). */
export const SAMPLE_BASE_HEADERS = [
  'plotid', 'sampleid', 'sample_internal_id', 'lon', 'lat', 'email', 'flagged', 'collection_time', 'analysis_duration',
  'used_geodash', 'used_kml', 'imagery_title', 'imagery_attributions', 'sample_geom', 'confidence', 'confidence_comment',
] as const;

/** The last header CEO writes, after the questions (with its leading space). */
const GUEST_HEADER = 'Guest Interpreters';

/** One plot as one collector answered it in CEO. */
export interface CeoPlotAnswers {
  /** CEO's plot id, as its collectors saw it (the id of the imported plots) */
  plot: string;
  /** the collector, as CEO knows them (never stored: the records go under a pseudonym or an account) */
  email: string;
  flagged: boolean;
  /** when it was saved, epoch milliseconds (UTC), null when CEO gave none */
  collectedAt: number | null;
  /** seconds spent on it in CEO */
  seconds: number | null;
  /** 0 to 100, when CEO asked for it */
  confidence: number | null;
  /** the answer per attribute name: a code, or the value typed */
  values: Map<string, string>;
  /** the questions whose samples did not all agree, the answer of most samples taken */
  disagreed: string[];
  /** every question shown under its answers has the answer it needs (not so when one was left out): submitted only then */
  complete: boolean;
}

export interface CeoAnswers {
  plots: CeoPlotAnswers[];
  /** the plot file's columns uploaded to CEO, per plot: by the attribute's name (plan.columns), the value */
  plotColumns: Map<string, Record<string, string>>;
  /** each collector and how many plots they answered, by email, in the order of the file */
  collectors: { email: string; plots: number }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the file

/** The rows of a CSV: fields split on commas, double quotes around a field that holds one ("" inside is a quote). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The order of a jsonb object's keys, which CEO's survey has when it is read back: shorter first, then by code unit. */
const jsonbOrder = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/** CEO's question order in its files (sort-questions): the top ones by card, each followed by its children, depth first. */
export function ceoQuestionOrder(project: CeoProject): CeoQuestion[] {
  const questions = [...project.questions].sort((a, b) => jsonbOrder(a.id, b.id));
  const out: CeoQuestion[] = [];
  const seen = new Set<string>();
  const visit = (q: CeoQuestion) => {
    if (seen.has(q.id)) return;
    seen.add(q.id);
    out.push(q);
    for (const child of questions.filter((c) => c.parentQuestionId === q.id)) visit(child);
  };
  // A stable sort, as Clojure's sort-by: cards in order, a missing card first
  const tops = questions.filter((q) => q.parentQuestionId === null).sort((a, b) => (a.cardOrder ?? -Infinity) - (b.cardOrder ?? -Infinity));
  for (const q of tops) visit(q);
  return out;
}

/** A text as CEO writes it in a CSV: its double quotes taken out (clean-str-quotes). */
const csvText = (s: string) => s.replace(/"/g, '');

/**
 * "YYYY-MM-dd HH:mm" as UTC milliseconds. CEO formats with Java's week year (YYYY): a date of the last days of December
 * that fall in the week of the next 1 January carries the next year (31 December 2024 read "2025-12-31"). That week is
 * the one of 1 January in Java's default (Sunday-first) weeks, so a December date of that week is put back a year.
 */
export function ceoTime(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(text.trim());
  if (!m) return null;
  let [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month === 12) {
    // the Sunday on or before 1 January of the year written: December days from it on belong to that week
    const firstJanuary = new Date(Date.UTC(year, 0, 1));
    const weekStart = Date.UTC(year - 1, 11, 32 - firstJanuary.getUTCDay()) ;
    if (firstJanuary.getUTCDay() !== 0 && Date.UTC(year - 1, 11, day) >= weekStart) year -= 1;
  }
  const t = Date.UTC(year, month - 1, day, Number(m[4]), Number(m[5]));
  return Number.isFinite(t) ? t : null;
}

/** "12.3 secs" as whole seconds. */
const ceoSeconds = (text: string): number | null => {
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(text);
  const seconds = m ? Math.round(Number(m[1])) : null;
  // "0.0 secs": answers loaded into CEO in bulk, with no time of their own (not a plot done in no time)
  return seconds === 0 ? null : seconds;
};

/** The prefix of the columns of the plot file uploaded to CEO, in its sample data. */
const PLOT_COLUMN_PREFIX = 'pl_';

/**
 * The columns of the plot file uploaded to CEO (`pl_…` in its sample data, without the prefix), from the file's first
 * line only: the survey reads them from the plot file, as any Collect Earth project's extra columns.
 */
export function ceoPlotColumns(csv: string): string[] {
  const end = csv.search(/\r?\n/);
  const header = parseCsv((end < 0 ? csv : csv.slice(0, end)).replace(/^\uFEFF/, ''))[0] ?? [];
  if (header[0]?.trim() !== 'plotid') return [];
  return header.map((h) => h.trim()).filter((h) => h.startsWith(PLOT_COLUMN_PREFIX) && h.length > PLOT_COLUMN_PREFIX.length).map((h) => h.slice(PLOT_COLUMN_PREFIX.length));
}

/** The code of an answer's text, among the attribute's items (labels as CEO's file writes them). */
function codeOf(attribute: PlannedAttribute, value: string): string | null {
  const v = value.trim();
  const item = attribute.items.find((i) => csvText(i.label).trim() === v) ?? attribute.items.find((i) => csvText(i.label).trim().toLowerCase() === v.toLowerCase());
  return item ? item.code : null;
}

/** The answer most samples gave (the first sample's among equals), and whether they did not all agree. */
function majority(values: string[]): { value: string; agreed: boolean } {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  for (const v of values) if ((counts.get(v) ?? 0) > (counts.get(best) ?? 0)) best = v;
  return { value: best, agreed: counts.size === 1 };
}

/**
 * The sample data saved from CEO, read against its project and the survey planned for it: one answer per plot and
 * collector. What cannot be read goes to the report: rows broken by a line break, answers that are not among a
 * question's, questions the file has not or the survey left out. Throws CeoImportError for a file that is not CEO's
 * sample data, or another project's.
 */
export function readCeoAnswers(csv: string, project: CeoProject, plan: SurveyPlan, report: Report, plotIds?: ReadonlySet<string>): CeoAnswers {
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  const header = (rows.shift() ?? []).map((h) => h.trim());
  if (header[0] !== 'plotid' || header[1] !== 'sampleid' || !header.includes('email')) {
    throw new CeoImportError("The answers file is not CEO's sample data: save it with \"Download Sample Data\" on the project's page in CEO.");
  }
  const column = (name: string) => header.indexOf(name);
  const [plotCol, emailCol, flaggedCol, timeCol, secondsCol, confidenceCol] = ['plotid', 'email', 'flagged', 'collection_time', 'analysis_duration', 'confidence'].map(column);

  // The questions' columns: the last ones before " Guest Interpreters", in CEO's order; each checked by its text
  const order = ceoQuestionOrder(project);
  const end = header[header.length - 1] === GUEST_HEADER ? header.length - 1 : header.length;
  const start = end - order.length;
  const columnOf = new Map<string, number>();
  let moved = 0;
  order.forEach((q, i) => {
    const expected = csvText(q.question || 'not-found').trim();
    if (start + i >= 0 && header[start + i] === expected) columnOf.set(q.id, start + i);
    else {
      const found = header.indexOf(expected, SAMPLE_BASE_HEADERS.length);
      if (found >= 0) {
        columnOf.set(q.id, found);
        moved++;
      }
    }
  });
  const shared = order.filter((q) => columnOf.has(q.id));
  if (shared.length === 0) {
    throw new CeoImportError("None of the answers file's columns is a question of this project: it seems to be another project's sample data.");
  }
  if (moved > 0) report.add('project', 'Answers file', 'info', `${moved} question column(s) were found by their text rather than their place: the project may have changed since the file was saved.`);
  for (const q of order) {
    if (!columnOf.has(q.id) && plan.byCeoId.has(q.id)) report.add('question', q.question, 'skipped', 'The answers file has no column for it: its answers are not imported.');
  }

  // Questions CEO writes under the same text get the same answer in every column (CEO keeps one answer per text)
  const texts = new Map<string, number>();
  for (const q of shared) texts.set(q.question, (texts.get(q.question) ?? 0) + 1);
  for (const [text, n] of texts) {
    if (n > 1) report.add('question', text, 'info', `${n} questions have this text: CEO's file holds one answer for all of them, given to each.`);
  }

  // The rows, by plot and collector
  type Group = { plot: string; email: string; flagged: boolean; collectedAt: number | null; seconds: number | null; confidence: number | null; samples: string[][] };
  const groups = new Map<string, Group>();
  let broken = 0;
  let unknownPlots = 0;
  const plotColumns = new Map<string, Record<string, string>>();
  const plotColumnCols = plan.columns
    .map((c) => ({ name: c.name, index: header.indexOf(PLOT_COLUMN_PREFIX + c.column) }))
    .filter((c) => c.index >= 0);
  for (const row of rows) {
    if (row.length === 1 && row[0].trim() === '') continue;
    if (row.length !== header.length) {
      broken++;
      continue;
    }
    const email = row[emailCol].trim();
    const plot = row[plotCol].trim();
    // The plot file's columns, the same on every row of the plot (an unanswered plot has rows too)
    if (plot !== '' && plotColumnCols.length > 0 && !plotColumns.has(plot)) {
      plotColumns.set(plot, Object.fromEntries(plotColumnCols.map(({ name, index }) => [name, row[index].trim()])));
    }
    if (email === '' || plot === '') continue; // a plot nobody answered
    if (plotIds && !plotIds.has(plot)) {
      unknownPlots++;
      continue;
    }
    const key = `${plot}\u0000${email}`;
    let group = groups.get(key);
    if (!group) {
      const confidence = confidenceCol >= 0 && /^\d+$/.test(row[confidenceCol].trim()) ? Number(row[confidenceCol].trim()) : null;
      group = {
        plot, email,
        flagged: flaggedCol >= 0 && row[flaggedCol].trim() === 'true',
        collectedAt: timeCol >= 0 ? ceoTime(row[timeCol]) : null,
        seconds: secondsCol >= 0 ? ceoSeconds(row[secondsCol]) : null,
        confidence, samples: [],
      };
      groups.set(key, group);
    }
    group.samples.push(row);
  }
  if (broken > 0) report.add('project', 'Answers file', 'skipped', `${broken} row(s) do not have the file's columns (a line break typed in an answer breaks CEO's rows): left out.`);
  if (unknownPlots > 0) report.add('plots', 'Answers of other plots', 'skipped', `${unknownPlots} row(s) are for plots that are not in the plots file: left out.`);

  // One answer per question: the samples' answers, the most given
  const unknownAnswers = new Map<string, Set<string>>();
  const badNumbers = new Map<string, number>();
  let plotsDisagreeing = 0;
  let notShown = 0;
  let incomplete = 0;
  const questionById = new Map(project.questions.map((q) => [q.id, q]));
  const plots: CeoPlotAnswers[] = [];
  for (const g of groups.values()) {
    const values = new Map<string, string>();
    const disagreed: string[] = [];
    for (const q of shared) {
      const attribute = plan.byCeoId.get(q.id);
      if (!attribute) continue;
      const given = g.samples.map((r) => r[columnOf.get(q.id)!].trim()).filter((v) => v !== '');
      if (given.length === 0) continue;
      const { value, agreed } = majority(given);
      if (!agreed) disagreed.push(attribute.name);
      if (attribute.kind === 'code') {
        const code = codeOf(attribute, value);
        if (code === null) {
          const set = unknownAnswers.get(q.question) ?? new Set<string>();
          set.add(value);
          unknownAnswers.set(q.question, set);
          continue;
        }
        values.set(attribute.name, code);
      } else if (attribute.kind === 'number') {
        const n = Number(value.replace(',', '.'));
        if (!Number.isFinite(n)) {
          badNumbers.set(q.question, (badNumbers.get(q.question) ?? 0) + 1);
          continue;
        }
        values.set(attribute.name, String(n));
      } else values.set(attribute.name, value);
    }
    // Only the answers of questions shown under the answers kept, as CEO shows them (when the samples did not agree on
    // a question, the others' answers to the questions its other answers show are not the plot's)
    for (const attribute of plan.attributes) {
      if (!values.has(attribute.name)) continue;
      const q = questionById.get(attribute.ceoId);
      const parent = q?.parentQuestionId != null ? plan.byCeoId.get(q.parentQuestionId) : undefined;
      if (!q || !parent) continue;
      const parentCode = values.get(parent.name);
      const showing = q.parentAnswerIds.length === 0 ? parentCode !== undefined
        : parent.items.some((i) => i.code === parentCode && q.parentAnswerIds.includes(i.answerId));
      if (!showing) {
        values.delete(attribute.name);
        notShown++;
      }
    }
    // Submitted only with every answer it needs: a question shown under the answers kept, required, has one
    const shown = new Map<string, boolean>();
    let complete = true;
    for (const attribute of plan.attributes) {
      const q = questionById.get(attribute.ceoId);
      const parent = q?.parentQuestionId != null ? plan.byCeoId.get(q.parentQuestionId) : undefined;
      const parentCode = parent ? values.get(parent.name) : undefined;
      const isShown = !parent || (shown.get(parent.name) === true && parentCode !== undefined
        && (q!.parentAnswerIds.length === 0 || parent.items.some((i) => i.code === parentCode && q!.parentAnswerIds.includes(i.answerId))));
      shown.set(attribute.name, isShown);
      if (isShown && attribute.required && !values.has(attribute.name)) complete = false;
    }
    if (!g.flagged && !complete) incomplete++;
    if (disagreed.length > 0) plotsDisagreeing++;
    plots.push({ plot: g.plot, email: g.email, flagged: g.flagged, collectedAt: g.collectedAt, seconds: g.seconds, confidence: g.confidence, values, disagreed, complete });
  }
  for (const [question, answers] of unknownAnswers) {
    report.add('question', question, 'skipped', `Answers that are not among the question's (changed or hidden in CEO since) were left out: ${[...answers].slice(0, 5).map((a) => `"${a}"`).join(', ')}${answers.size > 5 ? '…' : ''}.`);
  }
  for (const [question, n] of badNumbers) report.add('question', question, 'skipped', `${n} answer(s) that are not numbers were left out.`);

  const byEmail = new Map<string, number>();
  for (const p of plots) byEmail.set(p.email, (byEmail.get(p.email) ?? 0) + 1);
  const collectors = [...byEmail].map(([email, n]) => ({ email, plots: n }));
  const flagged = plots.filter((p) => p.flagged).length;
  report.add('plots', 'Answers', 'imported',
    `${plots.length} plot answer(s) from ${collectors.length} collector(s)${flagged ? `, ${flagged} of them flagged (kept, not submitted)` : ''}: one record per plot and collector, answered once for the plot.`);
  if (incomplete > 0) {
    report.add('plots', 'Answers missing', 'changed',
      `${incomplete} plot answer(s) lack an answer they need (left out above): kept, but not submitted, so the plot can be answered again.`);
  }
  if (notShown > 0) {
    report.add('plots', 'Answers of questions not shown', 'skipped',
      `${notShown} answer(s) were to questions that the answers kept do not show (samples answered differently): left out.`);
  }
  if (plotsDisagreeing > 0) {
    report.add('plots', 'Samples that disagree', 'changed',
      `In ${plotsDisagreeing} plot answer(s) the samples were not all given the same answer to a question: the answer of most samples is kept (of equals, the first sample's).`);
  }
  if (plotColumnCols.length > 0) {
    report.add('plots', 'Plot information', 'imported',
      `The columns of the plot file uploaded to CEO come with each plot, in the plot file and on each record: ${plan.columns.map((c) => `${c.column} (as "${c.name}")`).join(', ')}.`);
  }
  return { plots, collectors, plotColumns };
}

// ---------------------------------------------------------------------------------------------------------------
// The records

/** One record, as Collect Earth's CloudRecordSerializer would send it. */
export interface ImportedRecord {
  recordKey: string;
  operator: string;
  modifiedOn: number;
  activelySaved: boolean;
  xml: string;
  summary: Record<string, string>;
  activeSeconds: number | null;
}

interface RootAttribute {
  name: string;
  tag: string;
  /** the summary key, null for an attribute Collect Earth does not summarize */
  key: string | null;
}

/** The attributes of the survey's root entity, in its order (the survey as stored: round and note added). */
export function rootAttributes(idmXml: string): { root: string; attributes: RootAttribute[] } {
  const { root, rootEntity } = parseSurvey(idmXml);
  const attributes = childrenOf(root as XmlNode)
    .filter((n) => tagOf(n) !== null && !tagOf(n)!.startsWith('#') && !['label', 'description', 'entity'].includes(tagOf(n)!) && attr(n, 'name'))
    .map((n) => {
      const prefix = prefixOf(n);
      return { name: attr(n, 'name')!, tag: tagOf(n)!, key: prefix ? `collect_${prefix}${attr(n, 'name')}` : null };
    });
  return { root: rootEntity, attributes };
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A number as Java's Double.toString writes an ordinary one (Collect Earth's real values): 2015 is "2015.0". */
export const javaDouble = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** An instant as Collect's DataMarshaller writes created and modified: 2026-11-10T01:20:21.845+00:00 */
const xmlTime = (t: number) => new Date(t).toISOString().replace('Z', '+00:00');

const two = (n: number) => String(n).padStart(2, '0');

/** Whether a plot answer counts as submitted: not flagged, and with every answer it needs. */
export const submitted = (p: CeoPlotAnswers) => !p.flagged && p.complete;

/**
 * The records of the answers, as Collect Earth would have sent them from the stored survey: the XML of Collect's
 * DataMarshaller (every root attribute, empty ones as empty elements) and the summary of
 * BalloonInputFieldsUtils.getValuesByHtmlParameters (every summarized attribute, '' when empty).
 */
export function ceoRecords(
  answers: readonly CeoPlotAnswers[],
  options: {
    surveyXml: string;
    /** the first round's code when the survey has the round key (as the plot file's) */
    roundCode: string | null;
    operatorOf: (email: string) => string;
    plotFile: string;
    centres: ReadonlyMap<string, { lat: number; lon: number }>;
    /** the plot file's columns uploaded to CEO, per plot (CeoAnswers.plotColumns) */
    plotColumns?: ReadonlyMap<string, Record<string, string>>;
    now: number;
  },
): ImportedRecord[] {
  const { root, attributes } = rootAttributes(options.surveyXml);
  const hasRound = attributes.some((a) => a.name === 'round');
  return answers.map((p) => {
    const at = p.collectedAt ?? options.now;
    const date = new Date(at);
    const operator = options.operatorOf(p.email);
    const centre = options.centres.get(p.plot);
    const fixed = new Map<string, string>([
      ['id', p.plot],
      ['operator', operator],
      ['actively_saved', submitted(p) ? 'true' : 'false'],
      ['plot_file', options.plotFile],
      ['elevation', '0'],
      ['slope', '0'],
      ['aspect', '0'],
      [FLAGGED_NAME, p.flagged ? 'true' : 'false'],
    ]);
    if (hasRound && options.roundCode !== null) fixed.set('round', options.roundCode);
    if (p.confidence !== null) fixed.set(CONFIDENCE_NAME, String(p.confidence));
    for (const [name, value] of Object.entries(options.plotColumns?.get(p.plot) ?? {})) if (value !== '') fixed.set(name, value);

    const xml: string[] = [`<?xml version='1.0' standalone='yes' ?>`, `<${root} step="1" created="${xmlTime(at)}" modified="${xmlTime(at)}">`];
    const summary: Record<string, string> = {};
    for (const a of attributes) {
      let value = p.values.get(a.name) ?? fixed.get(a.name) ?? null;
      let text = '';
      if (a.name === 'location' && a.tag === 'coordinate') {
        if (centre) {
          xml.push(`  <location>\n    <x>${centre.lon}</x>\n    <y>${centre.lat}</y>\n    <srs>EPSG:4326</srs>\n  </location>`);
          text = `${javaDouble(centre.lat)},${javaDouble(centre.lon)}`;
        } else xml.push('  <location />');
        if (a.key) summary[a.key] = text;
        continue;
      }
      if (a.name === 'actively_saved_on' && a.tag === 'date') {
        xml.push(`  <actively_saved_on>\n    <year>${date.getUTCFullYear()}</year>\n    <month>${date.getUTCMonth() + 1}</month>\n    <day>${date.getUTCDate()}</day>\n  </actively_saved_on>`);
        if (a.key) summary[a.key] = `${two(date.getUTCMonth() + 1)}/${two(date.getUTCDate())}/${date.getUTCFullYear()}`;
        continue;
      }
      if (value === null) {
        xml.push(`  <${a.name} />`);
        if (a.key) summary[a.key] = '';
        continue;
      }
      if (a.tag === 'number' && a.key?.startsWith('collect_real_')) value = javaDouble(Number(value));
      else if (a.tag === 'number') value = String(Math.round(Number(value)));
      const field = a.tag === 'code' ? 'code' : 'value';
      xml.push(`  <${a.name}>\n    <${field}>${escapeXml(value)}</${field}>\n  </${a.name}>`);
      text = value;
      if (a.key) summary[a.key] = text;
    }
    xml.push(`</${root}>`, '');
    return {
      recordKey: hasRound && options.roundCode !== null ? `${p.plot},${options.roundCode}` : p.plot,
      operator,
      modifiedOn: at,
      activelySaved: submitted(p),
      xml: xml.join('\n'),
      summary,
      activeSeconds: p.seconds,
    };
  });
}
