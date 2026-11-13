const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BadRequest, NotFound, notFoundIfEmpty } = require("./errors");
const plotRequest = require("./plotRequest");

test("NotFound carries status 404 and code not_found", () => {
  const err = new NotFound("no landsat scene at 1970-01-01T00:00:00.001Z");
  assert.ok(err instanceof Error);
  assert.equal(err.status, 404);
  assert.equal(err.code, "not_found");
  assert.equal(err.message, "no landsat scene at 1970-01-01T00:00:00.001Z");
});

test("plotRequest re-exports the same BadRequest and NotFound classes", () => {
  assert.equal(plotRequest.BadRequest, BadRequest);
  assert.equal(plotRequest.NotFound, NotFound);
});

test("notFoundIfEmpty throws NotFound for a zero, missing or non-numeric size", () => {
  for (const size of [0, null, undefined, NaN]) {
    assert.throws(() => notFoundIfEmpty(size, "no Landsat scenes for 1984"), (err) => {
      assert.ok(err instanceof NotFound);
      assert.equal(err.status, 404);
      assert.equal(err.code, "not_found");
      assert.equal(err.message, "no Landsat scenes for 1984");
      return true;
    });
  }
});

test("notFoundIfEmpty returns the size when it is positive", () => {
  assert.equal(notFoundIfEmpty(1, "x"), 1);
  assert.equal(notFoundIfEmpty(42, "x"), 42);
});
