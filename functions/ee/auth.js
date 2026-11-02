const ee = require("@google/earthengine");

let initialised = null;

function loadKey() {
  const raw = process.env.EE_KEY;
  if (!raw) throw new Error("EE_KEY secret is not set (functions/.secret.local for the emulator)");
  return JSON.parse(raw);
}

/** Authenticates once per process; later calls reuse the promise. */
function eeAuth() {
  if (!initialised) {
    initialised = new Promise((resolve, reject) => {
      ee.data.authenticateViaPrivateKey(
        loadKey(),
        () => ee.initialize(null, null, resolve, reject),
        reject
      );
    }).catch((err) => { initialised = null; throw err; });
  }
  return initialised;
}

module.exports = { eeAuth, ee };
