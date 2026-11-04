import { describe, expect, it } from "vitest";
import { toTelemetry } from "./api";
import { scrubEvent, scrubUrl } from "./telemetry";

describe("error reports", () => {
  it("never keep a link's token, a query, a user nor a request body", () => {
    expect(scrubUrl("https://c.org/join/abc123?x=1")).toBe("https://c.org/join/:token");
    expect(scrubUrl("/reset/t0k3n")).toBe("/reset/:token");
    expect(scrubUrl("/projects/p1/training/s1/report#x")).toBe("/projects/p1/training/s1/report");
    const event = scrubEvent({ user: { username: "ana" }, request: { url: "https://c.org/p/tok?y", headers: { a: 1 }, data: "{}" }, breadcrumbs: [{ data: { url: "/join/abc", to: "/reset/x" } }] });
    expect(event).toEqual({ request: { url: "https://c.org/p/:token" }, breadcrumbs: [{ data: { url: "/join/:token", to: "/reset/:token" } }] });
  });

  it("read the server's settings, off when absent or odd", () => {
    expect(toTelemetry(null)).toBeNull();
    expect(toTelemetry({ sentryDsn: "http://insecure@x/1", events: false })).toBeNull();
    expect(toTelemetry({ sentryDsn: "https://k@sentry.io/1", environment: "production", release: "collect-earth-cloud@1", events: true })).toEqual({
      sentryDsn: "https://k@sentry.io/1",
      environment: "production",
      release: "collect-earth-cloud@1",
      events: true,
    });
  });
});
