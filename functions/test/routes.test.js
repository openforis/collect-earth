const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../app");
const { monthsBefore } = require("../ee/sentinel2Composite");
const { registerRoutes } = require("../routes");
const { belize } = require("./fixtures");

/** Runs fn with console.error silenced; returns what was logged. */
async function quietly(fn) {
  const origError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    await fn();
  } finally {
    console.error = origError;
  }
  return logged;
}

/** POSTs `body` to `path` with EE_KEY unset; returns the response and what was logged to console.error. */
async function postWithoutKey(path, body) {
  const saved = process.env.EE_KEY;
  delete process.env.EE_KEY;
  let res;
  try {
    const logged = await quietly(async () => {
      res = await request(createApp(registerRoutes)).post(path).send(body);
    });
    return { res, logged };
  } finally {
    if (saved !== undefined) process.env.EE_KEY = saved;
  }
}

/** Asserts a response is the JSON 500 reached when EE auth runs without a key. */
function assertEeKeyMissing500(res, logged) {
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, "internal");
  assert.equal(res.body.error.message, "Internal error");
  assert.equal(res.body.error.retryable, false);
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0] && logged[0][0].message), /EE_KEY secret is not set/);
}

test("monthsBefore subtracts whole months", () => {
  assert.equal(monthsBefore("2025-06-01", 12), "2024-06-01");
  assert.equal(monthsBefore("2025-01-15", 1), "2024-12-15");
});

test("monthsBefore pins Date.setUTCMonth rollover for short target months", () => {
  // 31 Mar minus one month is "31 Feb", which JavaScript rolls forward to 2 Mar
  // in a leap year (29 Feb + 2). Pinned here so a change is deliberate, not accidental.
  const result = monthsBefore("2024-03-31", 1);
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(result, "2024-03-02");
});

test("registerRoutes is a function and leaves /api/health working", async () => {
  assert.equal(typeof registerRoutes, "function");
  const res = await request(createApp(registerRoutes)).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("POST /api/tiles/sentinel2 without a body is a 400 bad_request", async () => {
  const res = await request(createApp(registerRoutes)).post("/api/tiles/sentinel2");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
  assert.match(res.body.error.message, /plot is required/);
});

test("POST /api/tiles/sentinel2 with a valid plot but no EE_KEY reaches the auth step and fails as JSON 500", async () => {
  const { res, logged } = await postWithoutKey("/api/tiles/sentinel2", { plot: belize, end: "2025-06-01" });
  assertEeKeyMissing500(res, logged);
});

test("POST /api/tiles/landsat with a valid plot but year 1900 is a 400 before EE auth", async () => {
  const { res, logged } = await postWithoutKey("/api/tiles/landsat", { plot: belize, year: 1900 });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
  assert.match(res.body.error.message, /1984/);
  assert.equal(logged.length, 0, "a 400 must not reach the EE auth step or be logged as a server error");
});

test("POST /api/tiles/landsat with a non-numeric year is a 400", async () => {
  const res = await request(createApp(registerRoutes)).post("/api/tiles/landsat").send({ plot: belize, year: "abc" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
});

test("POST /api/tiles/landsat without a body is a 400 bad_request", async () => {
  const res = await request(createApp(registerRoutes)).post("/api/tiles/landsat");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
  assert.match(res.body.error.message, /plot is required/);
});

test("POST /api/series/modis without a body is a 400 bad_request", async () => {
  const res = await request(createApp(registerRoutes)).post("/api/series/modis");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "bad_request");
  assert.match(res.body.error.message, /plot is required/);
});

test("POST /api/series/modis with a valid plot but no EE_KEY reaches the auth step and fails as JSON 500", async () => {
  const { res, logged } = await postWithoutKey("/api/series/modis", { plot: belize, start: "2020-01-01", end: "2021-01-01" });
  assertEeKeyMissing500(res, logged);
});
