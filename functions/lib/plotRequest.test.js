const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parsePlotRequest, toPolygon } = require("./plotRequest");

const ring = [[30.169231, -2.066067], [30.16986, -2.066067], [30.16986, -2.0667], [30.169231, -2.0667], [30.169231, -2.066067]];

test("converts Collect Earth MultiLineString to Polygon", () => {
  const poly = toPolygon({ type: "MultiLineString", coordinates: [ring] });
  assert.deepEqual(poly, { type: "Polygon", coordinates: [ring] });
});

test("accepts Polygon unchanged", () => {
  const poly = toPolygon({ type: "Polygon", coordinates: [ring] });
  assert.deepEqual(poly, { type: "Polygon", coordinates: [ring] });
});

test("parses a full request and clamps dates", () => {
  const r = parsePlotRequest({ plot: { type: "Polygon", coordinates: [ring] }, start: "1970-01-01", end: "2099-01-01" }, new Date("2026-11-01"));
  assert.equal(r.start, "1984-01-01");
  assert.equal(r.end, "2026-11-01");
  assert.equal(r.plot.type, "Polygon");
});

test("rejects missing plot", () => {
  assert.throws(() => parsePlotRequest({}), { status: 400, code: "bad_request", message: /plot/ });
});

test("rejects plots larger than 100 ha", () => {
  const big = [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]]; // ~490 ha
  assert.throws(() => parsePlotRequest({ plot: { type: "Polygon", coordinates: [big] } }), /100 ha/);
});

const polyBody = { plot: { type: "Polygon", coordinates: [ring] } };
const bad = { status: 400, code: "bad_request" };

test("parses unpadded dates as UTC regardless of machine timezone", () => {
  const r = parsePlotRequest({ ...polyBody, start: "2000-1-5", end: "2026-11-1" }, new Date("2026-11-02T00:30:00Z"));
  assert.equal(r.start, "2000-01-05");
  assert.equal(r.end, "2026-11-01");
});

test("rejects impossible dates", () => {
  assert.throws(() => parsePlotRequest({ ...polyBody, start: "2000-02-31" }), { ...bad, message: /invalid date/ });
  assert.throws(() => parsePlotRequest({ ...polyBody, start: "2000-13-01" }), { ...bad, message: /invalid date/ });
});

test("garbage date falls back to the default", () => {
  const r = parsePlotRequest({ ...polyBody, start: "hello", end: "hello" }, new Date("2026-11-01T12:00:00Z"));
  assert.equal(r.start, "1984-01-01");
  assert.equal(r.end, "2026-11-01");
});

test("default end is today in UTC", () => {
  const r = parsePlotRequest(polyBody, new Date("2026-11-01T23:30:00Z"));
  assert.equal(r.end, "2026-11-01");
});

test("rejects start after end", () => {
  assert.throws(() => parsePlotRequest({ ...polyBody, start: "2020-01-02", end: "2020-01-01" }), { ...bad, message: /before end/ });
});

test("rejects malformed geometry with 400, never a TypeError", () => {
  assert.throws(() => toPolygon({ type: "MultiLineString", coordinates: [] }), bad);
  assert.throws(() => toPolygon({ type: "Polygon" }), bad);
  assert.throws(() => toPolygon({ type: "LineString", coordinates: [[0, 0], [1, 1]] }), { ...bad, message: /at least 3 positions/ });
  assert.throws(() => toPolygon({ type: "Polygon", coordinates: [[[0, 0], ["1", 0], [1, 1], [0, 0]]] }), { ...bad, message: /finite number/ });
  assert.throws(() => toPolygon({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 95], [0, 0]]] }), { ...bad, message: /out of range/ });
});

test("closes an open Polygon ring", () => {
  const open = ring.slice(0, 4);
  const poly = toPolygon({ type: "Polygon", coordinates: [open] });
  assert.equal(poly.coordinates[0].length, 5);
  assert.deepEqual(poly.coordinates[0][4], poly.coordinates[0][0]);
});

test("buffers a Point into a closed 5-position ring", () => {
  const poly = toPolygon({ type: "Point", coordinates: [30.17, -2.07] });
  assert.equal(poly.type, "Polygon");
  assert.equal(poly.coordinates[0].length, 5);
  assert.deepEqual(poly.coordinates[0][4], poly.coordinates[0][0]);
  assert.throws(() => toPolygon({ type: "Point", coordinates: ["30.17", -2.07] }), { ...bad, message: /finite number/ });
});

test("oversize message uses one decimal", () => {
  const big = [[0, 0], [0.02, 0], [0.02, 0.02], [0, 0.02], [0, 0]];
  assert.throws(() => parsePlotRequest({ plot: { type: "Polygon", coordinates: [big] } }), { ...bad, message: /plot is \d+\.\d ha/ });
});
