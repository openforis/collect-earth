// CEO's sample data ("Download Sample Data"), written as CEO writes it, for the tests of the answers' import (Part C
// of docs/plans/2026-11-09-ceo-bridge.md). CEO gives this file to a project's administrators only, so the fixtures
// are made here, by the rules of CEO's code (github.com/openforis/collect-earth-online):
// - dump-project-raw-data! (src/clj/collect_earth_online/db/projects.clj): the UTF-8 mark, sample-base-headers, the
//   questions' texts in sort-questions order, ", Guest Interpreters"; each row the base values, the answers by question
//   text (extract-answers: one per text), then "," and the guest names (none in a regular project);
// - csv-quotes: double quotes taken out, the value quoted only when it holds a comma;
// - format-time: "YYYY-MM-dd HH:mm" with Java's week year; analysis_duration as "N.N secs" (rounded to a tenth);
// - the plot file uploaded to CEO: its columns as `pl_<name>` after the base columns, on every row of the plot;
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

/** The columns of a plot file uploaded to CEO (extra_plot_info: `pl_<name>` in the file), in their order, and their values. */
export interface PlotColumns {
  names: string[];
  of: (plot: number) => Record<string, string>;
}

/** The sample data of a project (its get-project-by-id JSON and get-project-plots list), with these answers. */
export function ceoSampleCsv(projectJson: string, plotsJson: string, answers: SampleAnswer[], plotColumns?: PlotColumns): string {
  const project = JSON.parse(projectJson) as { surveyQuestions: Record<string, RawQuestion>; samplesPerPlot: number };
  const plots = JSON.parse(plotsJson) as { id: number; center: string }[];
  const questions = sortQuestions(project.surveyQuestions);
  const plHeaders = (plotColumns?.names ?? []).map((n) => `pl_${n}`);
  const header = '\uFEFF' + [...SAMPLE_BASE_HEADERS, ...plHeaders, ...questions.map(([, q]) => q.question ?? 'not-found')].map(csvQuotes).join(',') + ', Guest Interpreters';
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
          collection_time: a ? formatTime(a.collectedAt) : null, analysis_duration: a ? `${a.seconds.toFixed(1)} secs` : null,
          used_geodash: a ? false : null, used_kml: a ? false : null, imagery_title: a ? 'Mapbox Satellite' : null,
          sample_geom: `POINT(${sampleLon} ${sampleLat})`, confidence: a?.confidence ?? null, confidence_comment: null,
        };
        const pl = plotColumns?.of(plot.id) ?? {};
        const row = [...SAMPLE_BASE_HEADERS.map((h) => csvQuotes(base[h])), ...(plotColumns?.names ?? []).map((n) => csvQuotes(pl[n] ?? '')), ...questions.map(([, q]) => csvQuotes(byText.get(q.question ?? 'not-found') ?? ''))];
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

// RLCMS Cambodia (37): shaped as a real download of its sample data is (the answers made up here): 25 samples per plot,
// the columns of the plot file uploaded to CEO, most answers loaded in bulk (one date, "0.0 secs"), samples that disagree
// (land cover per point), a guest, flagged plots and plots nobody answered (93, 105, 114)
const LAND_COVERS = ['Crop', 'Tree Other', 'Water', 'Tree Plantation/Orchard', 'Shrub', 'Built Surface', 'Grass'];
const BULK = new Date(Date.UTC(2019, 2, 1, 0, 0));
const lulc = (cover: string): Record<string, string> => ({ 1: cover });
const samples = (first: string, second: string | null) => Array.from({ length: 25 }, (_, i) => lulc(second !== null && i >= 15 ? second : first));
FIXTURE_ANSWERS[37] = [
  ...Array.from({ length: 40 }, (_, i): SampleAnswer => {
    const plot = i + 1;
    const cover = plot === 1 ? 'Aquatic Veg. Other' : LAND_COVERS[plot % LAND_COVERS.length];
    // every fourth plot: 15 points of one land cover, 10 of another
    const other = plot % 4 === 0 ? LAND_COVERS[(plot + 3) % LAND_COVERS.length] : null;
    return { plot, email: plot <= 25 ? 'collector-1@example.org' : 'collector-2@example.org', collectedAt: BULK, seconds: 0, samples: samples(cover, other) };
  }),
  ...[115, 143, 152, 201].map((plot): SampleAnswer => ({ plot, email: 'collector-1@example.org', flagged: true, collectedAt: BULK, seconds: 0, samples: Array.from({ length: 25 }, () => ({})) })),
  { plot: 227, email: 'guest', collectedAt: new Date(Date.UTC(2024, 1, 12, 3, 14)), seconds: 179, samples: samples('Crop', null) },
  { plot: 246, email: 'collector-3@example.org', collectedAt: new Date(Date.UTC(2021, 8, 14, 10, 2)), seconds: 277.7, samples: samples('Tree Other', 'Grass') },
  { plot: 253, email: 'collector-4@example.org', collectedAt: new Date(Date.UTC(2020, 7, 3, 16, 40)), seconds: 58, samples: samples('Built Surface', null) },
];
const FIXTURE_PLOT_COLUMNS: Record<number, PlotColumns> = {
  37: { names: ['year', 'class', 'country', 'countryname'], of: (plot) => ({ year: '2013', class: String((plot % 3) * 2), country: '5', countryname: 'Cambodia' }) },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const [id, answers] of Object.entries(FIXTURE_ANSWERS)) {
    const csv = ceoSampleCsv(readFileSync(`${FIXTURES}project-${id}.json`, 'utf8'), readFileSync(`${FIXTURES}project-${id}-plots.json`, 'utf8'), answers, FIXTURE_PLOT_COLUMNS[Number(id)]);
    writeFileSync(`${FIXTURES}project-${id}-samples.csv`, csv);
    console.log(`project-${id}-samples.csv: ${csv.split('\n').length - 1} rows`);
  }
}
