/** Request errors carrying the {status, code} shape errorToResponse passes through unchanged. */

class BadRequest extends Error {
  constructor(message) { super(message); this.status = 400; this.code = "bad_request"; }
}

class NotFound extends Error {
  constructor(message) { super(message); this.status = 404; this.code = "not_found"; }
}

/** Throws NotFound(message) unless `size` (an evaluated collection size) is a positive number; returns it otherwise. */
function notFoundIfEmpty(size, message) {
  if (!(size > 0)) throw new NotFound(message);
  return size;
}

module.exports = { BadRequest, NotFound, notFoundIfEmpty };
