// The onboarding checklist on a project's Overview: the steps a new coordinator
// follows, in order, each one done or not from what the project already has.

export type StepId = "projectFile" | "plotFiles" | "invite" | "assign" | "progress";

export interface ProjectFacts {
  hasProjectFile: boolean;
  plotFileCount: number;
  /** Everyone in the project, the coordinator included. */
  memberCount: number;
  /** Invitation links still open (people may not have used them yet). */
  openInviteCount: number;
  assignmentCount: number;
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
    assign: facts.assignmentCount > 0,
    progress: facts.recordCount > 0,
  };
  const firstOpen = STEP_ORDER.find((id) => !done[id]);
  return STEP_ORDER.map((id) => ({ id, done: done[id], current: id === firstOpen }));
}

/** How many steps are done, for "3 of 5 steps done". */
export function doneCount(steps: ChecklistStep[]): number {
  return steps.filter((s) => s.done).length;
}

/** The tab where each step is done. */
export const STEP_TAB: Record<StepId, "file" | "plots" | "people" | "data"> = {
  projectFile: "file",
  plotFiles: "plots",
  invite: "people",
  assign: "plots",
  progress: "data",
};
