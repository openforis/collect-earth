const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimit, clientAddress } = require("./rateLimit");

test("counts per address in a fixed window and refuses past the limit with 429 rate_limited, retryable", () => {
  let t = 0;
  const { take } = createRateLimit({ limit: 2, now: () => t });
  take("a");
  take("a");
  take("b");
  assert.throws(() => take("a"), { status: 429, code: "rate_limited", retryable: true });
  t = 59_999;
  assert.throws(() => take("a"));
  t = 60_000;
  take("a");
  take("a");
  assert.throws(() => take("a"));
});

test("the default limit is 600 a minute", () => {
  const { take } = createRateLimit({ now: () => 0 });
  for (let i = 0; i < 600; i++) take("a");
  assert.throws(() => take("a"), { code: "rate_limited" });
});

test("expired windows are dropped", () => {
  let t = 0;
  const limit = createRateLimit({ now: () => t });
  for (let i = 0; i < 100; i++) limit.take(`10.0.0.${i}`);
  assert.equal(limit.size(), 100);
  t = 60_000;
  limit.take("10.0.1.1");
  assert.equal(limit.size(), 1);
});

test("clientAddress takes the last X-Forwarded-For entry, else the socket's address", () => {
  assert.equal(clientAddress({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2,  3.3.3.3" }, socket: {} }), "3.3.3.3");
  assert.equal(clientAddress({ headers: { "x-forwarded-for": "3.3.3.3" }, socket: {} }), "3.3.3.3");
  assert.equal(clientAddress({ headers: {}, socket: { remoteAddress: "::1" } }), "::1");
  assert.equal(clientAddress({ headers: { "x-forwarded-for": "" }, socket: { remoteAddress: "::1" } }), "::1");
});
