import { describe, expect, it } from "vitest";
import { choosePage } from "./pageChoice";
import { matchRoute, pathFor, PROJECT_TABS, type Route } from "./router";

describe("matchRoute", () => {
  it.each<[string, Route]>([
    ["/", { name: "home" }],
    ["/projects", { name: "home" }],
    ["/projects/", { name: "home" }],
    ["/setup", { name: "setup" }],
    ["/login", { name: "login" }],
    ["/signup", { name: "signup" }],
    ["/account", { name: "account" }],
    ["/server", { name: "server" }],
    ["/projects/p-1", { name: "project", projectId: "p-1", tab: "progress" }],
    ["/projects/p-1/setup", { name: "project", projectId: "p-1", tab: "setup" }],
    // The old name of Setup, for bookmarks and links in notes.
    ["/projects/p-1/overview", { name: "project", projectId: "p-1", tab: "setup" }],
    ["/projects/p-1/people", { name: "project", projectId: "p-1", tab: "people" }],
    ["/projects/p-1/quality", { name: "project", projectId: "p-1", tab: "quality" }],
    ["/projects/p-1/plots?x=1", { name: "project", projectId: "p-1", tab: "plots" }],
    ["/projects/p-1/plots/f-9", { name: "plotFile", projectId: "p-1", fileId: "f-9" }],
    ["/join/AbC_123", { name: "join", token: "AbC_123" }],
    ["/join/a%2Bb", { name: "join", token: "a+b" }],
    ["/reset/tok", { name: "reset", token: "tok" }],
    ["/projects/p-1/my-quality", { name: "myQuality", projectId: "p-1" }],
    ["/projects/p%201/my-quality", { name: "myQuality", projectId: "p 1" }],
    ["/projects/p-1/quality/team-report", { name: "teamReport", projectId: "p-1" }],
  ])("%s", (path, route) => {
    expect(matchRoute(path)).toEqual(route);
  });

  it("anything else is not found", () => {
    for (const path of ["/projects/p/nope", "/projects/p/people/x", "/projects/p/plots/f/x", "/projects/p/my-quality/x", "/projects/p/quality/other", "/projects/p/quality/team-report/x", "/join", "/join/a/b", "/whatever", "/reset/%E0%A4%A"]) {
      expect(matchRoute(path).name, path).toBe("notFound");
    }
  });

  it("pathFor is the inverse of matchRoute", () => {
    const routes: Route[] = [
      { name: "home" },
      { name: "login" },
      { name: "signup" },
      { name: "setup" },
      { name: "account" },
      { name: "server" },
      { name: "join", token: "t/ok en" },
      { name: "reset", token: "r" },
      { name: "plotFile", projectId: "p 1", fileId: "f/2" },
      { name: "myQuality", projectId: "p/1" },
      { name: "teamReport", projectId: "p?1" },
      ...PROJECT_TABS.map((tab) => ({ name: "project" as const, projectId: "id with space", tab })),
    ];
    for (const route of routes) expect(matchRoute(pathFor(route))).toEqual(route);
    expect(pathFor({ name: "project", projectId: "p", tab: "progress" })).toBe("/projects/p");
    expect(pathFor({ name: "project", projectId: "p", tab: "setup" })).toBe("/projects/p/setup");
    expect(pathFor({ name: "myQuality", projectId: "p" })).toBe("/projects/p/my-quality");
    expect(pathFor({ name: "teamReport", projectId: "p" })).toBe("/projects/p/quality/team-report");
  });
});

describe("choosePage", () => {
  const ready = { needsSetup: false };
  const fresh = { needsSetup: true };

  it("a new server shows setup on every page except invitation and reset links", () => {
    expect(choosePage({ name: "home" }, fresh, false)).toEqual({ kind: "setup" });
    expect(choosePage({ name: "login" }, fresh, false)).toEqual({ kind: "setup" });
    expect(choosePage({ name: "join", token: "x" }, fresh, false)).toEqual({ kind: "route", route: { name: "join", token: "x" } });
    expect(choosePage({ name: "reset", token: "x" }, fresh, false).kind).toBe("route");
  });

  it("logged out: log in on any page (sign-up only on its own page)", () => {
    expect(choosePage({ name: "home" }, ready, false)).toEqual({ kind: "login" });
    expect(choosePage({ name: "project", projectId: "p", tab: "people" }, ready, false)).toEqual({ kind: "login" });
    expect(choosePage({ name: "setup" }, ready, false)).toEqual({ kind: "login" });
    expect(choosePage({ name: "signup" }, ready, false)).toEqual({ kind: "signup" });
    expect(choosePage({ name: "join", token: "t" }, ready, false).kind).toBe("route");
  });

  it("logged in: the page itself, and away from the log-in pages", () => {
    expect(choosePage({ name: "home" }, ready, true)).toEqual({ kind: "route", route: { name: "home" } });
    expect(choosePage({ name: "login" }, ready, true)).toEqual({ kind: "redirect", to: "/" });
    expect(choosePage({ name: "signup" }, ready, true)).toEqual({ kind: "redirect", to: "/" });
    expect(choosePage({ name: "setup" }, ready, true)).toEqual({ kind: "redirect", to: "/" });
    expect(choosePage({ name: "notFound", path: "/x" }, ready, true).kind).toBe("route");
  });
});
