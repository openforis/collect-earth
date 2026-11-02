const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { createApp } = require("./app");

const EE_KEY = defineSecret("EE_KEY");

const loadRoutes = () => require("./routes").registerRoutes;

/** Builds the request handler; the app is created lazily on first request and cached. */
function createHandler(load = loadRoutes) {
  let app;
  return (req, res) => {
    try {
      if (!app) app = createApp(load());
    } catch (err) {
      console.error("API failed to load", err);
      res.status(500).json({ error: { code: "internal", message: "API failed to load", retryable: false } });
      return;
    }
    app(req, res);
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();

exports.api = onRequest(
  { region: "europe-west1", secrets: [EE_KEY], timeoutSeconds: 300, memory: "1GiB", concurrency: 10 },
  exports.handler
);
