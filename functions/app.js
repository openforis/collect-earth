const express = require("express");

const RETRYABLE = /timed out|too many concurrent|user memory limit|deadline|quota exceeded|too many requests|rate limit|service unavailable|internal error/i;
const SECRETISH = /EE_KEY|private_key/;

/** Maps any thrown error to the single JSON error shape of the API. */
function errorToResponse(err) {
  if (err && err.status && err.code) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, retryable: !!err.retryable } } };
  }
  // Client errors raised by middleware such as express.json (malformed or oversized body)
  // carry a status and a `type` but no `code`; pass them through rather than masking as 500.
  if (err && err.status >= 400 && err.status < 500) {
    return { status: err.status, body: { error: { code: err.type || "bad_request", message: err.message, retryable: false } } };
  }
  const message = String((err && err.message) || err);
  const retryable = RETRYABLE.test(message);
  if (retryable) return { status: 503, body: { error: { code: "ee_busy", message, retryable: true } } };
  // Never echo messages that may carry configuration secrets; the full error is still logged server-side.
  const safeMessage = SECRETISH.test(message) ? "Internal error" : message;
  return { status: 500, body: { error: { code: "internal", message: safeMessage, retryable: false } } };
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
