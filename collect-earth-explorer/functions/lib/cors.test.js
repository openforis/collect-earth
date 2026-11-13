const { test } = require("node:test");
const assert = require("node:assert/strict");
const { corsOriginAllowed, allowedOrigins } = require("./cors");

test("ALLOWED_ORIGINS (comma-separated, whitespace tolerated) replaces the defaults", () => {
  const env = { ALLOWED_ORIGINS: "https://a.example, https://b.example ,", GCLOUD_PROJECT: "p" };
  assert.deepEqual(allowedOrigins(env), ["https://a.example", "https://b.example"]);
  assert.equal(corsOriginAllowed("https://a.example", env), true);
  assert.equal(corsOriginAllowed("https://b.example", env), true);
  assert.equal(corsOriginAllowed("https://p.web.app", env), false, "defaults are not merged in");
  assert.equal(corsOriginAllowed("http://localhost:5173", env), false);
});

test("defaults: the project's web.app and firebaseapp.com hosts plus local dev origins", () => {
  const env = { GCLOUD_PROJECT: "ce-earth-viewer" };
  assert.deepEqual(allowedOrigins(env), [
    "https://ce-earth-viewer.web.app",
    "https://ce-earth-viewer.firebaseapp.com",
    "http://localhost:5000",
    "http://localhost:5173",
    "http://127.0.0.1:5000",
    "http://127.0.0.1:5173",
  ]);
  for (const o of allowedOrigins(env)) assert.equal(corsOriginAllowed(o, env), true, o);
});

test("without GCLOUD_PROJECT only the local dev origins are allowed", () => {
  const env = {};
  assert.deepEqual(allowedOrigins(env), ["http://localhost:5000", "http://localhost:5173", "http://127.0.0.1:5000", "http://127.0.0.1:5173"]);
  assert.equal(corsOriginAllowed("https://undefined.web.app", env), false);
});

test("missing, empty, or unknown origins are not allowed; matching is exact", () => {
  const env = { GCLOUD_PROJECT: "ce-earth-viewer" };
  assert.equal(corsOriginAllowed(undefined, env), false);
  assert.equal(corsOriginAllowed("", env), false);
  assert.equal(corsOriginAllowed("https://evil.example", env), false);
  assert.equal(corsOriginAllowed("https://ce-earth-viewer.web.app.evil.example", env), false);
  assert.equal(corsOriginAllowed("http://ce-earth-viewer.web.app", env), false, "scheme must match");
  assert.equal(corsOriginAllowed("https://ce-earth-viewer.web.app/", env), false, "an Origin header has no path");
});

test("corsOriginAllowed defaults to process.env", () => {
  const saved = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "https://only.example";
  try {
    assert.equal(corsOriginAllowed("https://only.example"), true);
    assert.equal(corsOriginAllowed("http://localhost:5173"), false);
  } finally {
    if (saved === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = saved;
  }
});
