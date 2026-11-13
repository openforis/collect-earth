const LOCAL_ORIGINS = ["http://localhost:5000", "http://localhost:5173", "http://127.0.0.1:5000", "http://127.0.0.1:5173"];

/**
 * Origins allowed to call the API cross-origin (the web app calls the function URL directly in
 * production, bypassing Hosting and its 60 s proxy limit). `ALLOWED_ORIGINS` (comma-separated)
 * replaces the defaults when set; otherwise the project's Hosting hosts (from `GCLOUD_PROJECT`)
 * plus the local Hosting emulator and Vite dev server origins are allowed.
 */
function allowedOrigins(env = process.env) {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const project = env.GCLOUD_PROJECT;
  const hosting = project ? [`https://${project}.web.app`, `https://${project}.firebaseapp.com`] : [];
  return [...hosting, ...LOCAL_ORIGINS];
}

/** Whether a request `Origin` header value is on the allowlist (exact match; no origin is never allowed). */
function corsOriginAllowed(origin, env = process.env) {
  return typeof origin === "string" && origin !== "" && allowedOrigins(env).includes(origin);
}

module.exports = { corsOriginAllowed, allowedOrigins, LOCAL_ORIGINS };
