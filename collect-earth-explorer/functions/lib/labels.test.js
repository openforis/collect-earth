const { test } = require("node:test");
const assert = require("node:assert/strict");
const labels = require("./labels");
const examples = require("../test/tileLabels.json");

test("the label builders produce exactly the shared examples the web app recognises", () => {
  for (const { builder, args, label } of examples) assert.equal(labels[builder](...args), label, builder);
  assert.deepEqual(new Set(examples.map((e) => e.builder)), new Set(Object.keys(labels)), "every builder has an example");
});
