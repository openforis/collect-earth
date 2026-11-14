// Plot files: the list and uploads, who collects which file, dividing a file between people, plot design, SIGRID.

import { unzipSync } from "fflate";

import type {
  Assignment,
  AssignmentDetail,
  AssignmentsAnswer,
  CsvColumns,
  CsvFilesAnswer,
  CsvUploadAnswer,
  DesignArea,
  DesignFacts,
  DesignPlan,
  DistributionSummary,
  DivisionBody,
  ListedCsvFile,
  MoveUnfinishedAnswer,
  PlotDesign,
  RebalanceAnswer,
  ReplaceImpact,
  SigridCountries,
  SigridFacts,
} from "../../../src/wire/plotFiles";
import { ApiError, Progress, p, request, send, upload } from "./transport";

// --- plot files and assignments ----------------------------------------------------------

export async function listCsvFiles(projectId: string): Promise<ListedCsvFile[]> {
  return (await request<CsvFilesAnswer>("GET", `${p(projectId)}/csv-files`)).csvFiles;
}

/**
 * Uploads (or replaces) a plot file. A replacement that drops plots people hold or submitted
 * is refused with code "replace_needs_confirm" (its details: ReplaceImpact) unless `confirmReplace`.
 */
export function uploadCsvFile(projectId: string, file: File, onProgress?: Progress, confirmReplace = false): Promise<CsvUploadAnswer> {
  const query = confirmReplace ? "?confirm=replace" : "";
  return upload<CsvUploadAnswer>("PUT", `${p(projectId)}/csv-files/${encodeURIComponent(file.name)}${query}`, file, "text/csv", onProgress);
}

/** The plot files a project file brings in its grid folder (grid/*.csv, sub-folders left out). */
export const cepGridFiles = (cep: Blob) => zipCsvFiles(cep, "grid/");

/** The CSV files directly in a folder of a zip ("grid/" of a .cep, "files/ce_grid/" of Collect's .collect backup). */
export async function zipCsvFiles(zip: Blob, folder: string): Promise<File[]> {
  const isCsv = (name: string) => name.toLowerCase().startsWith(folder) && /^[^/]+\.csv$/i.test(name.slice(folder.length));
  const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()), { filter: (f) => isCsv(f.name) });
  return Object.entries(entries).map(([name, data]) => new File([data], name.slice(folder.length), { type: "text/csv" }));
}

/**
 * Plot files joined into one named `name`: those with the header most of them share (compared without
 * quotes, spaces or a BOM) become one file, its header once and every file's rows after it, byte for
 * byte (the text encoding is kept). The others are returned to add as they are.
 */
export async function mergeGridFiles(files: File[], name: string): Promise<{ merged: File | null; separate: File[] }> {
  const parts = await Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const end = bytes.indexOf(10);
      const headerEnd = end === -1 ? bytes.length : end + 1;
      // shortcut: a header whose names hold quoted commas compares as other columns, and its file is then added on its own.
      const header = new TextDecoder("latin1").decode(bytes.subarray(0, headerEnd)).replace(/^(﻿|ï»¿)/, "").replace(/["\s]/g, "");
      return { file, bytes, headerEnd, header };
    }),
  );
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p.header, (counts.get(p.header) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const same = parts.filter((p) => p.header === common);
  const separate = parts.filter((p) => p.header !== common).map((p) => p.file);
  if (same.length < 2) return { merged: null, separate: files };
  const chunks: Uint8Array<ArrayBuffer>[] = [same[0].bytes.subarray(0, same[0].headerEnd)];
  if (same[0].bytes[same[0].headerEnd - 1] !== 10) chunks.push(new Uint8Array([10]));
  for (const p of same) {
    const rows = p.bytes.subarray(p.headerEnd);
    if (rows.length === 0) continue;
    chunks.push(rows);
    if (rows[rows.length - 1] !== 10) chunks.push(new Uint8Array([10]));
  }
  return { merged: new File(chunks, name, { type: "text/csv" }), separate };
}

export type { CsvUploadAnswer, DesignArea, DesignFacts, DesignPlan, DesignStratum, PlotDesign } from "../../../src/wire/plotFiles";

const designPath = (projectId: string) => `${p(projectId)}/plot-design`;

export const readDesignArea = (projectId: string, area: DesignArea) => request<DesignFacts>("POST", designPath(projectId), { json: area });

export const planPlotDesign = (projectId: string, area: DesignArea, design: PlotDesign, seed?: number) =>
  request<DesignPlan>("POST", designPath(projectId), { json: { ...area, design, seed } });

/** The plot file of a design (CSV text), to upload as any plot file. */
export async function generatePlotDesign(projectId: string, area: DesignArea, design: PlotDesign, seed: number): Promise<string> {
  const response = await send("POST", designPath(projectId), { json: { ...area, design, seed, generate: true } });
  return response.text();
}

export type { SigridCountries, SigridCountry, SigridFacts } from "../../../src/wire/plotFiles";

/** What a SIGRID choice is: the country, its provinces and districts (none: all of it), an area to clip to. */
export type SigridChoice = {
  country: string;
  spacingKm?: number;
  provinces: string[];
  districts: { province: string; district: string }[];
} & ({ geojson: string } | { shapefile: string } | object);

const sigridPath = (projectId: string) => `${p(projectId)}/sigrid`;

export const listSigridCountries = (projectId: string) => request<SigridCountries>("GET", `${sigridPath(projectId)}/countries`);

export const planSigrid = (projectId: string, choice: SigridChoice) => request<SigridFacts>("POST", sigridPath(projectId), { json: choice });

/** The plot file of a SIGRID choice (CSV text, its ids SIGRID's CE_ID), to upload as any plot file. */
export async function generateSigrid(projectId: string, choice: SigridChoice): Promise<string> {
  const response = await send("POST", sigridPath(projectId), { json: { ...choice, generate: true } });
  return response.text();
}

export type { ReplaceImpact } from "../../../src/wire/plotFiles";

/** What replacing a plot file would take out of the project: the details of the 409 "replace_needs_confirm" error. */
export function replaceImpactOf(error: unknown): ReplaceImpact | null {
  return error instanceof ApiError && error.code === "replace_needs_confirm" ? (error.details as unknown as ReplaceImpact) : null;
}

export async function listAssignments(projectId: string): Promise<AssignmentDetail[]> {
  return (await request<AssignmentsAnswer>("GET", `${p(projectId)}/assignments`)).assignments;
}

export async function saveAssignments(projectId: string, assignments: Assignment[]): Promise<void> {
  await send("PUT", `${p(projectId)}/assignments`, { json: { assignments } });
}

// --- dividing a plot file between people ---------------------------------------------

const f = (projectId: string, csvFileId: string) => `${p(projectId)}/csv-files/${encodeURIComponent(csvFileId)}`;

export function getCsvColumns(projectId: string, csvFileId: string): Promise<CsvColumns> {
  return request("GET", `${f(projectId, csvFileId)}/columns`);
}

export function getDistribution(projectId: string, csvFileId: string): Promise<DistributionSummary> {
  return request("GET", `${f(projectId, csvFileId)}/distribution`);
}

/** Divides the file's plots (or, with dryRun, only says what the result would be). */
export function saveDistribution(projectId: string, csvFileId: string, distribution: DivisionBody, dryRun = false): Promise<DistributionSummary> {
  const json: DivisionBody = dryRun ? { ...distribution, dryRun: true } : distribution;
  return request("PUT", `${f(projectId, csvFileId)}/distribution`, { json });
}

/**
 * Gives the plots `fromUserId` has not submitted to `toUserId`: all of them, or (`which`) `count` of the plots
 * they have to assess (the last of their list), or only `plots` (picked on the map).
 */
export function moveUnfinished(
  projectId: string,
  csvFileId: string,
  fromUserId: string,
  toUserId: string,
  which: { count?: number; plots?: string[] } = {},
): Promise<MoveUnfinishedAnswer> {
  return request("POST", `${f(projectId, csvFileId)}/move-unfinished`, { json: { fromUserId, toUserId, ...which } });
}

export type { MoveUnfinishedAnswer, RebalanceAnswer, RebalanceMove, RebalancePlan } from "../../../src/wire/plotFiles";

/**
 * Shares again the plots still to assess of `people` by their weights (1 and 1: equally; 0: gives all away); what is
 * submitted stays. `dryRun`: the plan only, nothing saved. A file given whole has nothing to share (ApiError 409).
 */
export function rebalance(
  projectId: string,
  csvFileId: string,
  people: { userId: string; weight: number }[],
  dryRun: boolean,
): Promise<RebalanceAnswer> {
  return request("POST", `${f(projectId, csvFileId)}/rebalance`, { json: { people, dryRun } });
}
