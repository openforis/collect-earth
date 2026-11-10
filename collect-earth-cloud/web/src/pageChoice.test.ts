import { describe, expect, it } from "vitest";
import { choosePage } from "./pageChoice";

describe("two-step sign-in required of a coordinator who has not set it up", () => {
  const cloud = { needsSetup: false };
  it("sends every page to the account page, where it is set up", () => {
    expect(choosePage({ name: "home" }, cloud, true, null, true)).toEqual({ kind: "redirect", to: "/account" });
    expect(choosePage({ name: "project", projectId: "p", tab: "people" }, cloud, true, null, true)).toEqual({ kind: "redirect", to: "/account" });
    expect(choosePage({ name: "account" }, cloud, true, null, true)).toEqual({ kind: "route", route: { name: "account" } });
  });

  it("leaves everyone else, and the links anyone may open, alone", () => {
    expect(choosePage({ name: "home" }, cloud, true, null, false)).toEqual({ kind: "route", route: { name: "home" } });
    expect(choosePage({ name: "join", token: "t" }, cloud, true, null, true)).toEqual({ kind: "route", route: { name: "join", token: "t" } });
    // the local mode has no accounts to protect
    const progress = { name: "project" as const, projectId: "p1", tab: "progress" as const };
    expect(choosePage(progress, { needsSetup: false, localMode: true }, true, "p1", true)).toEqual({ kind: "route", route: progress });
  });
});
