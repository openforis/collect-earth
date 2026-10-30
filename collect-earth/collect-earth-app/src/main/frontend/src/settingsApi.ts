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
