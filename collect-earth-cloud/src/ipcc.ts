// Collect Earth's IPCC exports (the desktop's LULUCF package, org.openforis.collect.earth.ipcc in collect-earth-app),
// made from the plots' first assessments and the survey instead of the database the desktop generates for them
// (IPCCRDBGenerator):
// - each plot's land use category and subdivision in each year from 2000 to 2023, by the rules IPCCSurveyAdapter
//   writes into the survey as calculated questions (or read from the survey's own, when it has them);
// - the files made of them, each as its desktop class makes it (named on each function).
// The areas are the plots' expansion factors, the Analysis page's (routes/analysis.ts, projectFactors).
import { randomUUID } from 'node:crypto';
import { cell, type AnalysisColumn, type AnalysisModel } from './analysis.js';
import { attr, childrenOf, elements, parseSurvey, textOf } from './cep.js';
import type { XlsxCell, XlsxSheet } from './xlsx.js';

/** IPCCGenerator's START_YEAR and END_YEAR: the same years as the desktop's files. */
export const IPCC_START_YEAR = 2000;
export const IPCC_END_YEAR = 2023;
const YEARS = Array.from({ length: IPCC_END_YEAR - IPCC_START_YEAR + 1 }, (_, i) => IPCC_START_YEAR + i);

/** LandUseCategoryEnum: the codes of the six categories, in its order (their ids are 1 to 6). */
export const IPCC_CATEGORIES = ['F', 'C', 'G', 'W', 'S', 'O'] as const;
export type IpccCategory = (typeof IPCC_CATEGORIES)[number];

/** The management types of each category (IpccForm.managementTypes), and the one IPCCLandUses gives a subdivision. */
export const MANAGEMENT_TYPES: Record<IpccCategory, readonly string[]> = {
  F: ['MANAGED', 'UNMANAGED'],
  C: ['ANNUAL', 'PERENNIAL'],
  G: ['MANAGED', 'UNMANAGED'],
  W: ['MANAGED', 'UNMANAGED'],
  S: ['TREED', 'OTHER'],
  O: ['MANAGED', 'UNMANAGED'],
};
const DEFAULT_MANAGEMENT: Record<IpccCategory, string> = { F: 'MANAGED', C: 'ANNUAL', G: 'MANAGED', W: 'UNMANAGED', S: 'OTHER', O: 'UNMANAGED' };
/** What the management types print (their enums' toString), in the matrices' headers. */
const MANAGEMENT_NAMES: Record<string, string> = { MANAGED: 'Managed', UNMANAGED: 'Unmanaged', ANNUAL: 'Annual', PERENNIAL: 'Perennial', TREED: 'Treed', OTHER: 'Other' };

/**
 * The strata labels the desktop knows, with the IPCC software's ids: plots of another climate or soil are in no stratum.
 * ClimateTypeEnum (id, climate domain), SoilTypeEnum (id, composition id), EcozoneTypeEnum (id).
 */
const CLIMATES: Record<string, [number, string]> = {
  TRW: [1, 'TROPICAL'],
  TMM: [2, 'TROPICAL'],
  TRD: [4, 'TROPICAL'],
  TRMT: [5, 'TROPICAL'],
  TRMTD: [6, 'TROPICAL'],
  WTM: [7, 'MEDITERRANEAN'],
  WTD: [8, 'MEDITERRANEAN'],
  CTM: [9, 'TEMPERATE'],
  CTD: [10, 'TEMPERATE'],
  BOM: [11, 'BOREAL'],
  BOD: [12, 'BOREAL'],
  POM: [13, 'POLAR'],
  POD: [14, 'POLAR'],
  NO_DATA: [15, 'NO_DATA'],
};
const SOILS: Record<string, [number, number]> = { HAC: [1, 1], LAC: [2, 1], VOL: [3, 1], SPO: [4, 1], SAN: [5, 1], WET: [6, 1], ORG: [7, 2], OtherAreas: [9, 3], NO_DATA: [0, 0] };
const ECOZONES: Record<string, number> = { TAr: 2, TAwa: 4, TAWb: 5, TBSh: 6, TBWh: 7, TM: 8, SCf: 9, SCs: 10, SBSh: 11, SBWh: 12, SM: 13, TeDo: 14, TeDc: 17, TeBSk: 18, TeBWk: 19, TeM: 20, Ba: 21, Bb: 22, BM: 23, P: 24, NA: 25, NO_DATA: 0 };
/** The label of a code the plot does not have (the database's default code row). */
const NO_LABEL = 'N/A';

/** The questions of the survey's IPCC template the land uses are worked out from, and those of the strata. */
const QUESTIONS = {
  subcategory: 'land_use_subcategory',
  subdivision: 'land_use_subdivision',
  initialSubdivision: 'land_use_initial_subdivision',
  changeYear: 'land_use_subcategory_year_of_change',
  subdivisionChanged: 'land_use_subdivision_change',
  subdivisionYear: 'land_use_subdivision_year_of_change',
  secondChange: 'second_lu_change',
  secondConversion: 'second_lu_conversion',
  secondYear: 'second_lu_conversion_year',
  secondSubdivision: 'second_lu_subdivision',
  climate: 'climate',
  soil: 'soil',
  gez: 'gez',
} as const;
type Question = keyof typeof QUESTIONS;
export type IpccAnswers = Record<Question, string>;
type Stratum = 'climate' | 'soil' | 'gez';

/** A land use subdivision of the survey (AbstractLandUseSubdivision). */
export interface Subdivision {
  category: IpccCategory;
  code: string;
  /** Its label in the survey's first language. */
  name: string;
  /** Its number in its category, from 1. */
  id: number;
  /** One of MANAGEMENT_TYPES of its category. */
  management: string;
}

export interface IpccSurvey {
  /** What the survey lacks for the exports (question or list names): none when they can be made. */
  missing: string[];
  columns: Record<Question, AnalysisColumn>;
  /** The survey's own ipcc_<year>_category and _subdivision questions, by year. */
  own: Map<number, [AnalysisColumn, AnalysisColumn]>;
  /** The plot's id question (the desktop's files name plots by it). */
  id: AnalysisColumn | undefined;
  subdivisions: Subdivision[];
  /** The labels of the strata's codes, in their lists' order. */
  labels: Record<Stratum, Map<string, string>>;
}

/** What the exports need of the survey (IPCCSurveyAdapter.checkSurveyLUAttributes, IPCCLandUses), and what it lacks. */
export function ipccSurvey(model: AnalysisModel): IpccSurvey {
  const plot = model.tables[0].columns;
  const columnOf = (name: string) => plot.find((c) => c.name === name && !c.multiple);
  const missing: string[] = [];
  const columns = {} as Record<Question, AnalysisColumn>;
  for (const [key, name] of Object.entries(QUESTIONS) as [Question, string][]) {
    const c = columnOf(name);
    if (c) columns[key] = c;
    else missing.push(name);
  }
  const own = new Map<number, [AnalysisColumn, AnalysisColumn]>();
  for (const year of YEARS) {
    const category = columnOf(`ipcc_${year}_category`);
    const subdivision = columnOf(`ipcc_${year}_subdivision`);
    if (category && subdivision) own.set(year, [category, subdivision]);
  }
  const language = model.languages[0] ?? '';
  const listOf = (c: AnalysisColumn | undefined) => (c?.list ? model.lists[c.list] : undefined);
  // The subdivisions: the items under the six categories of the land use list, category by category
  const landUses = listOf(columns.subdivision) ?? [];
  const subdivisions = IPCC_CATEGORIES.flatMap((category) =>
    landUses
      .filter((i) => i.level === 1 && i.parent === category)
      .map((i, n): Subdivision => ({ category, code: i.code, name: i.labels[language] ?? '', id: n + 1, management: DEFAULT_MANAGEMENT[category] })),
  );
  if (columns.subdivision && subdivisions.length === 0) missing.push(columns.subdivision.list ?? 'land_uses');
  const labels = {} as IpccSurvey['labels'];
  for (const s of ['climate', 'soil', 'gez'] as const) {
    const list = listOf(columns[s]);
    if (columns[s] && !list) missing.push(columns[s].list ?? s);
    labels[s] = new Map((list ?? []).map((i) => [i.code, i.labels[language] ?? '']));
  }
  return { missing, columns, own, subdivisions, labels, id: columnOf('id') };
}

/** One plot, as the exports read it: its first assessment's answers and its land uses year by year. */
export interface IpccPlot {
  id: string;
  /** The hectares it stands for (its expansion factor), null without. */
  area: number | null;
  answers: IpccAnswers;
  /** The category and subdivision codes of each year from IPCC_START_YEAR to IPCC_END_YEAR ("" when none). */
  years: { category: string; subdivision: string }[];
  summary: Record<string, string>;
}

/** The plots of their first assessments: `id` is the plot's unit, when the survey has no id question. */
export function ipccPlots(survey: IpccSurvey, firsts: Iterable<{ id: string; summary: Record<string, string>; area: number | null }>): IpccPlot[] {
  const out: IpccPlot[] = [];
  for (const { id, summary, area } of firsts) {
    const answers = {} as IpccAnswers;
    for (const key of Object.keys(QUESTIONS) as Question[]) answers[key] = cell(survey.columns[key], summary[survey.columns[key].key]);
    const years = YEARS.map((year) => {
      // The survey's own questions when it has them: the desktop adds its rules only to a survey without them
      const own = survey.own.get(year);
      return own ? { category: cell(own[0], summary[own[0].key]), subdivision: cell(own[1], summary[own[1].key]) } : landUseIn(answers, year);
    });
    out.push({ id: (survey.id && cell(survey.id, summary[survey.id.key])) || id, area, answers, years, summary });
  }
  return out;
}

/** A year question's answer as a number; NaN when none (no comparison holds then, as in Collect's expressions). */
const yearOf = (v: string) => (v.trim() === '' ? NaN : Number(v));

/**
 * The plot's land use category and subdivision in a year: the defaults IPCCSurveyAdapter gives ipcc_<year>_subcategory,
 * _category and _subdivision, in their order, the first that applies (a land use change counts for 20 years).
 */
export function landUseIn(a: IpccAnswers, year: number): { category: string; subdivision: string } {
  const previous = a.subcategory.slice(0, 1);
  const current = a.subcategory.slice(1, 2);
  // the survey's land_use_category_has_changed, land_use_change_once and ipcc_oldest_category
  const changed = previous !== current;
  const second = a.secondChange === 'true';
  const subdivisionChanged = a.subdivisionChanged === 'true';
  const changedOnce = changed || subdivisionChanged;
  const oldest = second ? a.secondConversion.slice(0, 1) : previous;
  const changeYear = yearOf(a.changeYear);
  const secondYear = yearOf(a.secondYear);
  const subdivisionYear = yearOf(a.subdivisionYear);
  const threshold = year - 20;

  let conversion = '';
  if (!changed && !second) conversion = a.subcategory;
  else if (changed && changeYear <= year && changeYear >= threshold) conversion = a.subcategory;
  else if (changeYear < threshold) conversion = current + current;
  else if (changed && !second && changeYear > year) conversion = previous + previous;
  else if (second && secondYear <= year && secondYear >= threshold) conversion = oldest + previous;
  else if (second && secondYear < threshold) conversion = previous + previous;
  else if (second && secondYear >= threshold) conversion = oldest + oldest;

  let subdivision = '';
  if (!changedOnce) subdivision = a.subdivision;
  else if (changed && !subdivisionChanged && changeYear <= year) subdivision = a.subdivision;
  else if (second && !changed && subdivisionChanged && subdivisionYear > year && secondYear <= year) subdivision = a.initialSubdivision;
  else if (second && !changed && subdivisionChanged && subdivisionYear <= year) subdivision = a.subdivision;
  else if (changed && !second && changeYear > year) subdivision = a.initialSubdivision;
  else if (second && secondYear <= year) subdivision = a.initialSubdivision;
  else if (second && secondYear > year) subdivision = a.secondSubdivision;
  else if (!second && changed && subdivisionChanged && subdivisionYear > year && changeYear <= year) subdivision = a.initialSubdivision;
  else if (!second && changed && subdivisionChanged && subdivisionYear <= year) subdivision = a.subdivision;
  else if (!changed && subdivisionChanged && subdivisionYear > year) subdivision = a.initialSubdivision;
  else if (!changed && subdivisionChanged && subdivisionYear <= year) subdivision = a.subdivision;

  return { category: conversion.slice(1, 2), subdivision };
}

/** What a subdivision prints (AbstractLandUseSubdivision.toString): category / management type / name (or code). */
export const subdivisionText = (s: Subdivision) => `${s.category} / ${MANAGEMENT_NAMES[s.management]} / ${s.name || s.code}`;

/** Java's String.compareTo. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** AbstractLandUseSubdivision.compareTo: by category code, then by code. */
const bySubdivision = (a: Subdivision, b: Subdivision) => (a.category === b.category ? compare(a.code, b.code) : compare(a.category, b.category));

/** The plots that went from one land use to another between a year and the next, with their area. */
interface Transition {
  from: Subdivision | null;
  to: Subdivision | null;
  area: number;
}

/**
 * The plots' land uses in a year and the next, grouped by categories and subdivisions with the sum of their areas
 * (AbstractIPCCDataExportTimeSeries.generateLUTimeseriesForStrata, IPCCDataExportMatrixExcel.generateLUMatrixForYear);
 * a subdivision not in the survey is null (LandUseSubdivisionUtils.getSubdivision).
 */
function transitions(survey: IpccSurvey, plots: readonly IpccPlot[], year: number): Transition[] {
  const find = (l: { category: string; subdivision: string }) => survey.subdivisions.find((s) => s.category === l.category && s.code === l.subdivision) ?? null;
  const i = year - IPCC_START_YEAR;
  const groups = new Map<string, Transition>();
  for (const p of plots) {
    const [from, to] = [p.years[i], p.years[i + 1]];
    // in the order of the database's GROUP BY (SQLite's): its codes, "-1" for none
    const key = [from.category, to.category, from.subdivision, to.subdivision].map((c) => c || '-1').join('\u0000');
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { from: find(from), to: find(to), area: 0 }));
    group.area += p.area ?? 0;
  }
  return [...groups].sort(([a], [b]) => compare(a, b)).map(([, group]) => group);
}

/**
 * One year's matrix (IPCCDataExportMatrixExcel.createExcel, MatrixSheet): the subdivisions of the year and the next in
 * order, the first year's in the rows, the next's in the columns, and in each cell the hectares that went from one to
 * the other. Plots without a subdivision of the survey in one of the years are left out.
 */
function matrixRows(year: number, ts: readonly Transition[]): XlsxCell[][] {
  const subdivisions = [...new Set(ts.flatMap((t) => [t.from, t.to]).filter((s): s is Subdivision => s !== null))].sort(bySubdivision);
  const cells = new Map<Subdivision, Map<Subdivision, number>>();
  for (const t of ts) {
    if (!t.from || !t.to) continue;
    const row = cells.get(t.from) ?? new Map<Subdivision, number>();
    cells.set(t.from, row.set(t.to, (row.get(t.to) ?? 0) + t.area));
  }
  const area = (from: Subdivision, to: Subdivision) => cells.get(from)?.get(to) ?? 0;
  return [
    [`Transition ${year}/${year + 1}`, ...subdivisions.map(subdivisionText)],
    ...subdivisions.map((from) => [subdivisionText(from), ...subdivisions.map((to) => area(from, to))]),
  ];
}

const transitionYears = YEARS.slice(0, -1);
const sheetTitle = (year: number) => `LU Matrix ${year}-${year + 1}`;

/** LU_Matrixes (IPCCDataExportMatrixExcel): the land use change matrix of each year and the next, one sheet each. */
export function matrixSheets(survey: IpccSurvey, plots: readonly IpccPlot[]): XlsxSheet[] {
  if (plots.length === 0) return [];
  return transitionYears.map((year) => ({ title: sheetTitle(year), rows: matrixRows(year, transitions(survey, plots, year)) }));
}

/** The label of a stratum's code. */
const labelOf = (survey: IpccSurvey, s: Stratum, code: string) => survey.labels[s].get(code) ?? NO_LABEL;

/** A stratum: the plots of one ecological zone, climate and soil. */
interface PlotStratum {
  climate: string;
  soil: string;
  gez: string;
  plots: IpccPlot[];
}

/**
 * The plots by ecological zone, climate and soil, in the order of their lists (AbstractIPCCDataExport.getStrataGEZ,
 * getStrataClimate, getStrataSoil): only the climates and soils the IPCC software knows (ClimateTypeEnum, SoilTypeEnum).
 */
function strataOf(survey: IpccSurvey, plots: readonly IpccPlot[]): PlotStratum[] {
  const label = (s: Stratum, code: string) => labelOf(survey, s, code);
  const rank = (s: Stratum, code: string) => {
    const i = [...survey.labels[s].keys()].indexOf(code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const strata = new Map<string, PlotStratum & { codes: [string, string, string] }>();
  for (const p of plots) {
    const { climate, soil, gez } = p.answers;
    if (!Object.hasOwn(CLIMATES, label('climate', climate)) || !Object.hasOwn(SOILS, label('soil', soil))) continue;
    const key = [gez, climate, soil].join('\u0000');
    let stratum = strata.get(key);
    if (!stratum) strata.set(key, (stratum = { climate: label('climate', climate), soil: label('soil', soil), gez: label('gez', gez), plots: [], codes: [gez, climate, soil] }));
    stratum.plots.push(p);
  }
  const order = (s: { codes: [string, string, string] }) => [rank('gez', s.codes[0]), rank('climate', s.codes[1]), rank('soil', s.codes[2])];
  return [...strata.values()].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
}

/**
 * LU_Matrixes_stratified (IPCCDataExportMatrixExtendedExcel): each year's sheet has one matrix for each ecological
 * zone, climate and soil, under the stratum's three labels.
 */
export function strataMatrixSheets(survey: IpccSurvey, plots: readonly IpccPlot[]): XlsxSheet[] {
  const strata = strataOf(survey, plots);
  if (strata.length === 0) return [];
  return transitionYears.map((year) => ({
    title: sheetTitle(year),
    rows: strata.flatMap((s) => [
      [],
      ['Climate', s.climate],
      ['Soil', s.soil],
      ['Global Ecological Zone (GEZ)', s.gez],
      [],
      ...matrixRows(year, transitions(survey, s.plots, year)),
      [],
      [],
      [],
    ]),
  }));
}

/** What Java's Double.toString writes: "0.0", "12.5", "1.2E7". */
function javaDouble(n: number): string {
  const abs = Math.abs(n);
  if (n === 0 || (abs >= 1e-3 && abs < 1e7)) return Number.isInteger(n) ? n.toFixed(1) : String(n);
  const [mantissa, exponent] = n.toExponential().split('e');
  return `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}E${Number(exponent)}`;
}
/** An area as the database answers it (a sum of the plots', SQLite's text of a REAL): null without. */
const areaText = (area: number | null) => (area === null ? null : javaDouble(area));
/** A CSV as opencsv's CSVWriter writes it (AbstractIPCCDataExportCSV): every value quoted, null empty, "\n" after each line. */
const csvOf = (rows: readonly (readonly (string | null)[])[]) => rows.map((r) => `${r.map((v) => (v === null ? '' : `"${v.replace(/"/g, '""')}"`)).join(',')}\n`).join('');
const YEAR_COLUMNS = YEARS.flatMap((y) => [`ipcc_${y}_category`, `ipcc_${y}_subdivision`]);
const STRATA_COLUMNS = ['climate_zones_label', 'soil_types_label', 'ecological_zones_label'];
/** The labels of a plot's climate, soil and ecological zone, then its category and subdivision codes of each year ("-1" for none, as the database's). */
const plotCells = (survey: IpccSurvey, p: IpccPlot) => [
  labelOf(survey, 'climate', p.answers.climate),
  labelOf(survey, 'soil', p.answers.soil),
  labelOf(survey, 'gez', p.answers.gez),
  ...p.years.flatMap((y) => [y.category || '-1', y.subdivision || '-1']),
];

/** LU_Timeseries_per_plot.csv (IPCCDataExportPerPlotCSV): each plot's strata and land uses year by year, and its area. */
export function perPlotCsv(survey: IpccSurvey, plots: readonly IpccPlot[]): string {
  const rows = [...plots].sort((a, b) => compare(b.id, a.id)).map((p) => [p.id, ...plotCells(survey, p), areaText(p.area)]);
  return csvOf([['id', ...STRATA_COLUMNS, ...YEAR_COLUMNS, 'area'], ...rows]);
}

/**
 * LU_Timeseries_grouped.csv (IPCCDataExportLandUnitsCSV): the land units, the plots of the same strata and land uses in
 * every year together, the largest first, numbered LU_0001 on.
 */
export function landUnitsCsv(survey: IpccSurvey, plots: readonly IpccPlot[]): string {
  const units = new Map<string, { cells: string[]; area: number | null }>();
  for (const p of plots) {
    const cells = plotCells(survey, p);
    const key = cells.join('\u0000');
    let unit = units.get(key);
    if (!unit) units.set(key, (unit = { cells, area: null }));
    // SQL's sum: the plots without an area left out, null when none has one
    if (p.area !== null) unit.area = (unit.area ?? 0) + p.area;
  }
  const rows = [...units.values()]
    .sort((a, b) => (b.area ?? -1) - (a.area ?? -1))
    .map((u, i) => [`LU_${String(i + 1).padStart(4, '0')}`, ...u.cells, areaText(u.area)]);
  return csvOf([['land_unit_id', ...STRATA_COLUMNS, ...YEAR_COLUMNS, 'area'], ...rows]);
}

const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const MODEL_CLASSES: Record<IpccCategory, string> = { F: 'Forest', C: 'Cropland', G: 'Grassland', W: 'Wetland', S: 'Settlement', O: 'Otherland' };
/** A subdivision's fields as XStream writes them (the parent class's first), with IPCCLandUses' forest, crop and vegetation types. */
function subdivisionXml(tag: string, s: Subdivision, guid: string, indent: string): string {
  const fields: [string, string][] = [['category', s.category], ['code', s.code], ['guid', guid], ['id', String(s.id)]];
  if (s.name) fields.push(['name', s.name]);
  if (s.category === 'C') fields.push(['croplandType', s.management], ['perennialCropType', 'ALL']);
  else fields.push(['type', s.management]);
  if (s.category === 'F') fields.push(['forestType', 'OTHER_CONIF']);
  if (s.category === 'G') fields.push(['vegetationType', 'SV']);
  const body = fields.map(([k, v]) => `${indent}  <${k}>${xmlText(v)}</${k}>\n`).join('');
  return `${indent}<${tag} class="org.openforis.collect.earth.ipcc.model.${MODEL_CLASSES[s.category]}Subdivision">\n${body}${indent}</${tag}>\n`;
}

/**
 * LU_Timeseries.xml (IPCCDataExportTimeSeriesXML): for each year and the next, and each ecological zone, climate and
 * soil, the land uses the plots went from and to with their area, as XStream writes the list of StratumPerYearData.
 */
export function timeSeriesXml(survey: IpccSurvey, plots: readonly IpccPlot[]): string {
  const guids = new Map(survey.subdivisions.map((s) => [s, randomUUID()]));
  const strata = strataOf(survey, plots);
  let xml = '';
  for (const year of transitionYears) {
    for (const s of strata) {
      xml += `  <Stratum>\n    <year>${year}</year>\n    <luData>\n`;
      for (const t of transitions(survey, s.plots, year)) {
        xml += '      <LandUse>\n';
        if (t.from) xml += subdivisionXml('lu', t.from, guids.get(t.from)!, '        ');
        if (t.to) xml += subdivisionXml('luNextYear', t.to, guids.get(t.to)!, '        ');
        xml += `        <areaHa>${javaDouble(t.area)}</areaHa>\n      </LandUse>\n`;
      }
      xml += `    </luData>\n    <climate>${xmlText(s.climate)}</climate>\n    <soil>${xmlText(s.soil)}</soil>\n    <gez>${xmlText(s.gez)}</gez>\n  </Stratum>\n`;
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml ? `<list>\n${xml}</list>` : '<list/>'}`;
}

// --- The file for the IPCC Inventory Software (IPCCDataExportTimeSeriesToTool) ------------------------------------------

/** The descriptions of a list's items in the survey's first language, by code: the soil types' remarks in the file. */
export function itemDescriptions(idmXml: string, list: string): Map<string, string> {
  const { surveyChildren, languages } = parseSurvey(idmXml);
  const out = new Map<string, string>();
  const node = elements(surveyChildren, 'codeLists')
    .flatMap((c) => elements(childrenOf(c), 'list'))
    .find((l) => attr(l, 'name') === list);
  for (const item of node ? elements(childrenOf(node), 'items').flatMap((i) => elements(childrenOf(i), 'item')) : []) {
    const code = elements(childrenOf(item), 'code')[0];
    const description = elements(childrenOf(item), 'description').find((d) => (attr(d, 'xml:lang') ?? languages[0]) === languages[0]);
    if (code && description) out.set(textOf(code), textOf(description).trim());
  }
  return out;
}

const CATEGORY_IDS: Record<IpccCategory, number> = { F: 1, C: 2, G: 3, W: 4, S: 5, O: 6 };
/** LandUseManagementEnum: each category's management types and their ids, in its order. */
const SUBCATEGORY_IDS: Record<IpccCategory, [string, number][]> = {
  F: [['MANAGED', 1], ['UNMANAGED', 2]],
  C: [['ANNUAL', 3], ['PERENNIAL', 4]],
  G: [['MANAGED', 5], ['UNMANAGED', 6]],
  W: [['MANAGED', 7], ['UNMANAGED', 8]],
  S: [['TREED', 9], ['OTHER', 10]],
  O: [['MANAGED', 11], ['UNMANAGED', 12]],
};
/** ClimateDomainEnum: id and name; GrowingStockLevelEnum: the 21-40 (21-50) years level of each domain. */
const DOMAINS: Record<string, [number, string]> = { TROPICAL: [1, 'Tropical'], MEDITERRANEAN: [2, 'Subtropical(Mediterranean)'], TEMPERATE: [3, 'Temperate'], BOREAL: [4, 'Boreal'], POLAR: [5, 'Polar'], NO_DATA: [0, 'NO_DATA'] };
const GROWING_STOCK_LEVELS: Record<string, number> = { BOREAL: 2, TEMPERATE: 6, MEDITERRANEAN: 32, TROPICAL: 33 };

/** A climate, soil or ecological zone of the plots (StratumObject); NO_DATA when the plot's is not one the software knows. */
interface StratumRef {
  value: string;
  label: string;
  guid: string;
}
/** A subdivision in one climate, soil (and, for forests, ecological zone): a land class of the file (LandUseSubdivisionStratified). */
interface LandClass {
  category: IpccCategory;
  subdivision: Subdivision;
  climate: StratumRef;
  soil: StratumRef;
  ecozone: StratumRef | null;
  id: number;
  guid: string;
}

/** A value of the database: "-1" for a code not answered. */
const dbValue = (v: string) => v || '-1';
/** What JDBC's getInt reads of a year code. */
const yearInt = (v: string) => (v === '' ? -1 : Number.parseInt(v, 10) || 0);
/** Commons Math's Precision.round(x, 2), half up. */
const round2 = (x: number) => Number(`${Math.round(Number(`${x}e2`))}e-2`);

type Xml = { name: string; attrs?: string; text?: string; children?: Xml[] };
const el = (name: string, value: string | number | boolean | null | Xml[], attrs = ''): Xml =>
  Array.isArray(value) ? { name, attrs, children: value } : value === null ? { name } : { name, attrs, text: typeof value === 'number' && !Number.isInteger(value) ? javaDouble(value) : String(value) };
/** A double, as JAXB writes it ("0.0"). */
const dbl = (name: string, value: number): Xml => ({ name, text: javaDouble(value) });
const NIL = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true"';
/** As JAXB's formatted output writes it: 4 spaces a level, starting again every 8 levels; a nil element (no text, no children) as xsi:nil. */
function jaxb(node: Xml, depth: number): string {
  const pad = ' '.repeat((depth % 8) * 4);
  const text = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (node.children) {
    if (node.children.length === 0) return `${pad}<${node.name}${node.attrs ?? ''}/>\n`;
    return `${pad}<${node.name}${node.attrs ?? ''}>\n${node.children.map((c) => jaxb(c, depth + 1)).join('')}${pad}</${node.name}>\n`;
  }
  return node.text === undefined ? `${pad}<${node.name}${NIL}/>\n` : `${pad}<${node.name}${node.attrs ?? ''}>${text(node.text)}</${node.name}>\n`;
}

export interface GhgiOptions {
  /** The country's code in the IPCC software (ipccCountries.ts). */
  country: string;
  /** The plot's region (the value of the question chosen), null for none. */
  regionOf: (p: IpccPlot) => string | null;
  /** The soil types' descriptions, by code (itemDescriptions). */
  soilRemarks: ReadonlyMap<string, string>;
}

/**
 * GHGi_tool_data.xml (IPCCDataExportTimeSeriesToTool): the file the IPCC Inventory Software imports, inventory year 2000.
 * Its land classes are the subdivisions in each climate and soil (forests also by ecological zone) of the plots' current
 * and previous land uses, with the subdivisions' management types (as chosen) and the defaults the desktop gives the
 * rest; its land representation, by region, the land units: the plots of a land class with the same land use changes,
 * and their area (the same for every year, as the desktop's).
 */
export function ghgiXml(survey: IpccSurvey, plots: readonly IpccPlot[], options: GhgiOptions): string {
  const { country } = options;
  const present = (s: Stratum, known: Record<string, unknown>) =>
    [...survey.labels[s]].filter(([code, label]) => Object.hasOwn(known, label) && plots.some((p) => p.answers[s] === code)).map(([value, label]) => ({ value, label, guid: randomUUID() }));
  // AbstractIPCCDataExport.getStrataClimate, getStrataSoil, getStrataEcozone, and their NODATA
  const climates = present('climate', CLIMATES);
  const soils = present('soil', SOILS);
  const ecozones = present('gez', ECOZONES);
  const noData = { climate: { value: 'NO_DATA', label: 'NO_DATA', guid: randomUUID() }, soil: { value: 'No_DATA', label: 'NO_DATA', guid: randomUUID() }, gez: { value: 'NO_DATA', label: 'NO_DATA', guid: randomUUID() } };
  const refOf = (list: StratumRef[], code: string, none: StratumRef) => list.find((r) => r.value === code) ?? none;
  const current = (p: IpccPlot) => p.answers.subcategory.slice(1, 2);
  const previous = (p: IpccPlot) => p.answers.subcategory.slice(0, 1);

  // The land classes (getClimateSoilLandUseCombination), category by category in the order the desktop makes them
  const classes: LandClass[] = [];
  for (const category of ['F', 'C', 'G', 'S', 'W', 'O'] as const) {
    const base = classes.length;
    const own: LandClass[] = [];
    // the distinct rows of a query, in the plots' order; the second leaves out the land classes the first found
    const add = (rows: { code: string; p: IpccPlot }[], idStart: number, dedupe: boolean) => {
      const seen = new Set<string>();
      for (const { code, p } of rows) {
        const key = [code, p.answers.climate, p.answers.soil, category === 'F' ? p.answers.gez : ''].join('\u0000');
        if (seen.has(key)) continue;
        const rowNum = seen.size;
        seen.add(key);
        const subdivision = survey.subdivisions.find((s) => s.category === category && s.code === code);
        if (!subdivision) continue; // the desktop stops the export
        const c: LandClass = {
          category,
          subdivision,
          climate: refOf(climates, p.answers.climate, noData.climate),
          soil: refOf(soils, p.answers.soil, noData.soil),
          ecozone: category === 'F' ? refOf(ecozones, p.answers.gez, noData.gez) : null,
          id: CATEGORY_IDS[category] * 1000 + base + rowNum + idStart,
          guid: randomUUID(),
        };
        if (dedupe && own.some((o) => o.subdivision === c.subdivision && o.climate === c.climate && o.soil === c.soil && o.ecozone === c.ecozone)) continue;
        own.push(c);
      }
    };
    add(plots.filter((p) => current(p) === category && p.answers.subdivision !== '').map((p) => ({ code: p.answers.subdivision, p })), 0, false);
    add(plots.filter((p) => previous(p) === category && p.answers.initialSubdivision !== '').map((p) => ({ code: p.answers.initialSubdivision, p })), own.length, true);
    classes.push(...own);
  }

  const common = (c: LandClass, custom: string): Xml[] => [el('id', c.id), el('guid', c.guid), el('countryCode', country), el('customName', custom)];
  const nutrient = (c: LandClass) => el('nutrientTypeId', c.soil.label === 'ORG' ? 3 : -1);
  const place = (c: LandClass, status = true) => [
    el('climateRegionId', CLIMATES[c.climate.label][0]),
    el('soilTypeId', SOILS[c.soil.label][0]),
    ...(status ? [el('soilStatusId', 1)] : []),
    el('geoPlacementId', -1),
    nutrient(c),
  ];
  const mf = () => [dbl('mfLandUse', 0), dbl('mfTillage', 0), dbl('mfInput', 0)];
  const nils = (...names: string[]) => names.map((n) => el(n, null));
  const name = (c: LandClass) => `${c.subdivision.code}_${c.climate.label}_${c.soil.label}`;
  const managed = (c: LandClass) => el('managed', c.subdivision.management === 'MANAGED');
  const CLASS: Record<IpccCategory, [string, string, (c: LandClass) => Xml[]]> = {
    F: ['forestLand', 'cltForestLand', (c) => {
      const domain = CLIMATES[c.climate.label][1];
      return [
        ...common(c, `${name(c)}_${c.ecozone!.label}`), managed(c), ...place(c),
        el('ecoZoneId', ECOZONES[c.ecozone!.label]), ...nils('ecoZoneCustom'), el('plantation', false), el('forestTypeId', 4), ...nils('forestTypeCustom'),
        el('continentTypeId', 1), el('ageClassId', 3), ...(GROWING_STOCK_LEVELS[domain] ? [el('growingStockLevelId', GROWING_STOCK_LEVELS[domain])] : []),
        dbl('carbonFraction', 0), dbl('ratio', 0), el('bcefRType', 0), dbl('bcefR', 0), dbl('aboveGroundBiomass', 0), dbl('aboveGroundBiomassGrowth', 0), ...mf(),
        el('abandoned', false), ...nils('woodDensity', 'growingStockInc'), el('bcefIType', 0), ...nils('bef1'), dbl('bcefI', 0), el('bcefSType', 0), ...nils('bef2'),
        dbl('bcefS', 0), ...nils('ageClassRange', 'growingStockLevelValue', 'soilCarbonStock'),
      ];
    }],
    C: ['cropland', 'cltCropland', (c) => {
      const perennial = c.subdivision.management === 'PERENNIAL';
      return [
        ...common(c, name(c)), ...place(c), el('perennialCrops', perennial), ...(perennial ? [el('croplandTypeId', 1)] : []), ...nils('croplandTypeCustom'),
        el('riceEcosystem', false), ...mf(), dbl('harvestCycle', 0), ...nils('bWoody', 'bWoodyAccumulationRate'), el('bWoodyUnitId', 0), ...nils('bWoodyCFrac', 'ratioBgbAgbWoody'),
        el('ageClassId', 3), ...nils('bHerb'), el('bHerbUnitId', 0), ...nils('bHerbCFrac', 'ageClassValue'), el('agroforestry', false), ...nils('ratioBgbAgbHerb', 'soilCarbonStock'),
      ];
    }],
    G: ['grassland', 'cltGrassland', (c) => [
      ...common(c, name(c)), managed(c), ...place(c), el('improvedGrassland', false), el('vegetationTypeId', 25), ...mf(),
      dbl('biomassStockHerb', 0), dbl('biomassStockWoody', 0), dbl('carbonFractionHerb', 0), dbl('carbonFractionWoody', 0), el('ageClassId', 3), dbl('ratioBgbAgbHerb', 0.5),
      ...nils('ratioBgbAgbWoody', 'agbGrowth'), el('abandoned', false), ...nils('ageClassValue', 'soilCarbonStock'),
    ]],
    W: ['wetland', 'cltWetland', (c) => [
      ...common(c, name(c)), managed(c), ...place(c), el('wetlandType', 'OW'), ...nils('biomassStock', 'cfDryMatter', 'cfAirDryWeight', 'cfAirDryVolume', 'agbGrowth', 'ratioBgbAgb'),
      ...mf(), ...nils('soilCarbonStock', 'vegetationTypeId'), el('ageClassId', 3), ...nils('ageClassValue'),
    ]],
    S: ['settlement', 'cltSettlement', (c) => [
      ...common(c, name(c)), ...place(c), el('settlementTypeId', c.subdivision.management === 'TREED' ? 9 : 10), ...mf(), ...nils('biomassStock', 'carbonFraction', 'ratioBgbAgb'),
      el('ageClassId', 3),
      ...nils('agp', 'propCult', 'mfLandUseCult', 'mfManagCult', 'mfInputCult', 'propTurfgrass', 'mfLandUseTurfgrass', 'mfManagTurfgrass', 'mfInputTurfgrass', 'propPaved', 'mfLandUsePaved', 'mfManagPaved', 'mfInputPaved', 'soilCarbonStock'),
      el('numberOfClasses', 1),
    ]],
    O: ['otherland', 'cltOtherland', (c) => [...common(c, name(c)), managed(c), ...place(c, false)]],
  };

  // The land units of a land class in a region (generateLandUnits): its plots by their land use changes, the largest first
  // The plots by region and current land use, climate and soil, read once (regions times land classes is large)
  const plotKey = (region: string | null, category: string, subdivision: string, climate: string, soil: string) => JSON.stringify([region, category, subdivision, climate, soil]);
  const byLandUse = new Map<string, IpccPlot[]>();
  for (const p of plots) {
    const key = plotKey(options.regionOf(p), current(p), p.answers.subdivision, p.answers.climate, p.answers.soil);
    const list = byLandUse.get(key);
    if (list) list.push(p);
    else byLandUse.set(key, [p]);
  }
  const landUnits = (region: string | null, c: LandClass): Xml[] => {
    const groups = new Map<string, { a: IpccAnswers; area: number }>();
    for (const p of byLandUse.get(plotKey(region, c.category, c.subdivision.code, c.climate.value, c.soil.value)) ?? []) {
      const a = p.answers;
      if (c.ecozone && a.gez !== c.ecozone.value) continue;
      const key = [a.subcategory, a.changeYear, a.subdivision, a.subdivisionYear, a.initialSubdivision, a.secondSubdivision, a.secondConversion, a.secondYear].map(dbValue).join('\u0000');
      const group = groups.get(key) ?? { a, area: 0 };
      group.area += p.area ?? 0;
      groups.set(key, group);
    }
    const units: Xml[] = [];
    for (const { a, area } of [...groups].sort(([x], [y]) => compare(x, y)).map(([, g]) => g).sort((x, y) => y.area - x.area)) {
      const subcategory = dbValue(a.subcategory);
      const [from, to] = [subcategory.slice(0, 1), subcategory.slice(1, 2)] as [IpccCategory, IpccCategory];
      const changeYear = yearInt(a.changeYear);
      const subdivisionYear = yearInt(a.subdivisionYear);
      const initial = dbValue(a.initialSubdivision);
      // The land class of the initial land use (findStrataLandRepresentation): the desktop stops the export without one
      const before = classes.find((x) => x.category === from && x.subdivision.code === initial && x.climate.value === c.climate.value && x.soil.value === c.soil.value && (!x.ecozone || !c.ecozone || x.ecozone.value === c.ecozone.value));
      let prev: [number, number, number];
      if (from !== to) {
        if (!before) continue;
        prev = [CATEGORY_IDS[from], before.id, changeYear];
      } else if (subdivisionYear > -1) {
        const was = survey.subdivisions.find((s) => s.category === from && s.code === initial);
        const management = was && SUBCATEGORY_IDS[from].find(([m]) => m === was.management);
        if (!management || !before) continue;
        prev = [management[1], before.id, subdivisionYear];
      } else {
        prev = [-200, -200, -2];
      }
      const total = round2(area);
      units.push(
        el('lrtLandUnit', [
          el('guid', randomUUID()),
          el('unitCode', `${subcategory}-${changeYear}-${dbValue(a.subdivision)}-${subdivisionYear}-${initial}-${subdivisionYear}-`),
          el('ltIdPrev', prev[0]),
          el('cltIdPrev', prev[1]),
          el('transPeriod', 20),
          el('convYear', prev[2]),
          el('areas', YEARS.map((year) => ({ name: 'area', attrs: ` year="${year}"${year === IPCC_START_YEAR ? ' isSource="true"' : ''}`, text: javaDouble(total) }))),
          el('areasA1D', []),
          el('isMerged', false),
          el('pmBiomass', 2),
          el('pmDomDeadwood', 2),
          el('pmDomLitter', 2),
          el('pmSomMineral', 1),
          el('remark', null),
          el('history', []),
        ]),
      );
    }
    return units;
  };

  // The regions (getLrtRegions): the plots by the value of the region's question, none first
  const regions = new Map<string | null, number>();
  for (const p of plots) {
    const r = options.regionOf(p);
    regions.set(r, (regions.get(r) ?? 0) + (p.area ?? 0));
  }
  const regionXml = [...regions].sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : compare(a, b))).map(([region, area]) => {
    const categories = IPCC_CATEGORIES.flatMap((category) => {
      const subcategories = SUBCATEGORY_IDS[category].flatMap(([management, scatId]) => {
        const subdivisions = classes
          .filter((c) => c.category === category && c.subdivision.management === management)
          .flatMap((c) => {
            const units = landUnits(region, c);
            return units.length > 0 ? [el('lrtLandSubdivision', [el('cltId', c.id), el('remark', null), el('landUnits', units)])] : [];
          });
        return subdivisions.length > 0 ? [el('lrtLandSubcategory', [el('scatId', scatId), el('remark', null), el('landSubdivisions', subdivisions)])] : [];
      });
      return subcategories.length > 0 ? [el('lrtLandCategory', [el('ltId', CATEGORY_IDS[category]), el('remark', null), el('landSubcategories', subcategories)])] : [];
    });
    return el('lrtRegion', [
      el('guid', randomUUID()),
      el('name', region === null ? 'Unknown' : region.replace(/'/g, '')),
      dbl('area', round2(area)),
      el('approachId', 2),
      el('remark', null),
      el('landCategories', categories),
    ]);
  });

  const landTypes = el('landTypes', [
    el('countryCode', country),
    el('climateRegions', climates.map((c) => el('climateRegion', [el('id', CLIMATES[c.label][0]), el('guid', c.guid), el('domainId', DOMAINS[CLIMATES[c.label][1]][0]), el('region', DOMAINS[CLIMATES[c.label][1]][1]), el('remark', c.label)]))),
    el('soilTypes', soils.map((s) => {
      const remark = options.soilRemarks.get(s.value);
      return el('soilType', [el('id', SOILS[s.label][0]), el('guid', s.guid), el('compositionId', SOILS[s.label][1]), el('fullName', s.label), ...(remark ? [el('remark', remark)] : [])]);
    })),
    ...(['F', 'C', 'G', 'W', 'S', 'O'] as const).map((category) => {
      const [wrapper, tag, fields] = CLASS[category];
      return el(wrapper, classes.filter((c) => c.category === category).map((c) => el(tag, fields(c))));
    }),
    el('landRepresentation', [el('lrtCountry', [el('countryCode', country), dbl('area', plots.reduce((sum, p) => sum + (p.area ?? 0), 0)), el('regions', regionXml)])]),
    el('socRefTable', [el('countryCode', country)]),
  ]);
  const root = [el('Version', '2.861'), el('inventoryYear', IPCC_START_YEAR), el('countryCode', country), el('tiers', []), el('ipccSubdivisions', []), el('record', [landTypes]), el('signature', 'CollectEarth')];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<ns2:IPCC2006Export xmlns:ns2="http://ipcc2006.air.sk/IPCC2006Export">\n${root.map((n) => jaxb(n, 1)).join('')}</ns2:IPCC2006Export>\n`;
}
