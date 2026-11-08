import { apiGet, apiPost, apiPut } from "./apiClient";
import type { CloudStatus } from "./project";

/** The calls of the Project and Help menus (ProjectsController, CloudController, FilesController, HelpController, AppInfoController). */

export const importProject = (path: string) => apiPost<{ restart: boolean }>("projects/import", { path });

/** A file dropped on the page: its bytes go to the server, which answers where it kept them */
export const uploadFile = (file: File) => apiPost<{ path: string }>("files/upload?name=" + encodeURIComponent(file.name), file);

export interface CloudPreview { baseUrl: string; inviteToken: string; projectId: string; projectName: string; role: string }

export const cloudPreview = (url: string) => apiPost<CloudPreview>("cloud/preview", { url });

export interface JoinRequest { baseUrl: string; inviteToken: string; projectId: string; username: string; password: string; register: boolean; code?: string }

export const cloudJoin = (request: JoinRequest) => apiPost<{ restart: boolean }>("cloud/join", request);

/** With `code` once the server asked for two-step sign-in's code (cloud.secondStepRequired). */
export const cloudLogin = (username: string, password: string, code?: string) => apiPost<{ operator: string }>("cloud/login", code ? { username, password, code } : { username, password });

/** The Log in button of the settings: the token of the server typed there, for its field; nothing is saved */
export const cloudToken = (url: string, username: string, password: string, code?: string) =>
  apiPost<{ token: string }>("cloud/token", code ? { url, username, password, code } : { url, username, password });

export const cloudStatus = (signal?: AbortSignal) => apiGet<CloudStatus>("cloud/status", signal);

export const cloudSyncNow = () => apiPost<void>("cloud/syncNow");

export const setLanguage = (language: string) => apiPut<void>("app/language", { language });

export const helpText = (name: "disclaimer" | "log", signal?: AbortSignal) => apiGet<{ path: string; text: string }>("help/text?name=" + name, signal);

export const setErrorsShown = (shown: boolean) => apiPut<void>("help/errorsShown", { shown });
