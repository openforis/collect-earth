import { describe, expect, it } from "vitest";
import { fromPairs, hasChanges, pairKey, toPairs } from "./assignmentGrid";
import { checklist, doneCount, STEP_ORDER, type ProjectFacts } from "./checklist";
import { passwordProblem, usernameProblem } from "./validation";

const empty: ProjectFacts = { hasProjectFile: false, plotFileCount: 0, memberCount: 1, openInviteCount: 0, assignmentCount: 0, recordCount: 0 };

describe("onboarding checklist", () => {
  it("a new project starts at uploading the project file", () => {
    const steps = checklist(empty);
    expect(steps.map((s) => s.id)).toEqual(STEP_ORDER);
    expect(steps.every((s) => !s.done)).toBe(true);
    expect(steps.filter((s) => s.current).map((s) => s.id)).toEqual(["projectFile"]);
    expect(doneCount(steps)).toBe(0);
  });

  it("the current step is the first one not done, even if later ones are done", () => {
    const steps = checklist({ ...empty, plotFileCount: 2, assignmentCount: 1 });
    expect(steps.find((s) => s.current)?.id).toBe("projectFile");
    expect(doneCount(steps)).toBe(2);
  });

  it("inviting is done with another person in, or an open link", () => {
    const base = { ...empty, hasProjectFile: true, plotFileCount: 1 };
    expect(checklist(base).find((s) => s.current)?.id).toBe("invite");
    expect(checklist({ ...base, openInviteCount: 1 }).find((s) => s.current)?.id).toBe("assign");
    expect(checklist({ ...base, memberCount: 2 }).find((s) => s.current)?.id).toBe("assign");
  });

  it("everything done: no current step", () => {
    const steps = checklist({ hasProjectFile: true, plotFileCount: 1, memberCount: 3, openInviteCount: 0, assignmentCount: 2, recordCount: 5 });
    expect(doneCount(steps)).toBe(5);
    expect(steps.some((s) => s.current)).toBe(false);
  });
});

describe("assignment grid", () => {
  const files = [
    { id: "f1", filename: "a.csv", checksum: "", plotCount: 1 },
    { id: "f2", filename: "b.csv", checksum: "", plotCount: 1 },
  ];
  const people = [
    { userId: "u1", username: "ana", role: "operator" as const },
    { userId: "u2", username: "bo", role: "operator" as const },
  ];

  it("round-trips and drops files or people that are gone", () => {
    const pairs = toPairs([
      { userId: "u1", csvFileId: "f1" },
      { userId: "u2", csvFileId: "f2" },
      { userId: "gone", csvFileId: "f1" },
    ]);
    expect(fromPairs(pairs, files, people)).toEqual([
      { userId: "u1", csvFileId: "f1" },
      { userId: "u2", csvFileId: "f2" },
    ]);
  });

  it("detects changes", () => {
    const saved = toPairs([{ userId: "u1", csvFileId: "f1" }]);
    expect(hasChanges(new Set(saved), saved)).toBe(false);
    expect(hasChanges(new Set([pairKey("f2", "u1")]), saved)).toBe(true);
    expect(hasChanges(new Set(), saved)).toBe(true);
  });
});

describe("username and password rules", () => {
  it("usernames", () => {
    expect(usernameProblem("maria.k@fao")).toBeNull();
    expect(usernameProblem("ab")).toBe("error.badUsername");
    expect(usernameProblem("has space")).toBe("error.badUsername");
    expect(usernameProblem("x".repeat(65))).toBe("error.badUsername");
  });
  it("passwords", () => {
    expect(passwordProblem("1234567")).toBe("error.weakPassword");
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("12345678", "12345679")).toBe("error.passwordsDiffer");
    expect(passwordProblem("12345678", "12345678")).toBeNull();
  });
});
