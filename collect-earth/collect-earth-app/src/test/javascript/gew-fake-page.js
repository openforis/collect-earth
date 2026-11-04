// A page with just what the Google Earth Web overlay (resources/javascript_google_earth_web.fmt) uses, on a clock the
// test moves: the overlay is run as Collect Earth runs it (the body of a function), and the test plays Google Earth
// Web by changing the URL. Run by ImageryPageScriptsTest, through node --test.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

class FakeNode {
    constructor(tag) {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.textContent = "";
        const style = {};
        Object.defineProperty(style, "cssText", {
            set(text) {
                String(text).split(";").forEach((rule) => {
                    const i = rule.indexOf(":");
                    if (i > 0) style[rule.slice(0, i).trim().replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = rule.slice(i + 1).trim();
                });
            },
            get() { return ""; }
        });
        this.style = style;
    }
    appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) this.children.splice(i, 1);
        child.parentNode = null;
        return child;
    }
    get firstChild() { return this.children[0] || null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; }
    contains(node) {
        for (let n = node; n; n = n.parentNode) if (n === this) return true;
        return false;
    }
    /** "tag[attr]", "[attr]" or "tag[attr='value']" only */
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
        const m = /^(\w+)?\[([\w-]+)(?:=['"]?([^'"\]]*)['"]?)?\]$/.exec(selector);
        if (!m) throw new Error("selector not supported by the fake page: " + selector);
        const found = [];
        const visit = (node) => {
            node.children.forEach((c) => {
                if ((!m[1] || c.tagName === m[1].toUpperCase()) && m[2] in c.attributes
                    && (m[3] === undefined || c.attributes[m[2]] === m[3])) found.push(c);
                visit(c);
            });
        };
        visit(this);
        return found;
    }
}

/**
 * A page at {@code href}, loaded at {@code loadedAt} (performance.timeOrigin). {@code onPopState} plays Google Earth
 * Web following in-page navigation. The clock starts at {@code now}.
 */
function createPage({ href, now = 1800000000000, loadedAt, storage = {}, onPopState } = {}) {
    const clock = { now };
    const timers = [];
    let nextTimer = 1;
    const listeners = {};
    const store = new Map(Object.entries(storage));
    const documentElement = new FakeNode("html");
    const body = new FakeNode("body");
    documentElement.appendChild(body);
    const page = { href, displays: [], console: [] };

    const window = {
        innerWidth: 1500,
        innerHeight: 860,
        location: { get href() { return page.href; } },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type, fn) {
            const l = listeners[type] || [];
            const i = l.indexOf(fn);
            if (i >= 0) l.splice(i, 1);
        },
        dispatchEvent(event) {
            if (event.type === "popstate" && onPopState) onPopState(page);
            (listeners[event.type] || []).slice().forEach((fn) => fn(event));
            return true;
        }
    };
    const document = {
        body,
        documentElement,
        hidden: false,
        createElement: (tag) => new FakeNode(tag),
        createElementNS: (ns, tag) => new FakeNode(tag),
        querySelector: (selector) => documentElement.querySelector(selector),
        querySelectorAll: (selector) => documentElement.querySelectorAll(selector)
    };
    const history = { pushState(state, title, url) { page.href = url; } };
    const localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => { store.set(k, String(v)); },
        removeItem: (k) => { store.delete(k); },
        get length() { return store.size; }
    };
    const performance = { timeOrigin: loadedAt === undefined ? clock.now - 60000 : loadedAt };
    const FakeDate = { now: () => clock.now };
    function setInterval(fn, millis) {
        const id = nextTimer++;
        timers.push({ id, fn, millis, due: clock.now + millis });
        return id;
    }
    function clearInterval(id) {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
    }
    class PopStateEvent { constructor(type) { this.type = type; } }
    const fakeConsole = { log: (...a) => page.console.push(a.join(" ")), warn: (...a) => page.console.push(a.join(" ")) };

    page.window = window;
    page.document = document;
    page.storage = store;
    page.clock = clock;

    /** Runs the overlay script (rendered from the template) as Collect Earth does; returns what it returns. */
    page.run = (script) => {
        const fn = new Function("window", "document", "history", "localStorage", "performance", "setInterval",
            "clearInterval", "Date", "Node", "PopStateEvent", "console", script);
        const result = fn(window, document, history, localStorage, performance, setInterval, clearInterval, FakeDate,
            FakeNode, PopStateEvent, fakeConsole);
        page.sample();
        return result;
    };
    /** Runs a script in the page as Collect Earth's in-page navigation does (arguments[0] = the URL). */
    page.evaluate = (script, ...args) => {
        const fn = new Function("window", "location", "document", "history", "localStorage", "Date", "PopStateEvent",
            "arguments", script);
        const result = fn(window, window.location, document, history, localStorage, FakeDate, PopStateEvent, args);
        page.sample();
        return result;
    };
    /** The outline: "block", "none", or null when there is none. */
    page.outline = () => {
        const svg = document.querySelector("svg[data-ce-overlay]");
        return svg ? svg.style.display : null;
    };
    page.rings = () => {
        const svg = document.querySelector("svg[data-ce-overlay]");
        return svg ? svg.children.filter((c) => c.getAttribute("data-ce-ring") === "plot") : [];
    };
    page.hint = () => {
        const hint = document.querySelector("[data-ce-hint]");
        return hint && hint.style.display !== "none" ? hint.textContent : "";
    };
    page.sample = () => {
        const shown = page.outline() === "block";
        const last = page.displays[page.displays.length - 1];
        if (!last || last.shown !== shown) page.displays.push({ at: clock.now, shown });
    };
    /** Moves the clock on by {@code millis}, running the timers that come due, in order. */
    page.advance = (millis) => {
        const end = clock.now + millis;
        for (;;) {
            const next = timers.slice().sort((a, b) => a.due - b.due)[0];
            if (!next || next.due > end) break;
            clock.now = next.due;
            next.due += next.millis;
            next.fn();
            page.sample();
        }
        clock.now = end;
    };
    /** Moves the clock on until the outline is shown or hidden ({@code shown}); the time it took, or null. */
    page.until = (shown, maxMillis) => {
        const start = clock.now;
        while (clock.now - start < maxMillis) {
            if ((page.outline() === "block") === shown) return clock.now - start;
            page.advance(10);
        }
        return (page.outline() === "block") === shown ? clock.now - start : null;
    };
    /** Fires a window event the user would cause. */
    page.fire = (type, props = {}) => {
        const event = Object.assign({ type, target: window }, props);
        (listeners[type] || []).slice().forEach((fn) => fn(event));
        page.sample();
    };
    /** How many times the outline went from shown to hidden since {@code since}. */
    page.hidesSince = (since) => page.displays.filter((d, i) => d.at >= since && !d.shown && i > 0 && page.displays[i - 1].shown).length;
    return page;
}

/** The scripts written by ImageryPageScriptsTest (the overlays rendered, Collect Earth's own): {name: script}. */
function renderedScripts() {
    const dir = process.env.CE_IMAGERY_PAGE_SCRIPTS;
    if (!dir) return null;
    const scripts = {};
    fs.readdirSync(dir).filter((f) => /\.(js|txt)$/.test(f)).forEach((f) => {
        scripts[f.replace(/\.(js|txt)$/, "")] = fs.readFileSync(path.join(dir, f), "utf8");
    });
    return scripts;
}

/** A camera URL as Collect Earth writes it. */
function camera(lat, lon, dist, alt) {
    return "https://earth.google.com/web/@" + lat + "," + lon + "," + (alt === undefined ? 20 : alt) + "a," + dist
        + "d,35y,0h,0t,0r";
}

module.exports = { createPage, renderedScripts, camera, FakeNode };
