import { apiGet, apiPost } from "./apiClient";
import type { Project, SampleFileCheck, Settings, Validation, Values } from "./settings";

/** The calls of the settings page (SettingsController, ProjectsController, FilesController, ActionsController). */

export const loadSettings = (signal?: AbortSignal) => apiGet<Settings>("settings", signal);

export const validateSettings = (values: Values, signal?: AbortSignal) =>
  apiPost<Validation>("settings/validate", { values }, signal);

/** Saves the changes; answers whether Collect Earth restarts. A refusal is an ApiError settings.invalid with `errors`. */
export const saveSettings = (values: Values) => apiPost<{ restart: boolean }>("settings", { values });

export const checkSampleFile = (path: string, signal?: AbortSignal) =>
  apiPost<SampleFileCheck>("settings/sampleFile", { path }, signal);

export interface ConnectionTest { ok: boolean; message: string }

export const testDatabase = (connection: { host: string; port: string; name: string; username: string; password: string }) =>
  apiPost<ConnectionTest>("settings/testDatabase", connection);

export const testCloud = (connection: { url: string; projectId: string; token: string }) =>
  apiPost<ConnectionTest>("settings/testCloud", connection);

export const listProjects = (signal?: AbortSignal) => apiGet<{ projects: Project[] }>("projects", signal).then((r) => r.projects);

export const loadProject = (folder: string) => apiPost<{ restart: boolean; message: string | null }>("projects/load", { folder });

export const openBackupFolder = () => apiPost<void>("actions/openBackupFolder");

/** The native file dialog of the server (FilesController): the path chosen, or null when the user cancelled. */
export async function chooseFile(mode: "OPEN" | "SAVE" | "FOLDER", extensions: string[] = [], suggested?: string): Promise<string | null> {
  const r = await apiPost<{ path?: string; cancelled?: boolean }>("files/choose", { mode, extensions, suggested });
  return r.path ?? null;
}

/**
 * Wraps an async function so that only its latest call answers: a call started before a later one resolves to
 * undefined instead, and its signal is aborted. The validation while typing runs on every change, and the answer to
 * an older state must not overwrite the one to the current state.
 */
export function latestOnly<A extends unknown[], R>(fn: (signal: AbortSignal, ...args: A) => Promise<R>): (...args: A) => Promise<R | undefined> {
  let current: AbortController | null = null;
  return async (...args: A) => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    try {
      const result = await fn(controller.signal, ...args);
      return controller.signal.aborted ? undefined : result;
    } catch (e) {
      if (controller.signal.aborted) return undefined;
      throw e;
    }
  };
}

/** Calls the function once, `ms` after the last of a burst of calls, with the arguments of that last call. */
export function debounced<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const call = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  call.cancel = () => clearTimeout(timer);
  return call;
}

/** A plot file the cloud server assigns to the operator (cloud mode) */
export interface CloudAssignment { id: string; filename: string; plots: number; active: boolean; training?: string | null }

/** The person's plots in a cloud project (MyPlotsService): "files" on an older server, which lists plot files instead */
export interface MyPlots {
  mode: "none" | "files" | "myPlots" | "pending";
  plots: number;
  updatedAt: number | null;
  checkedAt: number | null;
  leftOut: string[];
  unreadable: number;
  /** The training set open instead of the person's plots, by name */
  training: string | null;
  inUse: boolean;
  checkMinutes: number;
  /** After Refresh now: what the check did (UPDATED, UNCHANGED, OFFLINE…) */
  outcome?: string;
}

export const myPlots = (signal?: AbortSignal) => apiGet<MyPlots>("cloud/myPlots", signal);
export const refreshMyPlots = () => apiPost<MyPlots>("cloud/myPlots/refresh", {});
export const useMyPlots = () => apiPost<MyPlots>("cloud/myPlots/use", {});
export const openTraining = (id: string) => apiPost<MyPlots>("cloud/training/open", { id });

export const cloudAssignments = (signal?: AbortSignal) =>
  apiGet<{ assignments: CloudAssignment[] }>("cloud/assignments", signal).then((r) => r.assignments);

/** Downloads an assigned plot file into the project; answers where, for the plots file field */
export const downloadAssignment = (id: string) => apiPost<{ path: string }>("cloud/assignments/download", { id }).then((r) => r.path);

/** The plots the person was given to correct (CorrectionService): how many, how many are left, whether they are open */
export interface Corrections { plots: number; toCorrect: number; open: boolean; available: boolean }

export const corrections = (signal?: AbortSignal) => apiGet<Corrections>("cloud/corrections", signal);
export const refreshCorrections = () => apiPost<Corrections>("cloud/corrections/refresh", {});
/** The plots to correct made the plots file, instead of the person's plots */
export const openCorrections = () => apiPost<Corrections>("cloud/corrections/open", {});
/** Back to the person's plots */
export const closeCorrections = () => apiPost<Corrections>("cloud/corrections/close", {});

/** One answer of a plot to correct, as the server listed it (its XML left out) */
export interface CorrectionAnswerInfo { operator: string; recordKey: string; assessment: "main" | "check" | "other" | string; submitted: boolean; modifiedOn: number; summary: Record<string, string> }
/** A question on which the answers differ: each answer's value, labelled as the survey says it */
export interface CorrectionDifferenceInfo { key: string; question: string; values: { operator: string; value: string; label: string }[] }
/** What the form of a plot to correct shows beside it (GET cloud/corrections/plot) */
export interface CorrectionInfo {
  plot: string;
  placemarkId: string;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: number;
  /** The person answered it themselves: said, never refused */
  own: boolean;
  correctedAt: number | null;
  answers: CorrectionAnswerInfo[];
  differences: CorrectionDifferenceInfo[];
  /** Here: NONE, DRAFT, PENDING (submitted, not sent yet), SENT, REFUSED */
  state: CorrectionState;
  /** Why the server would not take it */
  reason: string | null;
}
export type CorrectionState = "NONE" | "DRAFT" | "PENDING" | "SENT" | "REFUSED";

export const correctionOf = (placemarkId: string, signal?: AbortSignal) =>
  apiGet<CorrectionInfo>("cloud/corrections/plot?id=" + encodeURIComponent(placemarkId), signal);
