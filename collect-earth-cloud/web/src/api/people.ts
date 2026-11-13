// The People tab, a person's page and My work.

import type { PeopleAnswer, PersonAnswer, TimeSpent } from "../../../src/wire/people";
import { Invite } from "./common";
import { p, request } from "./transport";

// --- people (the People tab, a person's page, My work) ------------------------------

export type {
  InviteRow,
  PeopleAnswer,
  PersonAnswer,
  PersonDetail,
  PersonFile,
  PersonRow,
  PersonStatus,
  PersonTime,
  PlotStatus,
  QualityAtHand,
  QuickPlot,
  SentBack,
  Speed,
  SyncHealth,
  TimeSpent,
  WeekSummary,
} from "../../../src/wire/people";

/** An open invitation link as listInvites gives it; `forUsername`: made for someone already in the project, to get the new project file. */
export interface PeopleInvite extends Invite {
  forUsername: string | null;
}

/** The People tab's table (coordinators), with the days in the browser's time zone. */
export function getPeople(projectId: string, timeZone: string): Promise<PeopleAnswer> {
  return request("GET", `${p(projectId)}/people?${new URLSearchParams({ tz: timeZone })}`);
}

/** One person's page (coordinators). */
export function getPerson(projectId: string, userId: string, timeZone: string): Promise<PersonAnswer> {
  return request("GET", `${p(projectId)}/people/${encodeURIComponent(userId)}?${new URLSearchParams({ tz: timeZone })}`);
}

/** How long the interpreters take per plot, and the plots done much quicker than the team usually takes (coordinators). */
export function getTimeSpent(projectId: string, person?: string): Promise<TimeSpent> {
  const query = person === undefined ? "" : `?${new URLSearchParams({ person })}`;
  return request("GET", `${p(projectId)}/time-spent${query}`);
}
