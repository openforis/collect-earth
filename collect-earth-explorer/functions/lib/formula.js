const { BadRequest } = require("./errors");

const MAX_LENGTH = 200;
/** Functions Earth Engine's Image.expression understands with these names and arities (checked live). */
const FUNCTIONS = ["sqrt", "abs", "min", "max", "pow"];
/** One token at a time: whitespace, a decimal number, a name, or one operator or punctuation character. */
const TOKEN = /\s+|(\d+(?:\.\d*)?|\.\d+)|([A-Za-z_]\w*)|([-+*/(),])/y;

/**
 * The safety boundary for custom index formulas: returns `text` unchanged when it holds only decimal numbers,
 * the names in `bands`, + - * /, parentheses, commas and FUNCTIONS followed by "(", with balanced parentheses
 * and at least one band. Throws BadRequest naming the offending token otherwise. Also rejects cheap-to-spot
 * malformed sequences (operators in a row except unary minus, adjacent operands, empty parentheses); it is not
 * a parser, Earth Engine reports the rest. Nothing here evaluates the text.
 */
function checkFormula(text, bands) {
  if (typeof text !== "string") throw new BadRequest("formula must be text");
  if (text.length > MAX_LENGTH) throw new BadRequest(`formula must be at most ${MAX_LENGTH} characters`);
  if (text.trim() === "") throw new BadRequest("formula is empty");
  // prev: what came last. "operand" (number, band, ")") may be followed by an operator, "," or ")"; a function
  // name must be followed by "("; everything else ("start", "operator", "(", ",") expects an operand, "(", a
  // function or a unary minus.
  let prev = "start", depth = 0, usesBand = false, pos = 0;
  const fail = (token, why) => { throw new BadRequest(`formula: unexpected "${token}" at character ${pos + 1}${why ? ` (${why})` : ""}`); };
  while (pos < text.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(text);
    if (!m) fail(text[pos], "allowed: numbers, bands, + - * / ( ) , and " + FUNCTIONS.join(", "));
    const [token, number, name, symbol] = m;
    const afterOperand = prev === "operand";
    if (number === undefined && name === undefined && symbol === undefined) {
      // whitespace
    } else if (FUNCTIONS.includes(prev) && symbol !== "(") {
      fail(token, `${prev} needs "("`);
    } else if (number !== undefined || name !== undefined) {
      if (FUNCTIONS.includes(name)) {
        if (afterOperand) fail(token, "missing operator");
        prev = name;
      } else {
        if (name !== undefined && !bands.includes(name)) fail(token, `unknown name; bands: ${bands.join(", ")}`);
        if (afterOperand) fail(token, "missing operator");
        if (name !== undefined) usesBand = true;
        prev = "operand";
      }
    } else if (symbol === "(") {
      if (afterOperand) fail(token, "missing operator");
      depth++;
      prev = "(";
    } else if (symbol === ")") {
      if (!afterOperand) fail(token, prev === "(" ? "empty parentheses" : "missing operand");
      if (--depth < 0) fail(token, "unbalanced parentheses");
      prev = "operand";
    } else if (symbol === ",") {
      if (!afterOperand || depth === 0) fail(token);
      prev = ",";
    } else {
      if (!afterOperand && symbol !== "-") fail(token, "missing operand");
      prev = "operator";
    }
    pos = TOKEN.lastIndex;
  }
  if (FUNCTIONS.includes(prev)) throw new BadRequest(`formula: ${prev} needs "("`);
  if (depth !== 0) throw new BadRequest("formula: unbalanced parentheses");
  if (prev !== "operand") throw new BadRequest("formula: unexpected end (missing operand)");
  if (!usesBand) throw new BadRequest(`formula uses no band; bands: ${bands.join(", ")}`);
  return text;
}

/** The formula without any whitespace: spacing differences share one cache entry. */
function normaliseFormula(text) {
  return text.replace(/\s+/g, "");
}

module.exports = { checkFormula, normaliseFormula, MAX_LENGTH, FUNCTIONS };
