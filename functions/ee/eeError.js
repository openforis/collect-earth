/**
 * Normalises whatever the Earth Engine client hands an error callback into an Error.
 * EE reports strings, plain objects with a `message`, and occasionally bare objects.
 */
function toError(e) {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  return new Error(e && e.message ? e.message : JSON.stringify(e));
}

module.exports = { toError };
