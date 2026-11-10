import { describe, expect, it } from "vitest";
import { changesAppInfo, nextNotice, type Notice } from "./notices";

const notice = (id: string): Notice => ({ id, kind: "error", severity: "error", title: "t", message: "m", html: false, options: [{ id: "ok", label: "Ok" }] });

describe("the notices", () => {
  it("show the first one not answered", () => {
    expect(nextNotice([notice("n1"), notice("n2")], new Set())?.id).toBe("n1");
    expect(nextNotice([notice("n1"), notice("n2")], new Set(["n1"]))?.id).toBe("n2");
    expect(nextNotice([notice("n1")], new Set(["n1"]))).toBeNull();
    expect(nextNotice([], new Set())).toBeNull();
  });
});

describe("the notices that change the app's info", () => {
  it("are the cloud sign-in the server no longer takes, after which the login is asked for again", () => {
    const of = (kind: string) => ({ id: "1", kind, severity: "warning" as const, title: "", message: "", html: false, options: [] });
    expect(changesAppInfo(of("cloudSignedOut"))).toBe(true);
    expect(changesAppInfo(of("announcement"))).toBe(false);
  });
});
