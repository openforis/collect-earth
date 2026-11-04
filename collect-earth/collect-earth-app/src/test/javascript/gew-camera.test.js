// The decisions on Google Earth Web's camera (resources/javascript_google_earth_web_camera.js), on their own.
// node --test src/test/javascript   (run by ImageryPageScriptsTest)
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "..", "..", "resources", "javascript_google_earth_web_camera.js"), "utf8");
const GewCamera = new Function(source + "\nreturn GewCamera;")();

const url = (lat, lon, dist, alt) => "https://earth.google.com/web/@" + lat + "," + lon + "," + (alt === undefined ? 20 : alt)
    + "a," + dist + "d,35y,0h,0t,0r/data=CgRCAggBQgIIAEoNCP___________wEQAA";
const cam = (lat, lon, dist, alt) => GewCamera.parse(url(lat, lon, dist, alt));
const OFF = "\"false\"";
const ON = "\"true\"";

test("parses the camera of a URL, and nothing of another", () => {
    const c = cam(12.6919, -14.8026, "128.00178597");
    assert.equal(c.lat, 12.6919);
    assert.equal(c.lon, -14.8026);
    assert.equal(c.dist, 128.00178597);
    assert.equal(c.distText, "128.00178597");
    assert.equal(c.fov, 35);
    assert.equal(GewCamera.parse("https://earth.google.com/web/"), null);
    assert.equal(GewCamera.parse(null), null);
    assert.equal(GewCamera.parse(undefined), null);
});

test("the camera sent is the same while GEW only reformats its numbers, not once it wrote the one it arrived at", () => {
    const sent = cam(-16.322392999999998, 12.5, 128);
    assert.ok(GewCamera.same(cam(-16.322393, 12.5, 128), sent));
    assert.ok(!GewCamera.same(cam(-16.322393, 12.5, "128.00000001"), sent));
    assert.ok(GewCamera.over(cam(-16.322393, 12.5, "128.00000001"), sent));
    // a camera stopped short at the ground of a hill is over the point sent too
    assert.ok(GewCamera.over(cam(-16.322393, 12.5, 9.5), sent));
    // 2 km away is not
    assert.ok(!GewCamera.over(cam(-16.302393, 12.5, 128), sent));
});

test("a camera written again for the view drawn is a correction; a zoom, a pan or a turn is not", () => {
    const drawn = cam(14.74772, -17.4766, 128);
    assert.ok(GewCamera.correction(drawn, cam(14.74772, -17.4766, "128.00178597")));
    assert.ok(GewCamera.correction(drawn, cam(14.74772, -17.4766, 128, 31.5)), "an altitude recomputed");
    assert.ok(GewCamera.correction(drawn, cam(14.747720001, -17.476600002, 128)), "numbers reformatted");
    assert.ok(!GewCamera.correction(drawn, cam(14.74772, -17.4766, 140)), "zoomed out");
    assert.ok(!GewCamera.correction(drawn, cam(14.74802, -17.4766, 128)), "33 m north");
    assert.ok(!GewCamera.correction(drawn, GewCamera.parse(url(14.74772, -17.4766, 128).replace("0h,", "30h,"))), "turned");
    assert.ok(!GewCamera.correction(drawn, null));
});

test("a flight is given the time GEW's animation takes, from how far it goes", () => {
    const to = cam(12.6919, -14.8026, 128);
    const near = GewCamera.flightMillis(cam(12.6929, -14.8026, 128), to);  // 111 m: flew in 1.7 s
    const km = GewCamera.flightMillis(cam(12.7019, -14.8026, 128), to);    // 1.1 km: 3 s
    const far = GewCamera.flightMillis(cam(15.1919, -14.8026, 128), to);   // 278 km: 4.1 s
    const globe = GewCamera.flightMillis(cam(5.1, 66.8, 31715932), to);    // the globe: 5.2 s
    assert.ok(near >= 2000 && near <= 2600, "111 m: " + near);
    assert.ok(km >= 3200 && km <= 4000, "1 km: " + km);
    assert.ok(far >= 4500 && far <= 5000, "278 km: " + far);
    assert.ok(globe >= 5500 && globe <= 6000, "globe: " + globe);
    assert.ok(near < km && km <= far);
    assert.equal(GewCamera.flightMillis(null, to), 5000, "from where is not known: the longest");
});

test("GEW jumps when its animation is off and the page loaded after it was turned off", () => {
    assert.equal(GewCamera.jumpsBySettings(OFF, 1000, 2000), true, "loaded since");
    assert.equal(GewCamera.jumpsBySettings(OFF, 3000, 2000), false, "loaded before Collect Earth turned it off");
    assert.equal(GewCamera.jumpsBySettings(OFF, null, 2000), true, "turned off by the user, in GEW's settings");
    assert.equal(GewCamera.jumpsBySettings(ON, 1000, 2000), false);
    assert.equal(GewCamera.jumpsBySettings(null, null, 2000), false, "never set: GEW's default flies");
});

test("a jump is drawn once it settled, from the camera sent", () => {
    const sentUrl = url(14.74772, -17.4766, 128);
    const f = GewCamera.flight(sentUrl, url(12.6919, -14.8026, 128), 10000, true);
    assert.equal(f.until, 10000 + GewCamera.JUMP_SETTLE_MILLIS);
    assert.equal(GewCamera.flightStep(f, GewCamera.parse(sentUrl), 10300, false), "wait");
    assert.equal(GewCamera.flightStep(f, GewCamera.parse(sentUrl), 10700, false), "settled");
});

test("a flight is drawn as soon as GEW writes where it arrived, or once it has had the time", () => {
    const sentUrl = url(14.74772, -17.4766, 128);
    const f = GewCamera.flight(sentUrl, url(12.6919, -14.8026, 128), 10000, false);
    assert.ok(f.until - 10000 >= 4500, "the flight has the time of a long one");
    assert.equal(GewCamera.flightStep(f, GewCamera.parse(sentUrl), 11000, false), "wait",
        "not drawn a second after: the camera is still on its way");
    assert.equal(GewCamera.flightStep(f, cam(14.74772, -17.4766, "128.00178597"), 14200, false), "arrived");
    // GEW arrived at 128.00000000: the URL never changes, and the flight is drawn once it has had the time
    assert.equal(GewCamera.flightStep(f, GewCamera.parse(sentUrl), f.until - 1, false), "wait");
    assert.equal(GewCamera.flightStep(f, GewCamera.parse(sentUrl), f.until + 1, false), "settled");
});

test("a camera written where GEW was before is waited past; after a jump the plot is drawn from the camera sent", () => {
    const sentUrl = url(14.74772, -17.4766, 128);
    const before = cam(12.6919, -14.8026, 128);
    const jump = GewCamera.flight(sentUrl, url(12.6919, -14.8026, 128), 10000, true);
    assert.equal(GewCamera.flightStep(jump, before, 10300, false), "wait");
    assert.equal(GewCamera.flightStep(jump, before, 10700, false), "stale");
    const fly = GewCamera.flight(sentUrl, url(12.6919, -14.8026, 128), 10000, false);
    assert.equal(GewCamera.flightStep(fly, before, 12000, false), "wait");
    assert.equal(GewCamera.flightStep(fly, before, fly.until + 1, false), "over", "never got there: the URL settles");
});

test("the user taking the camera ends the flight", () => {
    const sentUrl = url(14.74772, -17.4766, 128);
    const f = GewCamera.flight(sentUrl, null, 10000, false);
    assert.equal(GewCamera.flightStep(f, GewCamera.parse(sentUrl), 10500, true), "over");
});

test("after the outline was drawn, a URL GEW writes again is a correction, a camera elsewhere a move", () => {
    const drawn = cam(14.74772, -17.4766, 128);
    assert.equal(GewCamera.changeAfterDraw(drawn, cam(14.74772, -17.4766, "128.00151966"), false), "correction");
    assert.equal(GewCamera.changeAfterDraw(drawn, cam(14.74772, -17.4766, "128.00151966"), true), "correction");
    assert.equal(GewCamera.changeAfterDraw(drawn, cam(12.6919, -14.8026, 128), true), "stale");
    assert.equal(GewCamera.changeAfterDraw(drawn, cam(12.6919, -14.8026, 128), false), "moved");
    assert.equal(GewCamera.changeAfterDraw(drawn, cam(14.74772, -17.4766, 300), true), "moved");
});

test("a jump that GEW flew after all is told by the camera it wrote seconds later over the plot", () => {
    const sentUrl = url(14.74772, -17.4766, 128);
    const f = GewCamera.flight(sentUrl, null, 10000, true);
    assert.ok(GewCamera.flewAfterAll(f, cam(14.74772, -17.4766, "128.00151966"), 14400));
    assert.ok(!GewCamera.flewAfterAll(f, cam(14.74772, -17.4766, "128.00151966"), 10400), "at once: not a flight");
    assert.ok(!GewCamera.flewAfterAll(f, cam(14.74772, -17.4766, 9.8), 14400), "stopped short at the ground");
    assert.ok(!GewCamera.flewAfterAll(GewCamera.flight(sentUrl, null, 10000, false), cam(14.74772, -17.4766, "128.1"), 14400));
    assert.ok(!GewCamera.flewAfterAll(null, cam(14.74772, -17.4766, "128.1"), 14400));
});
