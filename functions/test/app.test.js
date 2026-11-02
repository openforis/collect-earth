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

test("errorToResponse maps EE busy/quota errors to 503 ee_busy", () => {
  const busy = [
    "Computation timed out.",
    "Too many concurrent aggregations.",
    "User memory limit exceeded.",
    "Quota exceeded for quota metric",
    "Too Many Requests",
    "Service unavailable",
    "Rate limit exceeded",
    "An internal error has occurred",
  ];
  for (const message of busy) {
    const { status, body } = errorToResponse(new Error(message));
    assert.equal(status, 503, message);
    assert.equal(body.error.code, "ee_busy", message);
    assert.equal(body.error.retryable, true, message);
    assert.equal(body.error.message, message);
  }
});

test("errorToResponse keeps ordinary failures as 500 internal with the message", () => {
  const { status, body } = errorToResponse(new Error("plot ring needs at least 3 positions"));
  assert.equal(status, 500);
  assert.equal(body.error.code, "internal");
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.message, "plot ring needs at least 3 positions");
});

test("errorToResponse hides messages that mention secrets", () => {
  for (const message of ["EE_KEY secret is not set", "Unexpected token in private_key"]) {
    const { status, body } = errorToResponse(new Error(message));
    assert.equal(status, 500);
    assert.equal(body.error.code, "internal");
    assert.equal(body.error.message, "Internal error");
  }
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
