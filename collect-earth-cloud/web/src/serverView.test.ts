import { describe, expect, it } from "vitest";
import type { ServerOverview } from "./api";
import { attentionBySection, serverHealth } from "./serverView";

const NOW = Date.UTC(2026, 10, 12, 12);
const overview = (missing: string[]) => ({ database: { migrations: { applied: 30, shipped: 30 + missing.length, latest: "037", missing } } }) as unknown as ServerOverview;

describe("the server's health line", () => {
  it("is empty when all is well, and a figure not loaded yet says nothing", () => {
    expect(serverHealth({ unseenAlerts: 0, overview: overview([]), mailReady: true, now: NOW })).toEqual([]);
    expect(serverHealth({ unseenAlerts: null, overview: null, mailReady: null, now: NOW })).toEqual([]);
  });

  it("names the alerts not seen, the database updates not applied and mail not set up, each with its section", () => {
    expect(serverHealth({ unseenAlerts: 2, overview: overview(["038_x.sql"]), mailReady: false, outdatedAccounts: 3, now: NOW })).toEqual([
      { kind: "alerts", count: 2, section: "overview" },
      { kind: "migrations", count: 1, section: "system" },
      { kind: "mail", section: "system" },
      { kind: "versions", count: 3, section: "system" },
    ]);
    expect(serverHealth({ unseenAlerts: 0, overview: null, mailReady: true, outdatedAccounts: 0, now: NOW })).toEqual([]);
  });
});

describe("the counts on the menu", () => {
  it("counts the things needing attention by section, leaving out sections with none", () => {
    const items = serverHealth({ unseenAlerts: 2, overview: overview(["038_x.sql"]), mailReady: false, outdatedAccounts: 0, now: NOW });
    expect(attentionBySection(items)).toEqual({ overview: 1, system: 2 });
    expect(attentionBySection([])).toEqual({});
  });
});
