// The onboarding checklist on a project's Overview: the steps a new coordinator
// follows, in order, each one done or not from what the project already has.

import type { ProjectTab } from "./router";

export type StepId = "projectFile" | "plotFiles" | "invite" | "assign" | "progress";

export interface ProjectFacts {
  hasProjectFile: boolean;
  plotFileCount: number;
  /** Everyone in the project, the coordinator included. */
  memberCount: number;
  /** Invitation links still open (people may not have used them yet). */
  openInviteCount: number;
  /** Plot files given whole to someone. */
  assignmentCount: number;
  /** Plot files divided between people, with at least one person holding plots of it. */
  dividedFileCount?: number;
  recordCount: number;
}

export interface ChecklistStep {
  id: StepId;
  done: boolean;
  /** The first step not yet done: the one to do now. */
  current: boolean;
}

export const STEP_ORDER: StepId[] = ["projectFile", "plotFiles", "invite", "assign", "progress"];

export function checklist(facts: ProjectFacts): ChecklistStep[] {
  const done: Record<StepId, boolean> = {
    projectFile: facts.hasProjectFile,
    plotFiles: facts.plotFileCount > 0,
    // Done as soon as someone else is in, or a link is out there waiting to be used.
    invite: facts.memberCount > 1 || facts.openInviteCount > 0,
    // A file given whole or divided between people: dividing a file removes its whole-file assignments.
    assign: facts.assignmentCount > 0 || (facts.dividedFileCount ?? 0) > 0,
    progress: facts.recordCount > 0,
  };
  const firstOpen = STEP_ORDER.find((id) => !done[id]);
  return STEP_ORDER.map((id) => ({ id, done: done[id], current: id === firstOpen }));
}

/** How many steps are done, for "3 of 5 steps done". */
export function doneCount(steps: ChecklistStep[]): number {
  return steps.filter((s) => s.done).length;
}

/** Where each step is done: a tab and, for Setup, its section. */
export const STEP_PLACE: Record<StepId, { tab: ProjectTab; view?: string }> = {
  projectFile: { tab: "setup", view: "survey" },
  plotFiles: { tab: "setup", view: "plots" },
  invite: { tab: "people" },
  assign: { tab: "setup", view: "plots" },
  progress: { tab: "data" },
};
