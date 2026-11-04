// The Google Earth Web overlay (resources/javascript_google_earth_web.fmt) on a page that plays Google Earth Web as it
// was measured in 2026-11 (see javascript_google_earth_web_camera.js): when the plot is drawn after Collect Earth sent
// the camera to it, and that it is never hidden but for a move. Needs the scripts ImageryPageScriptsTest
// renders; skipped without them.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPage, renderedScripts, camera } = require("./gew-fake-page.js");

const scripts = renderedScripts();
const skip = scripts ? false : "run by ImageryPageScriptsTest, which renders the overlay";

const DATA = "/data=CgRCAggBQgIIAEoNCP___________wEQAA";
const OFF = "\"false\"";
const ON = "\"true\"";
// The plots of ImageryPageScriptsTest: B is 278 km from A, C 111 m
const A = camera(12.6919, -14.8026, 128);
const B = camera(14.74772, -17.4766, 128);
const C = camera(12.6929, -14.8026, 128);
const SCRIPT_OF = { [A]: "plotA", [B]: "plotB", [C]: "plotC" };

function overlay(name, flightUrl, flyAnimation) {
    return scripts[name].replace("__FLIGHT_URL__", flightUrl || "").replace("__FLY_ANIMATION__", flyAnimation || "off");
}

/**
 * Google Earth Web at {@code at}, the outline of its plot drawn: animations off since before the page loaded when
 * {@code jumps}, on otherwise.
 */
function gewAt(at, { jumps, flyAnimation } = {}) {
    const now = 1800000000000;
    const storage = jumps
        ? { "earth.AnimationEnabled": OFF, "__collectEarthGewAnimationOffSince": String(now - 120000) }
        : { "earth.AnimationEnabled": ON };
    const page = createPage({ href: at + DATA, now, loadedAt: now - 60000, storage });
    page.flyAnimation = flyAnimation || (jumps ? "off" : "keep");
    assert.equal(page.run(overlay(SCRIPT_OF[at], "", page.flyAnimation)), "armed");
    assert.notEqual(page.until(true, 1000), null, "drawn over a camera at rest");
    return page;
}

/**
 * Collect Earth shows the plot of {@code to} in-page, as GoogleEarthWebService does: the navigation script, GEW adding
 * its /data= suffix, the outline injected once Collect Earth saw it (400 ms). Returns when the camera was sent.
 */
function showPlot(page, to) {
    const sentAt = page.clock.now;
    page.evaluate(scripts["in-page-navigation"], to);
    page.advance(70);
    page.href = to + DATA;
    page.advance(330);
    assert.equal(page.run(overlay(SCRIPT_OF[to], to, page.flyAnimation)), "armed");
    return sentAt;
}

/** GEW writes the camera it arrived at {@code millis} after it was sent (128 -> 128.00178597). */
function arrives(page, sentAt, to, millis, dist) {
    page.advance(sentAt + millis - page.clock.now);
    page.href = to.replace(",128d,", "," + (dist || "128.00178597") + "d,") + DATA;
}

test("GEW that jumps: the plot is drawn about half a second after it was chosen, and stays", { skip }, () => {
    const page = gewAt(A, { jumps: true });
    const sentAt = showPlot(page, B);
    assert.equal(page.outline(), "none", "not drawn from the plot before");
    const drawnAfter = page.until(true, 3000);
    assert.notEqual(drawnAfter, null);
    const fromSent = page.clock.now - sentAt;
    assert.ok(fromSent >= 600 && fromSent <= 750, "drawn " + fromSent + " ms after the camera was sent");
    assert.equal(page.hint(), "", "the plot is in view");
    const since = page.clock.now;
    page.advance(10000);
    assert.equal(page.hidesSince(since), 0, "never hidden after");
});

test("GEW that flies: drawn when it writes the camera it arrived at, not before, and never hidden after", { skip }, () => {
    const page = gewAt(A, { jumps: false });
    const sentAt = showPlot(page, B);
    page.advance(sentAt + 4100 - page.clock.now);
    assert.equal(page.outline(), "none", "not drawn over the imagery still moving");
    arrives(page, sentAt, B, 4150);
    page.advance(100);
    assert.equal(page.outline(), "block", "drawn at once from the camera it arrived at");
    const since = page.clock.now;
    page.advance(10000);
    assert.equal(page.hidesSince(since), 0);
});

test("a flight that happens not to change the URL is drawn once it has had the time, and is not taken for a jump", { skip }, () => {
    // As in the audit: the plots alternated between 1 s, drawn over a flight taken for a jump, and 8 s
    const page = gewAt(A, { jumps: false });
    let sentAt = showPlot(page, B);
    page.until(true, 9000);
    let took = page.clock.now - sentAt;
    assert.ok(took >= 4300 && took <= 5200, "a long flight, no camera written: drawn after " + took + " ms");

    // the next plot is not drawn before GEW got there
    sentAt = showPlot(page, A);
    page.advance(sentAt + 4000 - page.clock.now);
    assert.equal(page.outline(), "none", "a flight that did not change the URL taught nothing");
    arrives(page, sentAt, A, 4100);
    took = page.until(true, 2000);
    assert.notEqual(took, null);
    assert.ok(page.clock.now - sentAt <= 4300, "drawn as it arrived");

    // and a short hop, 111 m, waits only for a short flight
    sentAt = showPlot(page, C);
    page.until(true, 9000);
    took = page.clock.now - sentAt;
    assert.ok(took >= 1800 && took <= 2600, "111 m, no camera written: drawn after " + took + " ms");
    assert.equal(page.storage.get("__collectEarthGewJumps"), undefined);
});

test("a camera GEW writes again for the plot drawn redraws it in place, without hiding it", { skip }, () => {
    const page = gewAt(A, { jumps: true });
    const sentAt = showPlot(page, B);
    page.until(true, 3000);
    const since = page.clock.now;
    page.rings().forEach((r) => r.setAttribute("data-old", "1"));
    // An altitude recomputed, then the distance written with decimals, both within a second: no flight is that short
    page.advance(100);
    page.href = B.replace(",20a,", ",31.25a,") + DATA;
    page.advance(150);
    arrives(page, sentAt, B, 1100, "128.00151966");
    page.advance(3000);
    assert.equal(page.hidesSince(since), 0, "never hidden");
    assert.equal(page.outline(), "block");
    assert.equal(page.rings().filter((r) => r.getAttribute("data-old")).length, 0, "drawn again from the camera written");

    // That was not a flight: the next plot is still drawn as a jump
    const next = showPlot(page, A);
    page.until(true, 3000);
    assert.ok(page.clock.now - next <= 750, "drawn " + (page.clock.now - next) + " ms after");
});

test("GEW taken to jump that flies after all: kept drawn, and the next plots wait for their flight", { skip }, () => {
    // Collect Earth turned the animation off in this session: the page, loaded before, still flies
    const now = 1800000000000;
    const page = createPage({ href: A + DATA, now, loadedAt: now - 60000, storage: { "earth.AnimationEnabled": OFF } });
    page.flyAnimation = "off";
    page.run(overlay("plotA", "", "off"));
    page.until(true, 1000);
    // the user turned it off in GEW's settings, and on again: GEW's storage still says off, with no date
    const sentAt = showPlot(page, B);
    page.until(true, 3000);
    assert.ok(page.clock.now - sentAt <= 750, "taken for a jump");
    const since = page.clock.now;
    arrives(page, sentAt, B, 4300, "128.00151966");
    page.advance(2000);
    assert.equal(page.hidesSince(since), 0, "not hidden for the camera it arrived at");
    const next = showPlot(page, A);
    page.advance(next + 2000 - page.clock.now);
    assert.equal(page.outline(), "none", "the next plot waits for its flight");
});

test("the fly animation is turned off for the next page load, and the session's flights are waited for", { skip }, () => {
    const now = 1800000000000;
    const page = createPage({ href: A + DATA, now, loadedAt: now - 60000,
        storage: { "earth.AnimationEnabled": ON, "__collectEarthGewJumps": "1" } });
    page.flyAnimation = "off";
    page.run(overlay("plotA", "", "off"));
    assert.equal(page.storage.get("earth.AnimationEnabled"), OFF);
    assert.equal(page.storage.get("__collectEarthGewAnimationOffSince"), String(now));
    assert.equal(page.storage.get("__collectEarthGewJumps"), undefined, "what was learnt before is forgotten");
    page.until(true, 1000);
    const sentAt = showPlot(page, B);
    page.advance(sentAt + 3000 - page.clock.now);
    assert.equal(page.outline(), "none", "this page, loaded before, still flies");

    // gew_fly_animation=true leaves GEW's setting as it is
    const kept = createPage({ href: A + DATA, now, storage: { "earth.AnimationEnabled": ON } });
    kept.run(overlay("plotA", "", "keep"));
    assert.equal(kept.storage.get("earth.AnimationEnabled"), ON);
    assert.equal(kept.storage.get("__collectEarthGewAnimationOffSince"), undefined);
});

test("where GEW was before a jump, written late, does not move the plot", { skip }, () => {
    const page = gewAt(A, { jumps: true });
    const sentAt = showPlot(page, B);
    // right after the camera was sent, GEW writes the one it had over A
    page.href = A + DATA;
    page.until(true, 3000);
    assert.ok(page.clock.now - sentAt <= 750);
    assert.equal(page.hint(), "", "drawn from the camera it jumped to: in view");
    // and once more after the outline was drawn
    const since = page.clock.now;
    page.advance(300);
    page.href = A.replace(",20a,", ",21a,") + DATA;
    page.advance(2000);
    assert.equal(page.hidesSince(since), 0);
    assert.equal(page.hint(), "");
});

test("the user moving the camera hides the outline at once, and it is drawn where the move ends", { skip }, () => {
    const page = gewAt(B, { jumps: true });
    page.fire("wheel");
    assert.equal(page.outline(), "none", "hidden at once");
    page.advance(900);
    page.href = B.replace(",128d,", ",180.5d,") + DATA;
    assert.notEqual(page.until(true, 500), null, "drawn as soon as GEW wrote where the move ended");
    // the move ended out of view: the way back to the plot
    page.fire("mousedown", { buttons: 1 });
    page.fire("mousemove", { buttons: 1 });
    assert.equal(page.outline(), "none");
    page.fire("mouseup");
    page.advance(800);
    page.href = camera(14.76, -17.4766, 128) + DATA;
    page.until(true, 500);
    assert.equal(page.hint(), "hintOutOfView");
});

test("the outline drawn again (new neighbours, the tab shown again) is never hidden for it", { skip }, () => {
    const page = gewAt(A, { jumps: true });
    showPlot(page, B);
    page.until(true, 3000);
    const since = page.clock.now;
    assert.equal(page.run(overlay("plotB", "", "off")), "armed");
    assert.equal(page.outline(), "block", "drawn in the same script that replaced it");
    page.advance(3000);
    assert.equal(page.hidesSince(since), 0);
});

test("a camera moved by the plots map is drawn once it got there", { skip }, () => {
    const page = gewAt(B, { jumps: true });
    const moved = camera(14.7481, -17.4766, 160);
    const sentAt = page.clock.now;
    page.evaluate(scripts["camera-move"], moved);
    assert.equal(page.outline(), "none");
    page.until(true, 3000);
    assert.ok(page.clock.now - sentAt <= 750, "a jump: drawn " + (page.clock.now - sentAt) + " ms after");
});
