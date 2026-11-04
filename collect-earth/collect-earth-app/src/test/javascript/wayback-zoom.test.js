// The zoom ESRI Wayback shows the plot at (resources/javascript_esri_wayback.fmt): the scale of Google Earth Web, no
// deeper than the imagery at the plot, which Wayback's tilemap tells. On a page with a fake map, a fake tilemap and a
// clock of its own. Needs the script ImageryPageScriptsTest renders; skipped without it.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { renderedScripts } = require("./gew-fake-page.js");

const scripts = renderedScripts();
const skip = scripts && scripts.wayback ? false : "run by ImageryPageScriptsTest, which renders the script";
const RELEASE = "43291";
// The plot of the script: 12.6919, -14.8026, shown over 80.7 m of ground, a map 760 px high: zoom 20.5 in GEW's scale
const GEW_ZOOM = Math.log2(156543.03392804097 * Math.cos(12.6919 * Math.PI / 180) * 760 / 80.7);

/** {tilemap: (zoom) => true|false|"fail"|"never"|{after, has}, storage} -> a page with the map ready */
function waybackPage({ tilemap, storage = {} } = {}) {
    const clock = { now: 0 };
    const timers = [];
    let nextTimer = 1;
    const schedule = (fn, millis, repeat) => {
        const id = nextTimer++;
        timers.push({ id, fn, millis, repeat, due: clock.now + millis });
        return id;
    };
    const cancel = (id) => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
    };
    const store = new Map(Object.entries(storage));
    const requests = [];
    const graphics = [];
    const view = {
        declaredClass: "esri.views.MapView",
        ready: true,
        height: 760,
        width: 1170,
        zoom: 19,
        constraints: {},
        goTos: [],
        map: { allLayers: { toArray: () => [
            { type: "web-tile", visible: true, urlTemplate: "https://{subDomain}.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/" + RELEASE + "/{level}/{row}/{col}" }
        ] } },
        graphics: {
            addMany: (items) => items.forEach((g) => graphics.push(Object.assign({}, g, {
                geometry: Object.assign({ declaredClass: "esri.geometry.Polygon" }, g.geometry) }))),
            removeMany: (items) => items.forEach((g) => graphics.splice(graphics.indexOf(g), 1)),
            toArray: () => graphics.slice()
        },
        goTo(target) { this.zoom = target.zoom; this.goTos.push(Math.round(target.zoom * 100) / 100); },
        watch: () => ({ remove() {} }),
        when: (fn) => fn()
    };
    const document = {
        querySelector: (s) => (s === "arcgis-map" ? { view } : null),
        querySelectorAll: () => []
    };
    function fetch(url, options) {
        const m = /\/tilemap\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
        requests.push(url);
        const answer = m && m[1] === RELEASE ? tilemap(Number(m[2])) : "fail";
        return new Promise((resolve, reject) => {
            if (answer === "never") {
                options.signal.addEventListener("abort", () => reject(new Error("aborted")));
                return;
            }
            if (answer === "fail") { resolve({ ok: false, json: () => Promise.resolve(null) }); return; }
            const respond = (has) => resolve({ ok: true, json: () => Promise.resolve({ data: [has ? 1 : 0], valid: true }) });
            if (answer && typeof answer === "object") schedule(() => respond(answer.has), answer.after, false);
            else respond(answer);
        });
    }
    const page = { view, requests, storage: store, clock, logs: [] };
    page.run = () => {
        const fn = new Function("window", "document", "localStorage", "setInterval", "clearInterval", "setTimeout",
            "clearTimeout", "fetch", "AbortController", "console", "location", scripts.wayback);
        fn({ location: { hash: "#mapCenter=-14.8026%2C12.6919%2C19&mode=explore" } }, document,
            { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
            (f, ms) => schedule(f, ms, true), cancel, (f, ms) => schedule(f, ms, false), cancel, fetch, AbortController,
            { log: (...a) => page.logs.push(a.join(" ")), warn: (...a) => page.logs.push(a.join(" ")) },
            { hash: "#mapCenter=-14.8026%2C12.6919%2C19&mode=explore" });
    };
    /** Moves the clock on, letting the promises of the answers settle at each step. */
    page.advance = async (millis) => {
        const end = clock.now + millis;
        while (clock.now < end) {
            clock.now = Math.min(end, clock.now + 50);
            for (const t of timers.slice().sort((a, b) => a.due - b.due)) {
                if (t.due > clock.now || !timers.includes(t)) continue;
                if (t.repeat) t.due += t.millis; else cancel(t.id);
                t.fn();
            }
            await new Promise((r) => setImmediate(r));
        }
    };
    return page;
}

const levels = (deepest) => (zoom) => zoom <= deepest;

test("the plot is shown no deeper than the imagery at it: zoom 17 where its tiles end at 17", { skip }, async () => {
    const page = waybackPage({ tilemap: levels(17) });
    page.run();
    await page.advance(1000);
    assert.deepEqual(page.view.goTos, [17], "fitted once, at the deepest zoom with imagery");
    assert.equal(page.requests.length, 8, "the levels from GEW's scale up, at once");
    assert.ok(page.requests.every((u) => u.includes("/tilemap/" + RELEASE + "/")), "for the release shown");
    // The plot seen again asks nothing
    const again = waybackPage({ tilemap: levels(17), storage: Object.fromEntries(page.storage) });
    again.run();
    await again.advance(600);
    assert.deepEqual(again.view.goTos, [17]);
    assert.equal(again.requests.length, 0);
});

test("where the imagery goes deeper than zoom 19, the plot is shown at the scale of Google Earth Web", { skip }, async () => {
    const page = waybackPage({ tilemap: levels(23) });
    page.run();
    await page.advance(1000);
    assert.deepEqual(page.view.goTos, [Math.round(GEW_ZOOM * 100) / 100]);
    assert.ok(GEW_ZOOM > 19);
});

test("imagery down to 20: zoom 20, not the 20.5 of Google Earth Web's scale", { skip }, async () => {
    const page = waybackPage({ tilemap: levels(20) });
    page.run();
    await page.advance(1000);
    assert.deepEqual(page.view.goTos, [20]);
});

test("without an answer the plot is shown as before, at zoom 19 at most, after 1.5 s", { skip }, async () => {
    const page = waybackPage({ tilemap: () => "never" });
    page.run();
    await page.advance(1900);
    assert.deepEqual(page.view.goTos, [], "the answer is waited for a little");
    await page.advance(2000);
    assert.deepEqual(page.view.goTos, [19], "fitted as before, and not again when the requests are given up");
});

test("a level that did not answer above the deepest found leaves the depth unknown", { skip }, async () => {
    const page = waybackPage({ tilemap: (zoom) => (zoom === 21 ? "fail" : zoom <= 17) });
    page.run();
    await page.advance(2000);
    assert.deepEqual(page.view.goTos, [19]);
});

test("an answer after the plot was fitted zooms again, unless the user zoomed meanwhile", { skip }, async () => {
    const slow = (zoom) => ({ after: 2000, has: zoom <= 18 });
    const page = waybackPage({ tilemap: slow });
    page.run();
    // the script finds the map at its first look, after half a second, and waits 1.5 s for the answer
    await page.advance(2100);
    assert.deepEqual(page.view.goTos, [19], "fitted as before while the answer is late");
    await page.advance(1000);
    assert.deepEqual(page.view.goTos, [19, 18], "and at the depth of the imagery once it came");

    const zoomed = waybackPage({ tilemap: slow });
    zoomed.run();
    await zoomed.advance(2100);
    zoomed.view.zoom = 16;
    await zoomed.advance(1000);
    assert.deepEqual(zoomed.view.goTos, [19], "the user's zoom is left alone");
    assert.equal(JSON.parse(zoomed.storage.get("__collectEarthWaybackNativeZoom"))[RELEASE + "/12.69190,-14.80260"], 18,
        "and the depth kept for the next time");
});
