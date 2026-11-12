// Collect Earth's IPCC exports (the desktop's LULUCF package, org.openforis.collect.earth.ipcc in collect-earth-app),
// made from the plots' first assessments and the survey instead of the database the desktop generates for them
// (IPCCRDBGenerator):
// - each plot's land use category and subdivision in each year from 2000 to 2023, by the rules IPCCSurveyAdapter
//   writes into the survey as calculated questions (or read from the survey's own, when it has them);
// - the files made of them, each as its desktop class makes it (named on each function).
// The areas are the plots' expansion factors, the Analysis page's (routes/analysis.ts, projectFactors).
import { cell, type AnalysisColumn, type AnalysisModel } from './analysis.js';
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

/** The strata labels the desktop knows (ClimateTypeEnum, SoilTypeEnum): plots of another climate or soil are in no stratum. */
const CLIMATE_TYPES = ['TRW', 'TMM', 'TRD', 'TRMT', 'TRMTD', 'WTM', 'WTD', 'CTM', 'CTD', 'BOM', 'BOD', 'POM', 'POD', 'NO_DATA'];
const SOIL_TYPES = ['HAC', 'LAC', 'VOL', 'SPO', 'SAN', 'WET', 'ORG', 'OtherAreas', 'NO_DATA'];
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
  return { missing, columns, own, subdivisions, labels };
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
    out.push({ id, area, answers, years, summary });
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
    const key = [from.category, to.category, from.subdivision, to.subdivision].join('\u0000');
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { from: find(from), to: find(to), area: 0 }));
    group.area += p.area ?? 0;
  }
  return [...groups.values()];
}

/**
 * One year's matrix (IPCCDataExportMatrixExcel.createExcel, MatrixSheet): the subdivisions of the year and the next in
 * order, the first year's in the rows, the next's in the columns, and in each cell the hectares that went from one to
 * the other. Plots without a subdivision of the survey in one of the years are left out.
 */
function matrixRows(year: number, ts: readonly Transition[]): XlsxCell[][] {
  const subdivisions = [...new Set(ts.flatMap((t) => [t.from, t.to]).filter((s): s is Subdivision => s !== null))].sort(bySubdivision);
  const area = (from: Subdivision, to: Subdivision) => ts.reduce((sum, t) => (t.from === from && t.to === to ? sum + t.area : sum), 0);
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
  const label = (s: Stratum, code: string) => survey.labels[s].get(code) ?? NO_LABEL;
  const rank = (s: Stratum, code: string) => {
    const i = [...survey.labels[s].keys()].indexOf(code);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const strata = new Map<string, PlotStratum & { codes: [string, string, string] }>();
  for (const p of plots) {
    const { climate, soil, gez } = p.answers;
    if (!CLIMATE_TYPES.includes(label('climate', climate)) || !SOIL_TYPES.includes(label('soil', soil))) continue;
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
