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
    ["/projects/p-1/map", { name: "project", projectId: "p-1", tab: "map" }],
    ["/projects/p-1/plots?x=1", { name: "project", projectId: "p-1", tab: "plots" }],
    ["/projects/p-1/plots/f-9", { name: "plotFile", projectId: "p-1", fileId: "f-9" }],
    ["/join/AbC_123", { name: "join", token: "AbC_123" }],
    ["/join/a%2Bb", { name: "join", token: "a+b" }],
    ["/reset/tok", { name: "reset", token: "tok" }],
    ["/p/Ab_c-9", { name: "publicProgress", token: "Ab_c-9" }],
    ["/unsubscribe/pay.sig", { name: "unsubscribe", token: "pay.sig" }],
    ["/confirm-email/pay.sig", { name: "confirmEmail", token: "pay.sig" }],
    ["/projects/p-1/my-quality", { name: "myQuality", projectId: "p-1" }],
    ["/projects/p%201/my-quality", { name: "myQuality", projectId: "p 1" }],
    ["/projects/p-1/quality/team-report", { name: "teamReport", projectId: "p-1" }],
    ["/projects/p-1/quality/plot/17", { name: "plot", projectId: "p-1", plot: "17" }],
    ["/projects/p-1/quality/plot/17%2C2025", { name: "plot", projectId: "p-1", plot: "17,2025" }],
    ["/projects/p-1/people/u-7", { name: "person", projectId: "p-1", userId: "u-7" }],
    ["/projects/p-1/my-work", { name: "myWork", projectId: "p-1" }],
    ["/projects/p-1/activity", { name: "project", projectId: "p-1", tab: "activity" }],
    ["/projects/p-1/activity/week", { name: "weekly", projectId: "p-1", week: null }],
    ["/projects/p-1/activity/week/2026-W45", { name: "weekly", projectId: "p-1", week: "2026-W45" }],
  ])("%s", (path, route) => {
    expect(matchRoute(path)).toEqual(route);
  });

  it("anything else is not found", () => {
    for (const path of ["/projects/p/nope", "/projects/p/people/x/y", "/projects/p/my-work/x", "/projects/p/plots/f/x", "/projects/p/my-quality/x", "/projects/p/quality/other", "/projects/p/quality/team-report/x", "/projects/p/quality/plot", "/projects/p/quality/plot/1/x", "/projects/p/activity/week/45", "/projects/p/activity/week/2026-W45/x", "/projects/p/activity/other", "/join", "/join/a/b", "/whatever", "/reset/%E0%A4%A", "/p", "/p/a/b"]) {
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
      { name: "publicProgress", token: "t ok/x" },
      { name: "unsubscribe", token: "a.b/c" },
      { name: "confirmEmail", token: "a.b/c" },
      { name: "plotFile", projectId: "p 1", fileId: "f/2" },
      { name: "myQuality", projectId: "p/1" },
      { name: "myWork", projectId: "p/1" },
      { name: "person", projectId: "p 1", userId: "u/2" },
      { name: "teamReport", projectId: "p?1" },
      { name: "plot", projectId: "p 1", plot: "17,2025/a b" },
      { name: "weekly", projectId: "p 1", week: null },
      { name: "weekly", projectId: "p/1", week: "2026-W01" },
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
    expect(choosePage({ name: "publicProgress", token: "x" }, fresh, false).kind).toBe("route");
    // A weekly email's links work for anyone, with no account.
    expect(choosePage({ name: "unsubscribe", token: "x" }, fresh, false).kind).toBe("route");
    expect(choosePage({ name: "confirmEmail", token: "x" }, ready, false).kind).toBe("route");
  });

  it("logged out: log in on any page (sign-up only on its own page)", () => {
    expect(choosePage({ name: "home" }, ready, false)).toEqual({ kind: "login" });
    expect(choosePage({ name: "project", projectId: "p", tab: "people" }, ready, false)).toEqual({ kind: "login" });
    expect(choosePage({ name: "setup" }, ready, false)).toEqual({ kind: "login" });
    expect(choosePage({ name: "signup" }, ready, false)).toEqual({ kind: "signup" });
    expect(choosePage({ name: "join", token: "t" }, ready, false).kind).toBe("route");
    // A progress link opens for anyone, with no account.
    expect(choosePage({ name: "publicProgress", token: "t" }, ready, false)).toEqual({ kind: "route", route: { name: "publicProgress", token: "t" } });
  });

  it("logged in: the page itself, and away from the log-in pages", () => {
    expect(choosePage({ name: "home" }, ready, true)).toEqual({ kind: "route", route: { name: "home" } });
    expect(choosePage({ name: "login" }, ready, true)).toEqual({ kind: "redirect", to: "/" });
    expect(choosePage({ name: "signup" }, ready, true)).toEqual({ kind: "redirect", to: "/" });
    expect(choosePage({ name: "setup" }, ready, true)).toEqual({ kind: "redirect", to: "/" });
    expect(choosePage({ name: "notFound", path: "/x" }, ready, true).kind).toBe("route");
  });
});
