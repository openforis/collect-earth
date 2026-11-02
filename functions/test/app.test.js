const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp, asyncHandler, errorToResponse } = require("../app");

test("GET /api/health returns ok", async () => {
  const res = await request(createApp()).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test("unknown route returns JSON 404", async () => {
  const res = await request(createApp()).get("/api/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "not_found");
});

test("malformed JSON body returns 400 entity.parse.failed", async () => {
  const res = await request(createApp())
    .post("/api/health")
    .set("Content-Type", "application/json")
    .send("{bad");
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "entity.parse.failed");
  assert.equal(res.body.error.retryable, false);
});

test("errorToResponse maps EE busy errors to 503 ee_busy", () => {
  const { status, body } = errorToResponse(new Error("Computation timed out."));
  assert.equal(status, 503);
  assert.equal(body.error.code, "ee_busy");
  assert.equal(body.error.retryable, true);
});

test("errorToResponse passes through errors with status and code", () => {
  const err = Object.assign(new Error("nope"), { status: 400, code: "bad_request" });
  const { status, body } = errorToResponse(err);
  assert.equal(status, 400);
  assert.equal(body.error.code, "bad_request");
});

test("async route failures become JSON 500 internal", async () => {
  const app = createApp((a) => a.get("/api/boom", asyncHandler(async () => { throw new Error("x"); })));
  const res = await request(app).get("/api/boom");
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, "internal");
});

test("index handler responds 500 internal when routes fail to load", () => {
  const { createHandler } = require("../index");
  const handler = createHandler(() => { throw new Error("routes exploded"); });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  const origError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    handler({}, res);
  } finally {
    console.error = origError;
  }
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: { code: "internal", message: "API failed to load", retryable: false } });
  assert.equal(logged.length, 1);
});
