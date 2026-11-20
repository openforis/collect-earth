const { RateLimited } = require("./errors");

/**
 * Fixed one-minute windows in this instance's memory: `take(address)` counts one computation for the address and
 * throws RateLimited past `limit` in its window. Expired windows are dropped once a window, so the map stays small.
 */
function createRateLimit({ limit = 600, windowMs = 60_000, now = Date.now } = {}) {
  const windows = new Map();
  let swept = now();
  function take(address) {
    const t = now();
    if (t - swept >= windowMs) {
      for (const [a, w] of windows) if (t - w.start >= windowMs) windows.delete(a);
      swept = t;
    }
    const w = windows.get(address);
    if (!w || t - w.start >= windowMs) windows.set(address, { start: t, count: 1 });
    else if (w.count >= limit) throw new RateLimited("too many computations from this address; try again in a minute");
    else w.count++;
  }
  return { take, size: () => windows.size };
}

/**
 * The client's address: Google's front end appends it as the last X-Forwarded-For entry (the earlier ones are
 * whatever the client sent), else the socket's peer.
 */
function clientAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const last = typeof forwarded === "string" ? forwarded.split(",").pop().trim() : "";
  return last || (req.socket && req.socket.remoteAddress) || "unknown";
}

module.exports = { createRateLimit, clientAddress };
