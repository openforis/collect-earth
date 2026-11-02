const express = require("express");
const { corsOriginAllowed } = require("./lib/cors");

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

/**
 * CORS for the web app calling the function URL directly (Hosting's proxy cuts requests off at
 * 60 s; CCDC and cold series runs can take longer). An allowed `Origin` is echoed back in
 * `Access-Control-Allow-Origin`; any other origin gets no CORS headers but the request is still
 * processed (same-origin calls through the Hosting rewrite carry no Origin at all). Preflight
 * OPTIONS requests are answered here with 204 and never reach the routes.
 */
function cors(env) {
  return (req, res, next) => {
    res.setHeader("Vary", "Origin");
    const origin = req.headers.origin;
    if (corsOriginAllowed(origin, env)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
      res.setHeader("Access-Control-Max-Age", "3600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Builds the Express app; `env` (default process.env) feeds the CORS allowlist and is injectable for tests. */
function createApp(registerRoutes, { env = process.env } = {}) {
  const app = express();
  app.use(cors(env));
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

module.exports = { createApp, asyncHandler, errorToResponse, cors };
