// The panel of the plots map in Google Earth Web's page (resources/javascript_plots_map_panel.fmt): the whole window for
// a dialog of the plots map, asked by the page in the panel only (panelDialogs.ts), with the window Google Earth Web is
// told of left as it was. Run by ImageryPageScriptsTest, through node --test.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FakeNode } = require("./gew-fake-page.js");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "..", "..", "resources", "javascript_plots_map_panel.fmt"), "utf8");
const URL_ = "http://127.0.0.1:8028/earth/map?panel";
const ORIGIN = "http://127.0.0.1:8028";

/** A node that takes listeners, as the panel's frame and handle do. */
function listening(node) {
    const listeners = {};
    node.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
    node.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); };
    node.fire = (type, props = {}) => (listeners[type] || []).slice().forEach((fn) => fn(Object.assign({ type }, props)));
    return node;
}

/** Google Earth Web's page, 1600 px wide (screen.width changes it), with the panel shown in it. */
function pageWithPanel(title = null) {
    const screen = { width: 1600 };
    class FakeWindow {}
    Object.defineProperty(FakeWindow.prototype, "innerWidth", { configurable: true, get() { return screen.width; } });
    const window = listening(new FakeWindow());
    window.dispatchEvent = (event) => { window.fire(event.type, event); return true; };
    const html = new FakeNode("html");
    const head = html.appendChild(new FakeNode("head"));
    const body = html.appendChild(new FakeNode("body"));
    const document = {
        head, body, title: "Google Earth",
        createElement: (tag) => listening(new FakeNode(tag)),
        querySelector: (selector) => html.querySelector(selector)
    };
    const storage = new Map();
    window.localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
    class MutationObserver { observe() {} disconnect() {} }
    class Event { constructor(type) { this.type = type; } }
    const run = (url, newTitle = title) => new Function("window", "document", "Window", "VisualViewport", "Event", "MutationObserver",
        "requestAnimationFrame", "location", "arguments", SCRIPT)(window, document, FakeWindow, undefined, Event,
        MutationObserver, () => 0, { href: "https://earth.google.com/web/" }, [url, newTitle]);
    assert.equal(run(URL_), "shown");
    const panel = document.querySelector("div[data-ce-panel]");
    const frame = panel.children.find((c) => c.tagName === "IFRAME");
    const handle = panel.children.find((c) => c.tagName === "DIV");
    const asked = [];
    frame.contentWindow = { postMessage: (data, origin) => asked.push({ data, origin }) };
    const tell = (data, from = frame.contentWindow, origin = ORIGIN) => window.fire("message", { data, source: from, origin });
    return { window, document, screen, panel, frame, handle, run, tell, asked };
}

test("a dialog of the plots map gets the whole window, Google Earth Web the same window as before", () => {
    const { window, panel, frame, handle, tell } = pageWithPanel();
    assert.equal(panel.style.width, "560px");
    assert.equal(window.innerWidth, 1040);

    tell({ type: "collectEarthPanel", expand: true, colorScheme: "dark" });
    assert.equal(panel.style.width, "100vw");
    assert.equal(panel.style.background, "transparent");
    assert.equal(panel.style.boxShadow, "none");
    assert.equal(handle.style.display, "none");
    assert.equal(frame.style.colorScheme, "dark", "the frame transparent: the color-scheme of its page");
    assert.equal(window.innerWidth, 1040, "Google Earth Web lays itself out as before");
    // The window resized meanwhile: the panel stays over all of it
    window.fire("resize", { isTrusted: true });
    assert.equal(panel.style.width, "100vw");

    tell({ type: "collectEarthPanel", expand: false, colorScheme: "dark" });
    assert.equal(panel.style.width, "560px");
    assert.equal(panel.style.background, "#121212");
    assert.notEqual(panel.style.boxShadow, "none");
    assert.equal(handle.style.display, "");
    assert.equal(frame.style.colorScheme, "", "the frame as it was made");
});

test("a window made narrower during a dialog leaves the panel the width it has room for once the dialog is closed", () => {
    const { window, screen, panel, tell } = pageWithPanel();
    tell({ type: "collectEarthPanel", expand: true, colorScheme: "light" });
    screen.width = 800;
    window.fire("resize", { isTrusted: true });
    assert.equal(panel.style.width, "100vw");
    assert.equal(window.innerWidth, 400, "Google Earth Web keeps its room beside the panel");
    tell({ type: "collectEarthPanel", expand: false });
    assert.equal(panel.style.width, "400px");
});

test("only the plots map in the panel is listened to", () => {
    const { panel, frame, tell } = pageWithPanel();
    const expand = { type: "collectEarthPanel", expand: true };
    tell(expand, {});
    tell(expand, frame.contentWindow, "https://evil.example");
    tell({ type: "other", expand: true });
    tell(null);
    assert.equal(panel.style.width, "560px");
    tell(expand, null);
    assert.equal(panel.style.width, "560px");
    tell({ type: "collectEarthPanel", expand: true, colorScheme: "dark;background:red" });
    assert.equal(panel.style.width, "100vw");
    assert.notEqual(frame.style.colorScheme, "dark;background:red");
    // The page going, a reload with a dialog open: its window is gone, and the message has no source
    tell({ type: "collectEarthPanel", expand: false }, null);
    assert.equal(panel.style.width, "560px");
    tell({ type: "collectEarthPanel", expand: true }, frame.contentWindow);
    tell({ type: "collectEarthPanel", expand: false }, null, "https://evil.example");
    assert.equal(panel.style.width, "100vw");
});

test("the panel is back when the plots map loads again, and stops listening once taken away", () => {
    const { window, panel, frame, tell, run, asked } = pageWithPanel();
    tell({ type: "collectEarthPanel", expand: true });
    frame.fire("load");
    assert.equal(panel.style.width, "560px");
    // and asks the page loaded, whose dialog may have opened before
    assert.deepEqual(asked, [{ data: { type: "collectEarthPanel", ask: true }, origin: ORIGIN }]);

    assert.equal(run(null), "removed");
    tell({ type: "collectEarthPanel", expand: true });
    assert.equal(panel.style.width, "560px");
    assert.equal(window.innerWidth, 1600);
});

test("the page keeps the title it is given, the survey's name once it is known, and gets its own back without the panel", () => {
    const { document, run } = pageWithPanel("Google Earth Web · Collect Earth");
    assert.equal(document.title, "Google Earth Web · Collect Earth");
    // the survey loaded after the panel was shown: the same panel, the new title
    assert.equal(run(URL_, "Sierra Leone 2026 · Google Earth Web · Collect Earth"), "kept");
    assert.equal(document.title, "Sierra Leone 2026 · Google Earth Web · Collect Earth");
    assert.equal(run(null), "removed");
    assert.equal(document.title, "Google Earth");
});
