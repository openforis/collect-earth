const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { createApp } = require("./app");

const EE_KEY = defineSecret("EE_KEY");

let app;
function getApp() {
  if (!app) {
    const { registerRoutes } = require("./routes");
    app = createApp(registerRoutes);
  }
  return app;
}

exports.api = onRequest(
  { region: "europe-west1", secrets: [EE_KEY], timeoutSeconds: 300, memory: "1GiB", concurrency: 10 },
  (req, res) => getApp()(req, res)
);
