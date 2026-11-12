import { describe, expect, it } from "vitest";
import type { ServerOverview } from "./api";
import { serverHealth } from "./serverView";

const NOW = Date.UTC(2026, 10, 12, 12);
const overview = (missing: string[]) => ({ database: { migrations: { applied: 30, shipped: 30 + missing.length, latest: "037", missing } } }) as unknown as ServerOverview;

describe("the server's health line", () => {
  it("is empty when all is well, and a figure not loaded yet says nothing", () => {
    expect(serverHealth({ alerts: [], overview: overview([]), mailReady: true, now: NOW })).toEqual([]);
    expect(serverHealth({ alerts: null, overview: null, mailReady: null, now: NOW })).toEqual([]);
  });

  it("names the alerts of the last day, the database updates not applied and mail not set up, each with its section", () => {
    const alerts = [
      { kind: "failed_logins" as const, at: NOW - 3600_000, count: 50 },
      { kind: "server_errors" as const, at: NOW - 23 * 3600_000, count: 20 },
      { kind: "sync_errors" as const, at: NOW - 30 * 3600_000, count: 50 },
    ];
    expect(serverHealth({ alerts, overview: overview(["038_x.sql"]), mailReady: false, now: NOW })).toEqual([
      { kind: "alerts", count: 2, section: "overview" },
      { kind: "migrations", count: 1, section: "system" },
      { kind: "mail", section: "system" },
    ]);
  });
});
