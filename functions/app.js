const express = require("express");

/** Maps any thrown error to the single JSON error shape of the API. */
function errorToResponse(err) {
  if (err && err.status && err.code) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, retryable: !!err.retryable } } };
  }
  const message = String((err && err.message) || err);
  const retryable = /timed out|too many concurrent|user memory limit|deadline/i.test(message);
  return {
    status: retryable ? 503 : 500,
    body: { error: { code: retryable ? "ee_busy" : "internal", message, retryable } },
  };
}

function createApp(registerRoutes) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  if (registerRoutes) registerRoutes(app);
  app.use((req, res) => res.status(404).json({ error: { code: "not_found", message: "Not found", retryable: false } }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const { status, body } = errorToResponse(err);
    if (status >= 500) console.error(err);
    res.status(status).json(body);
  });
  return app;
}

/** Wraps an async handler so rejections reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { createApp, asyncHandler, errorToResponse };
