const { test } = require("node:test");
const assert = require("node:assert/strict");
require("./loadSecret");
const { eeAuth, ee } = require("../../ee/auth");
const { evaluate } = require("../../ee/promise");

test("authenticates and evaluates a constant", { skip: !process.env.EE_LIVE }, async () => {
  await eeAuth();
  assert.equal(await evaluate(ee.Number(2).add(3)), 5);
});
