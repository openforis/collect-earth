import { describe, expect, it } from "vitest";
import { changesAppInfo, nextNotice, opensSendToCloud, sanitizeNoticeHtml, type Notice, splitOptions } from "./notices";

describe("the HTML of a notice", () => {
  it("keeps the formatting and links the notices use", () => {
    expect(sanitizeNoticeHtml("<html><b>New version!</b><br/>How do you want to proceed?</html>"))
      .toBe("<b>New version!</b><br>How do you want to proceed?");
    expect(sanitizeNoticeHtml('<h2>Hi</h2><p class="x">See <a href="https://openforis.org/?a=1&amp;b=2" target="_blank">this</a> &amp; <i>that</i></p><ul><li>one</li></ul>'))
      .toBe('<h2>Hi</h2><p>See <a href="https://openforis.org/?a=1&amp;b=2">this</a> &amp; <i>that</i></p><ul><li>one</li></ul>');
    expect(sanitizeNoticeHtml("<a href='mailto:x@y.org'>mail</a> 1 < 2")).toBe('<a href="mailto:x@y.org">mail</a> 1 &lt; 2');
  });
  it("takes out scripts, event handlers and javascript: links", () => {
    expect(sanitizeNoticeHtml("a<script>alert(1)</script>b<style>p{}</style>")).toBe("ab");
    expect(sanitizeNoticeHtml('<img src=x onerror="alert(1)"><b onclick="alert(1)">x</b>')).toBe("<b>x</b>");
    expect(sanitizeNoticeHtml('<a href="javascript:alert(1)">x</a><a href=" JaVaScRiPt:alert(1)">y</a>')).toBe("<a>x</a><a>y</a>");
    expect(sanitizeNoticeHtml('<a href="https://a" title=">"<img src=x onerror=alert(1)>">z</a>')).not.toMatch(/<img|<script/);
    expect(sanitizeNoticeHtml("<!-- <script>alert(1)</script> -->ok<scr<script>ipt>alert(1)</script>")).not.toContain("<script");
  });
});

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
