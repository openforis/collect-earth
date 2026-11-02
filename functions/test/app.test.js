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

test("errorToResponse maps a 404 not_found error to 404 without retry", () => {
  const { NotFound } = require("../lib/errors");
  const { status, body } = errorToResponse(new NotFound("no landsat scene at 1970-01-01T00:00:00.001Z"));
  assert.equal(status, 404);
  assert.deepEqual(body, { error: { code: "not_found", message: "no landsat scene at 1970-01-01T00:00:00.001Z", retryable: false } });
});

test("a route throwing NotFound answers JSON 404 and is not logged as an error", async () => {
  const { NotFound } = require("../lib/errors");
  const app = createApp((a) => a.get("/api/gone", asyncHandler(async () => { throw new NotFound("no Landsat scenes for 1984"); })));
  const origError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  let res;
  try {
    res = await request(app).get("/api/gone");
  } finally {
    console.error = origError;
  }
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: { code: "not_found", message: "no Landsat scenes for 1984", retryable: false } });
  assert.equal(logged.length, 0);
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

const CORS_ENV = { GCLOUD_PROJECT: "ce-earth-viewer" };
const ALLOWED = "https://ce-earth-viewer.web.app";
const echoRoutes = (a) => a.post("/api/echo", (req, res) => res.json(req.body));

test("OPTIONS preflight from an allowed origin answers 204 with the CORS headers and no body", async () => {
  const res = await request(createApp(undefined, { env: CORS_ENV }))
    .options("/api/ccdc")
    .set("Origin", ALLOWED)
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type");
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], ALLOWED);
  assert.equal(res.headers["access-control-allow-methods"], "POST, GET, OPTIONS");
  assert.equal(res.headers["access-control-allow-headers"], "content-type");
  assert.equal(res.headers["access-control-max-age"], "3600");
  assert.equal(res.headers["vary"], "Origin");
  assert.equal(res.text, "");
});

test("OPTIONS preflight from a disallowed origin is still 204 but carries no Access-Control-Allow-Origin", async () => {
  const res = await request(createApp(undefined, { env: CORS_ENV })).options("/api/ccdc").set("Origin", "https://evil.example");
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  assert.equal(res.headers["vary"], "Origin");
});

test("POST from an allowed origin is processed and echoes the origin in Access-Control-Allow-Origin", async () => {
  const res = await request(createApp(echoRoutes, { env: CORS_ENV })).post("/api/echo").set("Origin", ALLOWED).send({ hello: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { hello: 1 });
  assert.equal(res.headers["access-control-allow-origin"], ALLOWED);
  assert.equal(res.headers["vary"], "Origin");
});

test("POST from a disallowed origin is still processed but gets no Access-Control-Allow-Origin", async () => {
  const res = await request(createApp(echoRoutes, { env: CORS_ENV })).post("/api/echo").set("Origin", "https://evil.example").send({ hello: 2 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { hello: 2 });
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  assert.equal(res.headers["vary"], "Origin");
});

test("ALLOWED_ORIGINS in the app env overrides the project defaults", async () => {
  const app = createApp(undefined, { env: { GCLOUD_PROJECT: "ce-earth-viewer", ALLOWED_ORIGINS: "https://custom.example" } });
  const custom = await request(app).get("/api/health").set("Origin", "https://custom.example");
  assert.equal(custom.headers["access-control-allow-origin"], "https://custom.example");
  const def = await request(app).get("/api/health").set("Origin", ALLOWED);
  assert.equal(def.headers["access-control-allow-origin"], undefined);
});

test("a same-origin request (no Origin header) gets no CORS headers beyond Vary", async () => {
  const res = await request(createApp(undefined, { env: CORS_ENV })).get("/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  assert.equal(res.headers["vary"], "Origin");
});
