import { describe, expect, it } from "vitest";
import { nextNotice, type Notice } from "./notices";

const notice = (id: string): Notice => ({ id, kind: "error", severity: "error", title: "t", message: "m", html: false, options: [{ id: "ok", label: "Ok" }] });

describe("the notices", () => {
  it("show the first one not answered", () => {
    expect(nextNotice([notice("n1"), notice("n2")], new Set())?.id).toBe("n1");
    expect(nextNotice([notice("n1"), notice("n2")], new Set(["n1"]))?.id).toBe("n2");
    expect(nextNotice([notice("n1")], new Set(["n1"]))).toBeNull();
    expect(nextNotice([], new Set())).toBeNull();
  });
});
