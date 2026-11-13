const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluate, getTileUrl } = require("../ee/promise");
const { toError } = require("../ee/eeError");

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

test("toError returns an Error unchanged", () => {
  const err = new Error("already");
  assert.equal(toError(err), err);
});

test("toError wraps a string", () => {
  const err = toError("text");
  assert.ok(err instanceof Error);
  assert.equal(err.message, "text");
});

test("toError uses .message when present, else JSON", () => {
  assert.equal(toError({ message: "m" }).message, "m");
  assert.equal(toError({ code: 7 }).message, '{"code":7}');
  assert.ok(toError({ code: 7 }) instanceof Error);
});

test("evaluate rejects with the object's message or its JSON when EE reports an object", async () => {
  await assert.rejects(evaluate({ evaluate: (cb) => cb(undefined, { message: "m" }) }), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "m");
    return true;
  });
  await assert.rejects(evaluate({ evaluate: (cb) => cb(undefined, { code: 7 }) }), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, '{"code":7}');
    return true;
  });
});

test("getTileUrl rejects with the object's message when getMap reports an object", async () => {
  await assert.rejects(getTileUrl({ getMap: (vis, cb) => cb(null, { message: "nope" }) }), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "nope");
    return true;
  });
});
