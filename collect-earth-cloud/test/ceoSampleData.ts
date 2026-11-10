// CEO's sample data ("Download Sample Data"), written as CEO writes it, for the tests of the answers' import (Part C
// of docs/plans/2026-11-09-ceo-bridge.md). CEO gives this file to a project's administrators only, so the fixtures
// are made here, by the rules of CEO's code (github.com/openforis/collect-earth-online):
// - dump-project-raw-data! (src/clj/collect_earth_online/db/projects.clj): the UTF-8 mark, sample-base-headers, the
//   questions' texts in sort-questions order, ", Guest Interpreters"; each row the base values, the answers by question
//   text (extract-answers: one per text), then "," and the guest names (none in a regular project);
// - csv-quotes: double quotes taken out, the value quoted only when it holds a comma;
// - format-time: "YYYY-MM-dd HH:mm" with Java's week year; analysis_duration as "N secs";
// - dump_project_sample_data (src/sql/functions/project.sql): one row per sample and per collector of the plot, and
//   rows without a collector for a plot nobody answered.
// `npx tsx test/ceoSampleData.ts` writes the fixtures (test/fixtures/ceo/project-<id>-samples.csv) again.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SAMPLE_BASE_HEADERS = [
  'plotid', 'sampleid', 'sample_internal_id', 'lon', 'lat', 'email', 'flagged', 'collection_time', 'analysis_duration',
  'used_geodash', 'used_kml', 'imagery_title', 'imagery_attributions', 'sample_geom', 'confidence', 'confidence_comment',
];

interface RawQuestion { question?: string; parentQuestionId: number; cardOrder?: number | null }

/** One plot as one collector answered it, in CEO: an answer text per question id, per sample (one object per sample). */
export interface SampleAnswer {
  plot: number;
  email: string;
  flagged?: boolean;
  /** UTC */
  collectedAt: Date;
  seconds: number;
  confidence?: number | null;
  samples: Record<string, string>[];
}

const csvQuotes = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const s = String(value);
  const cleaned = s.replace(/"/g, '');
  return typeof value === 'string' && s.includes(',') ? `"${cleaned}"` : cleaned;
};

/** sort-questions: the top questions by card (a stable sort, over the keys in jsonb order), children depth first. */
function sortQuestions(questions: Record<string, RawQuestion>): [string, RawQuestion][] {
  const entries = Object.entries(questions).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
  const append = (list: [string, RawQuestion][]): [string, RawQuestion][] =>
    list.flatMap((cur) => [cur, ...append(entries.filter(([, q]) => q.parentQuestionId === Number(cur[0])))]);
  return append(entries.filter(([, q]) => q.parentQuestionId === -1).sort(([, a], [, b]) => (a.cardOrder ?? -Infinity) - (b.cardOrder ?? -Infinity)));
}

/** Java's "YYYY-MM-dd HH:mm" in UTC, YYYY being the week year of Java's default (Sunday-first, US) weeks. */
function formatTime(d: Date): string {
  let year = d.getUTCFullYear();
  if (d.getUTCMonth() === 11) {
    const next = new Date(Date.UTC(year + 1, 0, 1));
    const weekStart = Date.UTC(year, 11, 32 - next.getUTCDay());
    if (next.getUTCDay() !== 0 && d.getTime() >= weekStart) year += 1;
  }
  const two = (n: number) => String(n).padStart(2, '0');
  return `${year}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** The sample data of a project (its get-project-by-id JSON and get-project-plots list), with these answers. */
export function ceoSampleCsv(projectJson: string, plotsJson: string, answers: SampleAnswer[]): string {
  const project = JSON.parse(projectJson) as { surveyQuestions: Record<string, RawQuestion>; samplesPerPlot: number };
  const plots = JSON.parse(plotsJson) as { id: number; center: string }[];
  const questions = sortQuestions(project.surveyQuestions);
  const header = '﻿' + [...SAMPLE_BASE_HEADERS, ...questions.map(([, q]) => q.question ?? 'not-found')].map(csvQuotes).join(',') + ', Guest Interpreters';
  const lines = [header];
  let internal = 1000;
  for (const plot of plots) {
    const [lon, lat] = (JSON.parse(plot.center) as { coordinates: [number, number] }).coordinates;
    const answered = answers.filter((a) => a.plot === plot.id);
    const sets = answered.length > 0 ? answered : [null];
    for (const a of sets) {
      const count = a ? a.samples.length : Math.max(1, project.samplesPerPlot);
      for (let s = 0; s < count; s++) {
        const sampleLon = lon + s * 1e-5;
        const sampleLat = lat - s * 1e-5;
        // extract-answers: by question text, a later question of the same text wins
        const byText = new Map<string, string>();
        if (a) for (const [id, q] of questions) if (a.samples[s][id] !== undefined) byText.set(q.question ?? 'not-found', a.samples[s][id]);
        const base: Record<string, unknown> = {
          plotid: plot.id, sampleid: s + 1, sample_internal_id: internal++, lon: sampleLon, lat: sampleLat,
          email: a?.email ?? null, flagged: a ? a.flagged === true : null,
          collection_time: a ? formatTime(a.collectedAt) : null, analysis_duration: a ? `${a.seconds} secs` : null,
          used_geodash: a ? false : null, used_kml: a ? false : null, imagery_title: a ? 'Mapbox Satellite' : null,
          sample_geom: `POINT(${sampleLon} ${sampleLat})`, confidence: a?.confidence ?? null, confidence_comment: null,
        };
        const row = [...SAMPLE_BASE_HEADERS.map((h) => csvQuotes(base[h])), ...questions.map(([, q]) => csvQuotes(byText.get(q.question ?? 'not-found') ?? ''))];
        lines.push(row.join(',') + ',');
      }
    }
  }
  return lines.join('\n');
}

const FIXTURES = fileURLToPath(new URL('./fixtures/ceo/', import.meta.url));

/** The answers of the fixtures: every case the import reads, on real projects and their real plots. */
export const FIXTURE_ANSWERS: Record<number, SampleAnswer[]> = {
  // Nepal (20170): one sample per plot, questions three deep, text and number inputs
  20170: [
    // three deep, a text with a comma; saved on 31 December 2024, which CEO writes "2025-12-31"
    { plot: 138814414, email: 'ana@example.org', collectedAt: new Date(Date.UTC(2024, 11, 31, 10, 5)), seconds: 95.4,
      samples: [{ 1: 'Degradation', 2: 'yes', 3: 'Other', 6: 'logging road, near the river', 4: 'High', 7: '2015' }] },
    // the same plot by a second collector (CEO's quality checks)
    { plot: 138814414, email: 'ben@example.org', collectedAt: new Date(Date.UTC(2024, 11, 20, 8, 30)), seconds: 41,
      samples: [{ 1: 'Stable Forest', 2: 'no', 4: 'Medium ', 7: '2001' }] },
    // quotes typed in a text answer, which CEO takes out
    { plot: 138814419, email: 'ben@example.org', collectedAt: new Date(Date.UTC(2025, 2, 3, 14, 0)), seconds: 63,
      samples: [{ 1: 'Other', 2: 'no', 5: 'river bed "gravel"', 4: 'Low', 7: '2010' }] },
    // flagged: no answers
    { plot: 138814420, email: 'ana@example.org', flagged: true, collectedAt: new Date(Date.UTC(2025, 2, 4, 9, 0)), seconds: 12, samples: [{}] },
    // an answer whose text CEO no longer has (changed since): left out
    { plot: 138814421, email: 'ana@example.org', collectedAt: new Date(Date.UTC(2025, 2, 4, 9, 30)), seconds: 30,
      samples: [{ 1: 'Forest (old name)', 4: 'High', 7: '1999' }] },
  ],
  // Kenya practice (30918): 49 samples per plot, confidence, numbers typed
  30918: [
    // the samples do not all agree: 30 say Yes, 19 say No
    { plot: 1425, email: 'carla@example.org', confidence: 80, collectedAt: new Date(Date.UTC(2025, 5, 2, 7, 45)), seconds: 210,
      samples: Array.from({ length: 49 }, (_, i): Record<string, string> => (i < 30
        ? { 0: 'Yes', 1: 'Decreasing', 2: 'Montane forest', 3: '60', 4: '2015', 5: '20', 6: 'Logging', 22: 'Selective logging' }
        : { 0: 'No', 14: 'No', 21: 'Grassland', 22: 'Selective logging' })) },
    // all agree, a decimal typed
    { plot: 1680, email: 'carla@example.org', confidence: 100, collectedAt: new Date(Date.UTC(2025, 5, 2, 8, 0)), seconds: 95,
      samples: Array.from({ length: 49 }, () => ({ 0: 'Yes', 1: 'Stable Forest', 11: 'Stable Forest', 12: 'Coastal forest', 13: '72.5' })) },
  ],
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [id, answers] of Object.entries(FIXTURE_ANSWERS)) {
    const csv = ceoSampleCsv(readFileSync(`${FIXTURES}project-${id}.json`, 'utf8'), readFileSync(`${FIXTURES}project-${id}-plots.json`, 'utf8'), answers);
    writeFileSync(`${FIXTURES}project-${id}-samples.csv`, csv);
    console.log(`project-${id}-samples.csv: ${csv.split('\n').length - 1} rows`);
  }
}
