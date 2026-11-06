import { apiGet, apiPost } from "./apiClient";
import type { AnalysisFlags, DeleteCheck, DivideCsvRequest } from "./tools";

/** The calls of the Tools and Utilities menus (ToolsController, ActionsController, FilesController). */

export const analysisFlags = (signal?: AbortSignal) => apiGet<AnalysisFlags>("tools/analysis", signal);

const started = (p: Promise<{ id: string }>) => p.then((r) => r.id);

export const startIpccPrepare = (refresh: boolean) => started(apiPost("jobs/ipccPrepare", { refresh }));

export const startIpccOutputs = (answers: unknown) => started(apiPost("jobs/ipccOutputs", answers));

export const loadKml = (kml: string, csv: string) => apiPost<{ restart: boolean; plots: number; csv: string }>("tools/loadKml", { kml, csv });

export const startMissingPlots = (files: string[]) => started(apiPost("jobs/missingPlots", { files }));

export const divideCsvColumns = (signal?: AbortSignal) => apiGet<{ columns: string[] }>("tools/divideCsv/columns", signal).then((r) => r.columns);

export const startDivideCsv = (request: DivideCsvRequest) => started(apiPost("jobs/divideCsv", request));

export const deletePlotsCheck = (path: string, signal?: AbortSignal) => apiPost<DeleteCheck>("tools/deletePlots/check", { path }, signal);

export const startDeletePlots = (path: string) => started(apiPost("jobs/deletePlots", { path }));

export const copyFile = (from: string, to: string) => apiPost<{ path: string }>("files/copy", { from, to });

export const runAction = (name: string) => apiPost<void>("actions/" + name);
