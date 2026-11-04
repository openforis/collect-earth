// Google Earth Web's camera as Collect Earth reads it from the page URL, and when the plot outline can be drawn from it.
// No page and no timers here: the time, the URLs and the settings are given, so that node can run it in the tests
// (src/test/javascript/gew-camera.test.js). javascript_google_earth_web.fmt includes it as it is (parse=false).
//
// What Google Earth Web does with a camera sent in-page (measured on GEW 2026-10, FlySpeed 1.0):
// - Animations on (its setting "earth.AnimationEnabled", the default): it flies there, about 1.7 s for 100 m, 3 s for
//   1 km and 4 to 4.5 s for 10 km and more (5 s from the globe). The URL keeps the camera sent all the while, and once
//   there GEW writes the camera it arrived at - but only as numbers with 8 decimals: an arrival at 128.00000000 m
//   leaves the URL as it was, which happened on 3 flights out of 6. A URL that does not change says nothing then.
// - Animations off: it jumps there at once and never writes a camera of its own.
// GEW reads the setting when it loads, from the local storage of earth.google.com: changed later, it applies from
// the next page load on.
var GewCamera = (function () {
    var RAD = Math.PI / 180;
    var METRES_PER_DEGREE = 111320;

    // How long a jump is given before the plot is drawn: GEW moves the camera at once, but may write, right after,
    // the camera it had before (see flightStep)
    var JUMP_SETTLE_MILLIS = 600;
    // The longest flight between two plots, and from the globe
    var LONGEST_FLIGHT_MILLIS = 5000;
    var LONGEST_FLIGHT_FROM_GLOBE_MILLIS = 6000;
    // The value GEW keeps for animations turned off
    var ANIMATION_OFF = "\"false\"";

    // Format: https://earth.google.com/web/@LAT,LON,ALTa,DISTd,FOVy,HEADINGh,TILTt,ROLLr
    function parse(href) {
        var m = String(href || "").match(
            /@(-?[0-9.]+),(-?[0-9.]+),(-?[0-9.]+)a,(-?[0-9.]+)d,(-?[0-9.]+)y,(-?[0-9.]+)h,(-?[0-9.]+)t,(-?[0-9.]+)r/);
        if (!m) return null;
        return {
            lat: parseFloat(m[1]), lon: parseFloat(m[2]), alt: parseFloat(m[3]),
            dist: parseFloat(m[4]), distText: m[4], fov: parseFloat(m[5]),
            heading: parseFloat(m[6]), tilt: parseFloat(m[7])
        };
    }

    // The globe seen from afar: the plot a dot in its middle
    function isGlobe(cam) {
        return cam.dist > 1e6;
    }

    // Metres on the ground between the points two cameras look at; across the antimeridian the shorter way round
    function groundMetres(a, b) {
        var e = (((a.lon - b.lon + 540) % 360) - 180) * METRES_PER_DEGREE * Math.cos(b.lat * RAD);
        var n = (a.lat - b.lat) * METRES_PER_DEGREE;
        return Math.sqrt(e * e + n * n);
    }

    function angleBetween(a, b) {
        var d = Math.abs(a - b) % 360;
        return d > 180 ? 360 - d : d;
    }

    // Still the camera sent: GEW may reformat the numbers it was given (-16.322392999999998 -> -16.322393), but it
    // keeps the distance as written until the camera arrives, then writes the one it computed (400 -> 400.00453096)
    function same(a, b) {
        return a.distText === b.distText && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5
            && a.heading === b.heading && a.tilt === b.tilt;
    }

    // Over the point of the camera sent: arriving, GEW recomputes the distance, but stays over the same point. Also a
    // camera stopped short at the ground of a hill (GoogleEarthWebService.aimAtTheGround).
    function over(a, b) {
        return groundMetres(a, b) <= Math.max(10, b.dist * 0.05);
    }

    // The view drawn from, written again by GEW: the camera it arrived at (128 -> 128.00178597), numbers reformatted,
    // an altitude recomputed. The outline is drawn again in place, never hidden for it.
    function correction(drawn, cam) {
        return !!cam && !!drawn && groundMetres(cam, drawn) <= Math.max(1, drawn.dist * 0.01)
            && Math.abs(cam.dist - drawn.dist) <= drawn.dist * 0.02
            && Math.abs(cam.fov - drawn.fov) < 0.5 && angleBetween(cam.heading, drawn.heading) < 0.5
            && Math.abs(cam.tilt - drawn.tilt) < 0.5;
    }

    // At most how long GEW's animation takes from one camera to the other (see the measures above), with some margin;
    // the longest when where it flies from is not known
    function flightMillis(from, to) {
        if (!from || !to) return LONGEST_FLIGHT_MILLIS;
        if (isGlobe(from)) return LONGEST_FLIGHT_FROM_GLOBE_MILLIS;
        var metres = groundMetres(from, to) + Math.abs(from.dist - to.dist);
        return Math.round(Math.min(LONGEST_FLIGHT_MILLIS, 2200 + 1300 * Math.log(Math.max(metres, 100) / 100) / Math.LN10));
    }

    /**
     * Whether GEW jumps to a camera sent, from its animation setting: the value kept in the local storage of
     * earth.google.com ({@code stored}), when Collect Earth turned it off ({@code offSince}, null if it did not) and when
     * the page was loaded ({@code loadedAt}). Turned off by Collect Earth, it applies only to a page loaded since; turned
     * off by the user, in GEW's settings, it applied at once.
     */
    function jumpsBySettings(stored, offSince, loadedAt) {
        if (stored !== ANIMATION_OFF) return false;
        if (offSince === null || offSince === undefined || isNaN(offSince)) return true;
        return loadedAt >= offSince;
    }

    /** A flight that says when it may be over: {cam, sentAt, jumps, until}. */
    function flight(sentUrl, fromUrl, sentAt, jumps) {
        var cam = parse(sentUrl);
        if (!cam) return null;
        return { cam: cam, sentAt: sentAt, jumps: jumps,
            until: sentAt + (jumps ? JUMP_SETTLE_MILLIS : flightMillis(parse(fromUrl), cam)) };
    }

    /**
     * What the camera of the URL now ({@code cam}, null if none) means for a flight to a camera sent:
     * "wait": still on its way;
     * "arrived": GEW wrote the camera it arrived at over the one sent, drawn from it at once;
     * "settled": the URL still has the camera sent, which has had the time to get there: drawn from it;
     * "stale": GEW, which jumps, wrote where it was before the camera was sent (it does so, at times, right after): the
     *   plot is drawn from the camera sent, which is where GEW is - drawing from the one written put the plot before,
     *   with no sample points, where the new one is;
     * "over": the flight says nothing more (the user took the camera, or it went elsewhere): the URL settles as any.
     */
    function flightStep(f, cam, now, userMoved) {
        if (userMoved) return "over";
        var inTime = now <= f.until;
        if (!cam) return inTime ? "wait" : "over";
        if (same(cam, f.cam)) return inTime ? "wait" : "settled";
        if (over(cam, f.cam)) return "arrived";
        if (inTime) return "wait";
        return f.jumps ? "stale" : "over";
    }

    /**
     * What a URL that changed after the outline was drawn from {@code drawn} means, the user not having touched the
     * camera (that hides the outline by itself):
     * "correction": the same view, written again by GEW: drawn again in place;
     * "stale": just after a jump ({@code staleExpected}), where GEW was before it: the outline stays as it is;
     * "moved": the camera moved: hidden until the URL settles.
     */
    function changeAfterDraw(drawn, cam, staleExpected) {
        if (correction(drawn, cam)) return "correction";
        if (staleExpected && cam && drawn && !over(cam, drawn)) return "stale";
        return "moved";
    }

    /**
     * Whether GEW, taken to jump, flew after all: a while after the camera was sent it wrote the one it arrived at over
     * it (a flight of 2 s and more), not a camera stopped short at the ground. Its animation was on when the page
     * loaded, whatever its setting says now.
     */
    function flewAfterAll(f, cam, now) {
        return !!f && f.jumps && !!cam && now - f.sentAt > 1500 && over(cam, f.cam) && !same(cam, f.cam)
            && cam.dist > f.cam.dist / 2;
    }

    return {
        JUMP_SETTLE_MILLIS: JUMP_SETTLE_MILLIS,
        ANIMATION_OFF: ANIMATION_OFF,
        parse: parse,
        isGlobe: isGlobe,
        groundMetres: groundMetres,
        same: same,
        over: over,
        correction: correction,
        flightMillis: flightMillis,
        jumpsBySettings: jumpsBySettings,
        flight: flight,
        flightStep: flightStep,
        changeAfterDraw: changeAfterDraw,
        flewAfterAll: flewAfterAll
    };
})();
