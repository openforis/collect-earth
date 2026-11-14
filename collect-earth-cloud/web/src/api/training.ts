// Training: calibration and learning plots, golden answers and scores; the uncertainty settings' calls.

import type {
  AreaSettings,
  AreaSettingsAnswer,
  AreasAnswer,
  IpccCategory,
  IpccExports,
  UncertaintyAnswer,
  UncertaintySettings,
  UncertaintySettingsAnswer,
  UncertaintySetup,
} from "../../../src/wire/analysis";
import type {
  AttemptsAnswer,
  GoldenFromAnswer,
  GoldenPruneAnswer,
  MyTrainingAnswer,
  MyTrainingSet,
  TrainingFiguresAnswer,
  TrainingGolden,
  TrainingKind,
  TrainingList,
  TrainingSetSummary,
  TrainingSetView,
} from "../../../src/wire/training";
import { Progress, p, request, send, upload } from "./transport";
import { attachmentName } from "./data";

// --- Training: calibration and learning plots -----------------------------------------

export type {
  AnonymousCalibration,
  AnswerCount,
  CalibrationCell,
  CalibrationFigures,
  CalibrationPerson,
  CalibrationPlot,
  CalibrationQuestion,
  LearningScore,
  MyScoredPlot,
  MyTrainingSet,
  ScoredAnswer,
  ScoredPlot,
  Share,
  TrainingAttemptPast,
  TrainingAttemptStart,
  TrainingFiguresAnswer,
  TrainingFiguresSet,
  TrainingGolden,
  TrainingKind,
  TrainingList,
  TrainingListItem,
  TrainingPerson,
  TrainingQuestion,
  TrainingSetSummary,
  TrainingSetView,
} from "../../../src/wire/training";

export function getTraining(projectId: string): Promise<TrainingList> {
  return request("GET", `${p(projectId)}/training`);
}

/** A new set from a CSV file. */
export function createTrainingSet(
  projectId: string,
  file: File,
  options: { kind: TrainingKind; name: string; passMark: number | null },
  onProgress?: Progress,
): Promise<TrainingSetSummary> {
  const q = new URLSearchParams({ kind: options.kind, name: options.name });
  if (options.passMark !== null) q.set("passMark", String(options.passMark));
  return upload<TrainingSetSummary>("PUT", `${p(projectId)}/training-sets/${encodeURIComponent(file.name)}?${q}`, file, "text/csv", onProgress);
}

export function updateTrainingSet(projectId: string, setId: string, change: { name?: string; kind?: TrainingKind; passMark?: number | null }): Promise<TrainingSetSummary> {
  return request("PATCH", `${p(projectId)}/training/${encodeURIComponent(setId)}`, { json: change });
}

export async function deleteTrainingSet(projectId: string, setId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/training/${encodeURIComponent(setId)}`);
}

export async function setTrainingMembers(projectId: string, setId: string, userIds: string[]): Promise<void> {
  await send("PUT", `${p(projectId)}/training/${encodeURIComponent(setId)}/members`, { json: { userIds } });
}

export function getTrainingSet(projectId: string, setId: string): Promise<TrainingSetView> {
  return request("GET", `${p(projectId)}/training/${encodeURIComponent(setId)}`);
}

export function putTrainingGolden(projectId: string, setId: string, plot: string, answers: Record<string, string>, note: string | null): Promise<TrainingGolden> {
  return request("PUT", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden/${encodeURIComponent(plot)}`, { json: { answers, note } });
}

/** Golden answers for every plot: the calibration's agreed answers, or one person's records. */
export async function goldenFrom(projectId: string, setId: string, from: { from: "consensus" } | { from: "person"; userId: string }): Promise<number> {
  return (await request<GoldenFromAnswer>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden`, { json: from })).plots;
}

/** A training set's results as CSV: each person's attempts, or every answer scored. */
export async function downloadTrainingExport(projectId: string, setId: string, what: "scores" | "answers"): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/training/${encodeURIComponent(setId)}/export?what=${what}`);
  return { blob: await response.blob(), filename: attachmentName(response, `training-${what}.csv`) };
}

/** Takes the questions the survey no longer has out of every golden answer of a set; gives the plots changed. */
export async function pruneTrainingGolden(projectId: string, setId: string): Promise<number> {
  return (await request<GoldenPruneAnswer>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/golden/prune`)).plots;
}

export async function startTrainingAttempts(projectId: string, setId: string, who: { userIds: string[] } | { all: true }): Promise<number> {
  return (await request<AttemptsAnswer>("POST", `${p(projectId)}/training/${encodeURIComponent(setId)}/attempts`, { json: who })).started;
}

export async function getMyTraining(projectId: string): Promise<MyTrainingSet[]> {
  return (await request<MyTrainingAnswer>("GET", `${p(projectId)}/training/mine`)).sets;
}

/** Calibration figures without anyone's name (reviewers), and the survey's questions for them. */
export function getTrainingFigures(projectId: string): Promise<TrainingFiguresAnswer> {
  return request("GET", `${p(projectId)}/training/figures`);
}

export type {
  AreaSettings,
  AreaSettingsAnswer,
  AreasAnswer,
  Estimate,
  ForestRow,
  IpccCategory,
  IpccExports,
  StrataAreas,
  UncertaintyAnswer,
  UncertaintyQuestion,
  UncertaintyResult,
  UncertaintySettings,
  UncertaintySettingsAnswer,
  UncertaintySetup,
} from "../../../src/wire/analysis";

/** The six IPCC land categories (the server's src/uncertainty.ts). */
export const IPCC_CATEGORIES = ["forest", "cropland", "grassland", "wetland", "settlement", "other"] as const satisfies readonly IpccCategory[];

export function getUncertaintySetup(projectId: string): Promise<UncertaintySetup> {
  return request("GET", `${p(projectId)}/uncertainty/settings`);
}

export async function saveUncertaintySettings(projectId: string, settings: UncertaintySettings): Promise<UncertaintySettings> {
  return (await request<UncertaintySettingsAnswer>("PUT", `${p(projectId)}/uncertainty/settings`, { json: settings })).settings;
}

/** The project's strata and areas; with `columns`, the strata those columns would make (nothing saved). */
export const getAreas = (projectId: string, columns?: string[]) =>
  request<AreasAnswer>("GET", `${p(projectId)}/areas${columns ? `?columns=${encodeURIComponent(columns.join(","))}` : ""}`);

/** Saves the strata and areas, or one total area; null: back to the project file's areas file. */
export const saveAreas = (projectId: string, settings: AreaSettings | null) => request<AreaSettingsAnswer>("PUT", `${p(projectId)}/areas`, { json: { settings } });

/** Saves the strata of an areas_per_attribute.csv (Collect Earth's: the columns, then area). */
export const uploadAreasFile = (projectId: string, file: string) => request<AreaSettingsAnswer>("PUT", `${p(projectId)}/areas`, { json: { file } });

/** The strata as areas_per_attribute.csv. */
export async function downloadAreasFile(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/areas/file`);
  return { blob: await response.blob(), filename: attachmentName(response, "areas_per_attribute.csv") };
}

export type IpccFile = "matrix" | "matrix-strata" | "plots" | "land-units" | "timeseries";
export const IPCC_FILES: readonly IpccFile[] = ["matrix", "matrix-strata", "plots", "land-units", "timeseries"];
/** The management types of each IPCC category (the server's MANAGEMENT_TYPES). */
export const IPCC_MANAGEMENT: Record<string, readonly string[]> = {
  F: ["MANAGED", "UNMANAGED"],
  C: ["ANNUAL", "PERENNIAL"],
  G: ["MANAGED", "UNMANAGED"],
  W: ["MANAGED", "UNMANAGED"],
  S: ["TREED", "OTHER"],
  O: ["MANAGED", "UNMANAGED"],
};

export const getIpccExports = (projectId: string) => request<IpccExports>("GET", `${p(projectId)}/exports/ipcc`);

export async function downloadIpccFile(projectId: string, file: IpccFile): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/exports/ipcc/${file}`);
  return { blob: await response.blob(), filename: attachmentName(response, `${file}.txt`) };
}

/** The file for the IPCC Inventory Software; `management` by "<category>/<code>". */
export async function downloadIpccGhgi(projectId: string, choices: { country: string; region: string; management: Record<string, string> }): Promise<{ blob: Blob; filename: string }> {
  const response = await send("POST", `${p(projectId)}/exports/ipcc/ghgi`, { json: choices });
  return { blob: await response.blob(), filename: attachmentName(response, "GHGi_tool_data.xml") };
}

export function getUncertainty(projectId: string): Promise<UncertaintyAnswer> {
  return request("GET", `${p(projectId)}/uncertainty`);
}

/** The copy of a CEO project's plot and sample shapes into the project (src/routes/ceoShapes.ts). */
export type CeoShapesProgress =
  | { state: "none" }
  | { state: "reading" | "done"; total: number; done: number; missing: number; error: string | null };

export function getCeoShapes(projectId: string): Promise<CeoShapesProgress> {
  return request("GET", `${p(projectId)}/ceo-shapes`);
}

/** Reads the next plots' shapes from CEO (about 20 seconds); once all are read, the plot files get them. */
export function stepCeoShapes(projectId: string): Promise<CeoShapesProgress> {
  return request("POST", `${p(projectId)}/ceo-shapes/step`);
}
