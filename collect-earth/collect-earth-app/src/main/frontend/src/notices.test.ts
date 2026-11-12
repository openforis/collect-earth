import { describe, expect, it } from "vitest";
import { changesAppInfo, nextNotice, opensSendToCloud, type Notice, splitOptions } from "./notices";

describe("the offer to send this computer's records after joining a cloud project", () => {
  const offer = { id: "1", kind: "cloudSendRecords", severity: "info", title: "", message: "", html: false, options: [] } as Notice;
  it("opens the send dialog when answered with Send only", () => {
    expect(opensSendToCloud(offer, "send")).toBe(true);
    expect(opensSendToCloud(offer, "later")).toBe(false);
    expect(opensSendToCloud({ ...offer, kind: "error" }, "send")).toBe(false);
  });
});

const notice = (id: string): Notice => ({ id, kind: "error", severity: "error", title: "t", message: "m", html: false, options: [{ id: "ok", label: "Ok" }] });

describe("a notice's choices", () => {
  it("are the options to pick from in it; the others are its buttons", () => {
    const options = [
      { id: "f1", label: "north.csv", detail: "120 plots", choice: "true" },
      { id: "f2", label: "south.csv", detail: "80 plots", choice: true },
      { id: "later", label: "Later" },
    ];
    expect(splitOptions(options)).toEqual({ choices: [options[0], options[1]], buttons: [options[2]] });
    expect(splitOptions([{ id: "ok", label: "Ok" }])).toEqual({ choices: [], buttons: [{ id: "ok", label: "Ok" }] });
  });
});

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
