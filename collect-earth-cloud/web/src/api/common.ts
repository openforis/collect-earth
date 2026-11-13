// The types and constants every area uses: roles, project statuses, the server's info, OpenStreetMap's tiles.

import type { MapTiles } from "../../../src/wire/account";
import type { ProjectStatus } from "../../../src/wire/projectSettings";
import { p, request } from "./transport";

export type Role = "admin" | "reviewer" | "operator";
export const ROLES: Role[] = ["operator", "reviewer", "admin"];
export type { ProjectCreation } from "../../../src/wire/account";
export type { ProjectStatus } from "../../../src/wire/projectSettings";
/** A project's lifecycle (the server's STATUS_MOVES): draft -> active -> closed (-> archived), closed -> active again. */
export const STATUS_MOVES: Record<ProjectStatus, readonly ProjectStatus[]> = { draft: ["active"], active: ["closed"], closed: ["active", "archived"], archived: ["closed"] };

export type { Announcement, DashboardTelemetry, MapTiles, Me, Membership, ServerInfo, Session } from "../../../src/wire/account";

/** Tells the server of a use of the dashboard it cannot see (it forwards it to Google Analytics, when it does). */
export function sendUsageEvent(projectId: string, name: "training_report_opened" | "training_report_printed", params: Record<string, string | number> = {}): void {
  request<unknown>("POST", `${p(projectId)}/telemetry`, { json: { name, params } }).catch(() => undefined);
}

/** OpenStreetMap's tiles (the server's default base map). */
export const OSM_TILES: MapTiles = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  attributionUrl: "https://www.openstreetmap.org/copyright",
  maxZoom: 19,
};

export type { CepInfo, OperatorProgress, Overview, ProjectInfo } from "../../../src/wire/projects";

/** An open invite as the People tab reads it (GET /people; the invites' own list is the server's OpenInvite). */
export interface Invite {
  id: string;
  role: Role;
  maxUses: number;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number | null;
}

export type { JoinPreview, NewInvite, OpenInvite } from "../../../src/wire/account";

export type { Member } from "../../../src/wire/projects";
export type {
  Assignment,
  AssignmentDetail,
  CsvColumns,
  CsvFile,
  CsvFileWarnings,
  DistributionSummary,
  DivisionBody,
  DivisionOrder,
  ListedCsvFile,
  NearbyAvailability,
  PersonShare,
  PlotColumn,
  StoredDistribution,
} from "../../../src/wire/plotFiles";

/** Agreement over some checks; rate (0..1) is null when there are too few checks to judge. */
export interface Rate {
  compared: number;
  agreeing: number;
  rate: number | null;
}

export type { AccountDeletion, ProjectRef } from "../../../src/wire/account";
export type { ResetLinkAnswer as ResetLink, SettingsChange, ShownSettings as ServerSettings, UserSummary as AdminUser } from "../../../src/wire/serverAdmin";

export type { CodeItem, NoteInfo, RoundInfo, RoundState } from "../../../src/wire/projects";
