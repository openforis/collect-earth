const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, getTileUrl } = require("../ee/promise");

test("evaluate resolves with the callback result", async () => {
  assert.equal(await evaluate({ evaluate: (cb) => cb(42, undefined) }), 42);
});

test("evaluate rejects with an Error carrying the callback error message", async () => {
  await assert.rejects(evaluate({ evaluate: (cb) => cb(undefined, "boom") }), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "boom");
    return true;
  });
});

test("getTileUrl resolves with the map's urlFormat", async () => {
  const image = { getMap: (vis, cb) => cb({ urlFormat: "https://x/{z}/{x}/{y}" }) };
  assert.equal(await getTileUrl(image, {}), "https://x/{z}/{x}/{y}");
});

test("getTileUrl rejects when getMap reports an error", async () => {
  await assert.rejects(getTileUrl({ getMap: (vis, cb) => cb(null, "bad") }), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "bad");
    return true;
  });
});
