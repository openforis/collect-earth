const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const FAKE_KEY = JSON.stringify({ client_email: "x@y", private_key: "k", project_id: "proj-123" });
const AUTH_PATH = require.resolve("../ee/auth");

let saved;
let ee;
let origAuthenticate;
let origInitialize;

/** Fresh auth module per test so its module-level memo starts empty. */
function freshAuth() {
  delete require.cache[AUTH_PATH];
  return require("../ee/auth");
}

beforeEach(() => {
  saved = { EE_KEY: process.env.EE_KEY, EE_PROJECT: process.env.EE_PROJECT };
  process.env.EE_KEY = FAKE_KEY;
  delete process.env.EE_PROJECT;
  ee = require("@google/earthengine");
  origAuthenticate = ee.data.authenticateViaPrivateKey;
  origInitialize = ee.initialize;
});

afterEach(() => {
  ee.data.authenticateViaPrivateKey = origAuthenticate;
  ee.initialize = origInitialize;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete require.cache[AUTH_PATH];
});

test("eeAuth passes the key's project_id as the 6th argument of ee.initialize", async () => {
  const { eeAuth, ee: exported } = freshAuth();
  assert.equal(exported, ee);
  const calls = [];
  ee.data.authenticateViaPrivateKey = (key, success) => { calls.push(["auth", key]); success(); };
  ee.initialize = (...args) => { calls.push(["init", args]); args[2](); };

  await eeAuth();

  assert.equal(calls[0][0], "auth");
  assert.equal(calls[0][1].project_id, "proj-123");
  assert.equal(calls[1][0], "init");
  assert.equal(calls[1][1][5], "proj-123");
  assert.equal(calls[1][1][4], null);
});

test("EE_PROJECT overrides the key's project_id", async () => {
  process.env.EE_PROJECT = "override-proj";
  const { eeAuth } = freshAuth();
  let project;
  ee.data.authenticateViaPrivateKey = (key, success) => success();
  ee.initialize = (...args) => { project = args[5]; args[2](); };

  await eeAuth();
  assert.equal(project, "override-proj");
});

test("eeAuth is memoised: two calls while pending share one promise and one authenticate", async () => {
  const { eeAuth } = freshAuth();
  let authCalls = 0;
  let finish;
  ee.data.authenticateViaPrivateKey = (key, success) => { authCalls++; finish = success; };
  ee.initialize = (...args) => args[2]();

  const p1 = eeAuth();
  const p2 = eeAuth();
  assert.equal(p1, p2);
  assert.equal(authCalls, 1);
  finish();
  await p1;
  assert.equal(await eeAuth(), await p1);
  assert.equal(authCalls, 1);
});

test("a failed attempt rejects with an Error and the next call retries", async () => {
  const { eeAuth } = freshAuth();
  let authCalls = 0;
  ee.data.authenticateViaPrivateKey = (key, success, error) => {
    authCalls++;
    if (authCalls === 1) error("bad key");
    else success();
  };
  ee.initialize = (...args) => args[2]();

  await assert.rejects(eeAuth(), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "bad key");
    return true;
  });
  await eeAuth();
  assert.equal(authCalls, 2);
});

test("an initialize failure rejects with a normalised Error", async () => {
  const { eeAuth } = freshAuth();
  ee.data.authenticateViaPrivateKey = (key, success) => success();
  ee.initialize = (...args) => args[3]({ message: "init failed" });

  await assert.rejects(eeAuth(), (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.message, "init failed");
    return true;
  });
});

test("a missing EE_KEY rejects before authenticating", async () => {
  delete process.env.EE_KEY;
  const { eeAuth } = freshAuth();
  let authCalls = 0;
  ee.data.authenticateViaPrivateKey = () => { authCalls++; };

  await assert.rejects(eeAuth(), /EE_KEY secret is not set/);
  assert.equal(authCalls, 0);
});
