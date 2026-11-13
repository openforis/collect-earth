const ee = require("@google/earthengine");
const { toError } = require("./eeError");

let initialised = null;

function loadKey() {
  const raw = process.env.EE_KEY;
  if (!raw) throw new Error("EE_KEY secret is not set (functions/.secret.local for the emulator)");
  return JSON.parse(raw);
}

/**
 * Authenticates once per process; later calls reuse the promise.
 * The Cloud project is passed explicitly: without it the client falls back to
 * "earthengine-legacy", which a registered project's service account cannot use.
 * EE_PROJECT overrides the key's project_id when set.
 */
function eeAuth() {
  if (!initialised) {
    initialised = new Promise((resolve, reject) => {
      const key = loadKey();
      const project = process.env.EE_PROJECT || key.project_id;
      const fail = (err) => reject(toError(err));
      ee.data.authenticateViaPrivateKey(
        key,
        () => ee.initialize(null, null, resolve, fail, null, project),
        fail
      );
    }).catch((err) => { initialised = null; throw toError(err); });
  }
  return initialised;
}

module.exports = { eeAuth, ee };
