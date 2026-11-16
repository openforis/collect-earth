const catalogue = require("../catalogue.json");
const { BadRequest } = require("./errors");

/** True for a real calendar date written YYYY-MM-DD (rejects 2021-02-30, 2021-13-01). */
function isDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);
}

/**
 * Validates one parameter of a catalogue entry and returns it; `value` undefined returns the spec's default.
 * `kind` is "layers" or "charts". Only real JSON types are accepted (no numeric strings). Throws BadRequest.
 */
function paramOf(kind, type, name, value, { maxYear = new Date().getUTCFullYear() } = {}) {
  if (kind !== "layers" && kind !== "charts") throw new BadRequest(`unknown kind ${kind}: layers or charts`);
  const types = catalogue[kind];
  if (!Object.hasOwn(types, type)) throw new BadRequest(`unknown ${kind} type ${type}`);
  const params = types[type].params;
  if (!Object.hasOwn(params, name)) throw new BadRequest(`unknown parameter ${name} for ${type}`);
  const spec = params[name];
  if (value === undefined) return spec.default;
  const isYear = (y) => Number.isInteger(y) && y >= spec.min && y <= maxYear;
  let ok, allowed;
  switch (spec.type) {
    case "choice": ok = spec.values.includes(value); allowed = `one of ${spec.values.join(", ")}`; break;
    case "int": ok = Number.isInteger(value) && value >= spec.min && value <= spec.max; allowed = `an integer from ${spec.min} to ${spec.max}`; break;
    case "date": ok = isDate(value); allowed = "a date YYYY-MM-DD"; break;
    case "year": ok = isYear(value); allowed = `a year from ${spec.min} to ${maxYear}`; break;
    case "yearRange":
      ok = Array.isArray(value) && value.length === 2 && value.every(isYear) && value[0] <= value[1];
      allowed = `[from, to] years from ${spec.min} to ${maxYear}, from <= to`;
      break;
    case "bool": ok = value === true || value === false; allowed = "true or false"; break;
    case "text": ok = typeof value === "string" && value.length <= spec.max && !/[<>]/.test(value); allowed = `text of at most ${spec.max} characters, without < or >`; break;
    // Only the form here; the route checks the content with lib/formula.js against the sensor's bands.
    case "formula": ok = typeof value === "string" && value.length <= spec.max; allowed = `a formula of at most ${spec.max} characters`; break;
    default: throw new BadRequest(`unknown parameter type ${spec.type} for ${name}`);
  }
  if (!ok) throw new BadRequest(`${name} must be ${allowed}`);
  return value;
}

module.exports = { catalogue, paramOf };
