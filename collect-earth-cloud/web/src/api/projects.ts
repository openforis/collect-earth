// Projects: the list, a project's info and overview, the project file and its round, plot layout and imagery, the
// repeat survey, the members' roles and exclusion, former members, and new projects from CEO or a backup.

import type { AnonymizedAnswer, FormerMember, FormerMembersAnswer, Membership } from "../../../src/wire/account";
import type { ProjectCopyAnswer, ProjectStatus, ProjectStatusAnswer } from "../../../src/wire/projectSettings";
import type {
  BackupImportAnswer,
  BackupImportPreview,
  CeoFetchAnswer,
  CeoImportAnswer,
  CeoImportPreview,
  CepUploadAnswer,
  CollectImportPreview,
  CollectImportResult,
  ImageryAnswer,
  Member,
  MembersAnswer,
  NewProjectAnswer,
  Overview,
  PeriodHeaderAnswer,
  Periods,
  PlotLayout,
  PlotLayoutAnswer,
  PlotLayoutChangeAnswer,
  PlotPeriodsAnswer,
  ProjectInfo,
  ProjectListAnswer,
  PropertiesValues,
  RepeatAnswer,
  RepeatChange,
  RepeatPreview,
  RoundAnswer,
  RoundInfo,
} from "../../../src/wire/projects";
import { ApiError, Progress, p, request, send, upload } from "./transport";
import { Role } from "./common";
import { attachmentName } from "./data";

// --- former members (the server's src/routes/formerMembers.ts) -----------------------------------

export type { FormerMember } from "../../../src/wire/account";

export async function getFormerMembers(projectId: string): Promise<FormerMember[]> {
  return (await request<FormerMembersAnswer>("GET", `${p(projectId)}/former-members`)).formerMembers;
}

/** Renames a former member on everything they collected; gives the pseudonym and how many records. Cannot be undone. */
export function anonymizeFormerMember(projectId: string, operator: string): Promise<AnonymizedAnswer> {
  return request<AnonymizedAnswer>("POST", `${p(projectId)}/former-members/anonymize`, { json: { operator } });
}

// --- projects --------------------------------------------------------------------------

export async function listProjects(): Promise<Membership[]> {
  return (await request<ProjectListAnswer>("GET", "/v1/projects")).projects;
}

export function createProject(name: string): Promise<NewProjectAnswer> {
  return request("POST", "/v1/projects", { json: { name } });
}

export type { CeoImportAnswer, CeoImportPreview, CeoImportSummary, CeoReportEntry, ImportedPlotFile } from "../../../src/wire/projects";

/** CEO's files, as saved: the project (required), its plot list, its sample data (CSV); null when not given. */
export interface CeoFiles {
  project: string;
  plots: string | null;
  answers: string | null;
  /** the questions asked per sample point, a table with a row per point (Part E); per plot otherwise */
  perPoint?: boolean;
}

const ceoBody = (files: CeoFiles) => ({
  ceoProject: files.project,
  ...(files.plots !== null ? { ceoPlots: files.plots } : {}),
  ...(files.answers !== null ? { ceoAnswers: files.answers } : {}),
  ...(files.perPoint ? { perPoint: true } : {}),
});

/** A CEO project and its plot list, as text, read by the server from Collect Earth Online by the project's number. */
export function fetchCeoProject(ceoProjectId: string): Promise<CeoFetchAnswer> {
  return request("POST", "/v1/projects/from-ceo/fetch", { json: { ceoProjectId } });
}

/**
 * What a project saved from Collect Earth Online (its get-project-by-id file, as text) would become, with its plots
 * when CEO's plot list (get-project-plots) is given, and its answers with CEO's sample data; nothing is stored.
 */
export function previewCeoImport(files: CeoFiles): Promise<CeoImportPreview> {
  return request("POST", "/v1/projects/from-ceo/preview", { json: ceoBody(files) });
}

/** A new project from a project saved from Collect Earth Online: its survey, rules and plots; the caller is its coordinator. */
export function importCeoProject(
  files: CeoFiles,
  name: string,
  /** CEO collector's email -> the username of their account here (the others get a pseudonym) */
  collectors: Record<string, string>,
): Promise<CeoImportAnswer> {
  return request("POST", "/v1/projects/from-ceo", { json: { ...ceoBody(files), name, collectors } });
}

export type { BackupImportAnswer, BackupImportPreview, PlotLayout } from "../../../src/wire/projects";

/** A backup and the project's original plot file, as sent: the zip in base64, the plot file as text. */
export interface BackupFiles {
  backup: string;
  plotFile: string | null;
  plotFileName: string | null;
}

const backupBody = (files: BackupFiles) => ({
  backup: files.backup,
  ...(files.plotFile !== null ? { plotFile: files.plotFile, plotFileName: files.plotFileName ?? undefined } : {}),
});

/** A file's bytes in base64, read in pieces (String.fromCharCode takes a limited number of arguments). */
export function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** What a Collect Earth backup would make, with its original plot file when given; nothing is stored. */
export function previewBackupImport(files: BackupFiles): Promise<BackupImportPreview> {
  return request("POST", "/v1/projects/from-backup/preview", { json: backupBody(files) });
}

/** A new project from a Collect Earth backup: its survey, plots and records; the caller is its coordinator. */
export function importBackup(
  files: BackupFiles,
  name: string,
  layout: PlotLayout,
  /** a name typed in Collect Earth -> the username of their account here (the others keep the name) */
  collectors: Record<string, string>,
): Promise<BackupImportAnswer> {
  return request("POST", "/v1/projects/from-backup", { json: { ...backupBody(files), name, layout, collectors } });
}

export function getProject(projectId: string): Promise<ProjectInfo> {
  return request("GET", p(projectId));
}

/** A new project (a draft) from this one: its survey, plot files and settings; with `members`, its people and who does which plots. */
export function copyProject(projectId: string, name: string, members: boolean): Promise<ProjectCopyAnswer> {
  return request("POST", `${p(projectId)}/copy`, { json: { name, members } });
}

export type { HeaderQuestion, MatchReport, RepeatAnswer, RepeatPreview } from "../../../src/wire/projects";

export function previewRepeat(projectId: string, projectFile: string | null): Promise<RepeatPreview> {
  return request("POST", `${p(projectId)}/repeat/preview`, { json: projectFile ? { projectFile } : {} });
}

/** A new project (a draft) that collects this one's plots again, with this one's answers as an earlier period. */
export function repeatSurvey(
  projectId: string,
  body: { name: string; label: string; earlierLabel: string; members: boolean; headerQuestions: string[]; plots: "all" | "collected"; projectFile: string | null },
): Promise<RepeatAnswer> {
  const { projectFile, ...rest } = body;
  return request("POST", `${p(projectId)}/repeat`, { json: { ...rest, ...(projectFile ? { projectFile } : {}) } });
}

export type { Periods, RepeatSettings } from "../../../src/wire/projects";

export function getPeriods(projectId: string): Promise<Periods> {
  return request("GET", `${p(projectId)}/periods`);
}

export function setPeriodHeader(projectId: string, headerQuestions: string[]): Promise<PeriodHeaderAnswer> {
  return request("PUT", `${p(projectId)}/periods/header`, { json: { headerQuestions } });
}

export type { ChangeOutcome, ChangeRow, PeriodStatusAnswer, RepeatChange } from "../../../src/wire/projects";
export type { AreaEstimate, ChangeAreas } from "../../../src/wire/data";

const changeQuery = (question: string | null, period: string | null) =>
  [question ? `question=${encodeURIComponent(question)}` : "", period ? `period=${encodeURIComponent(period)}` : ""].filter(Boolean).join("&");

export function getRepeatChange(projectId: string, question: string | null, period: string | null): Promise<RepeatChange> {
  const query = changeQuery(question, period);
  return request("GET", `${p(projectId)}/periods/change${query ? `?${query}` : ""}`);
}

/** The comparison as a file: a row per plot, each period's answer, the collector's answer and the outcome. */
export async function downloadRepeatChange(projectId: string, question: string | null, period: string | null): Promise<{ blob: Blob; filename: string }> {
  const query = changeQuery(question, period);
  const response = await send("GET", `${p(projectId)}/periods/change.csv${query ? `?${query}` : ""}`);
  return { blob: await response.blob(), filename: attachmentName(response, "change.csv") };
}

/** The areas of the changes as a file: the outcomes, the transitions, the corrections and each answer's area. */
export async function downloadRepeatChangeAreas(projectId: string, question: string | null, period: string | null): Promise<{ blob: Blob; filename: string }> {
  const query = changeQuery(question, period);
  const response = await send("GET", `${p(projectId)}/periods/change-areas.csv${query ? `?${query}` : ""}`);
  return { blob: await response.blob(), filename: attachmentName(response, "change-areas.csv") };
}

/** Every period of a repeat survey side by side, one row per plot (coordinators): each question's answer in each period. */
export async function downloadPeriodsExport(projectId: string): Promise<{ blob: Blob; filename: string }> {
  const response = await send("GET", `${p(projectId)}/periods/export.csv`);
  return { blob: await response.blob(), filename: attachmentName(response, "periods.csv") };
}

export type { PlotPeriod, PlotPeriodsAnswer } from "../../../src/wire/projects";

/** One plot's answers in the earlier periods, with the questions' labels and the answers' names (from the survey). */
export function getPlotPeriods(projectId: string, plot: string): Promise<PlotPeriodsAnswer> {
  return request("GET", `${p(projectId)}/periods/plots/${encodeURIComponent(plot)}`);
}

export async function setProjectStatus(projectId: string, status: ProjectStatus): Promise<ProjectStatus> {
  return (await request<ProjectStatusAnswer>("PUT", `${p(projectId)}/status`, { json: { status } })).status;
}

export async function renameProject(projectId: string, name: string): Promise<void> {
  await send("PATCH", p(projectId), { json: { name } });
}

/** Deletes the project and everything in it; confirmName must be the project name. */
export async function deleteProject(projectId: string, confirmName: string): Promise<void> {
  await send("DELETE", p(projectId), { json: { confirmName } });
}

export function getOverview(projectId: string): Promise<Overview> {
  return request("GET", `${p(projectId)}/overview`);
}

/** Uploads the project file; answers what the server did about round. */
export async function uploadCep(projectId: string, file: Blob, onProgress?: Progress): Promise<RoundInfo> {
  return (await upload<CepUploadAnswer>("PUT", `${p(projectId)}/cep`, file, "application/zip", onProgress)).round;
}

export type { CollectImportPreview, CollectImportResult } from "../../../src/wire/projects";

/** `query`: collectImportQuery, the accounts the coordinator named for the operators. */
export function previewCollectImport(projectId: string, file: Blob, query: string, onProgress?: Progress): Promise<CollectImportPreview> {
  return upload<CollectImportPreview>("POST", `${p(projectId)}/records/import/preview${query}`, file, "application/zip", onProgress);
}

export function importCollectData(projectId: string, file: Blob, query: string, onProgress?: Progress): Promise<CollectImportResult> {
  return upload<CollectImportResult>("POST", `${p(projectId)}/records/import${query}`, file, "application/zip", onProgress);
}

/** What the server did about round in the current project file; null before any upload. */
export function getRoundInfo(projectId: string): Promise<RoundAnswer> {
  return request("GET", `${p(projectId)}/round`);
}

export type { ImageryAnswer, PlotLayoutAnswer, PlotLayoutChangeAnswer, PropertiesValues } from "../../../src/wire/projects";

/** The plot layout keys the project file has (Collect Earth's Settings > Plot), and whether records exist. */
export function getPlotLayout(projectId: string): Promise<PlotLayoutAnswer> {
  return request("GET", `${p(projectId)}/plot-layout`);
}

/** Writes the changed plot layout settings into the project file; answers the layout as it is now. */
export function setPlotLayout(projectId: string, changes: PropertiesValues): Promise<PlotLayoutChangeAnswer> {
  return request("PUT", `${p(projectId)}/plot-layout`, { json: changes });
}

/** The imagery window keys the project file has (Collect Earth's Settings > Imagery, without the Planet key). */
export function getImagery(projectId: string): Promise<ImageryAnswer> {
  return request("GET", `${p(projectId)}/imagery`);
}

/** Writes the changed imagery window settings into the project file; answers them as they are now. */
export function setImagery(projectId: string, changes: PropertiesValues): Promise<ImageryAnswer> {
  return request("PUT", `${p(projectId)}/imagery`, { json: changes });
}

/** Which code of the survey's own round marks re-assessments (null: none). */
export function setReassessmentCode(projectId: string, reassessmentCode: string | null): Promise<RoundInfo> {
  return request("PUT", `${p(projectId)}/round`, { json: { reassessmentCode } });
}

/**
 * The project file as the coordinator uploaded it. When the server serves the upload
 * unchanged it keeps no separate original (404), and the served file is the upload.
 */
export async function downloadOriginalCep(projectId: string): Promise<Blob> {
  try {
    return await (await send("GET", `${p(projectId)}/cep/original`)).blob();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;
    return await (await send("GET", `${p(projectId)}/cep`)).blob();
  }
}

// --- people -----------------------------------------------------------------------------------

export async function listMembers(projectId: string): Promise<Member[]> {
  return (await request<MembersAnswer>("GET", `${p(projectId)}/members`)).members;
}

export async function setMemberRole(projectId: string, userId: string, role: Role): Promise<void> {
  await send("PUT", `${p(projectId)}/members/${encodeURIComponent(userId)}`, { json: { role } });
}

/** Ends every session of a member (a lost laptop): they stay in the project and log in again. */
export async function signOutMember(projectId: string, userId: string): Promise<void> {
  await send("POST", `${p(projectId)}/members/${encodeURIComponent(userId)}/sign-out`);
}

/** Leaves a member's records out of the results (with an optional reason), or puts them back. */
export async function setMemberExcluded(projectId: string, userId: string, excluded: boolean, reason = ""): Promise<void> {
  const json = excluded && reason.trim() ? { excluded, reason: reason.trim() } : { excluded };
  await send("PUT", `${p(projectId)}/members/${encodeURIComponent(userId)}/excluded`, { json });
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  await send("DELETE", `${p(projectId)}/members/${encodeURIComponent(userId)}`);
}
