// Collect's expression language, read as Collect reads it, to check a survey's expressions on the server
// (docs/plans/2026-11-18-survey-designer.md, "Checking the survey"). Collect parses an expression with JXPath (XPath 1.0)
// after writing `parent()` as a step `__parent` (Path.getNormalizedPath), then checks its functions against its own
// libraries and resolves every path it names in the schema (ExpressionValidator). This file parses; check.ts resolves.
// Parsing only: nothing here evaluates an expression.
//
// test/expressionCheck.test.ts holds it to Collect's own verdicts on a corpus (the desktop's ExpressionVerdictsTest).

export type Expr =
  | { type: 'binary'; op: BinaryOp; left: Expr; right: Expr }
  | { type: 'negate'; arg: Expr }
  | { type: 'call'; prefix: string | null; name: string; args: Expr[]; core: boolean }
  | { type: 'literal'; value: string }
  | { type: 'number'; value: number }
  | { type: 'variable'; name: string }
  /** A location path: `a/b[c]`, `/plot/x`, `..`, `@code` */
  | { type: 'path'; absolute: boolean; steps: Step[] }
  /** A filter expression: a primary (a variable, a call, a bracketed expression) with predicates and steps after it */
  | { type: 'filter'; primary: Expr; predicates: Expr[]; steps: Step[] };

export type BinaryOp = 'or' | 'and' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | 'div' | 'mod' | '|';

export interface Step {
  axis: string;
  /** A name (with its prefix), `*`, or a node type test such as `node()` */
  test: string;
  predicates: Expr[];
}

export class ExpressionSyntaxError extends Error {}

/**
 * JXPath's core functions (its XPathParser): compiled as its own, never looked up in Collect's libraries, so Collect
 * does not check them
 */
export const CORE_FUNCTIONS = new Set([
  'last', 'position', 'count', 'id', 'local-name', 'namespace-uri', 'name', 'string', 'concat', 'starts-with', 'ends-with',
  'contains', 'substring-before', 'substring-after', 'substring', 'string-length', 'normalize-space', 'translate', 'boolean',
  'not', 'true', 'false', 'null', 'lang', 'number', 'sum', 'floor', 'ceiling', 'round', 'format-number', 'key',
]);

/** The number of arguments of each core function (XPath 1.0, JXPath): checked here though Collect does not, as a wrong one fails when the form evaluates it */
export const CORE_ARITY: Record<string, [number, number]> = {
  last: [0, 0], position: [0, 0], count: [1, 1], id: [1, 1], 'local-name': [0, 1], 'namespace-uri': [0, 1], name: [0, 1],
  string: [0, 1], concat: [2, Infinity], 'starts-with': [2, 2], 'ends-with': [2, 2], contains: [2, 2],
  'substring-before': [2, 2], 'substring-after': [2, 2], substring: [2, 3], 'string-length': [0, 1],
  'normalize-space': [0, 1], translate: [3, 3], boolean: [1, 1], not: [1, 1], true: [0, 0], false: [0, 0], null: [0, 0],
  lang: [1, 1], number: [0, 1], sum: [1, 1], floor: [1, 1], ceiling: [1, 1], round: [1, 1], 'format-number': [2, 3], key: [2, 2],
};

/** The unprefixed names Collect accepts beyond JXPath's own (ExpressionFactory.CORE_FUNCTION_NAMES) */
const COLLECT_CORE_NAMES = new Set([
  'boolean', 'not', 'true', 'false', 'number', 'round', 'floor', 'ceiling', 'format-number', 'string', 'concat', 'substring',
  'string-length', 'normalize-space', 'contains', 'starts-with', 'ends-with', 'count', 'sum', 'position', 'last',
]);

/** Collect's function libraries (IDMFunctions, MathFunctions...): the numbers of arguments each takes; null: any */
export const COLLECT_FUNCTIONS: Record<string, Record<string, number[] | null>> = {
  idm: {
    array: null, blank: [1], 'not-blank': [1], index: [0, 1], position: [0, 1], 'distinct-values': [1], 'count-distinct': [1],
    contains: [2], currentDate: [0], currentTime: [0], lookup: [4, 6, 8, 10], samplingPointCoordinate: [1, 2, 3],
    samplingPointData: [1, 2, 3, 4], speciesListData: [3], 'datetime-diff': [4, 5], distance: [2], latlong: [1],
  },
  math: {
    abs: [1], acos: [1], asin: [1], atan: [1], avg: [1], cos: [1], cosrad: [1], deg: [1], log: [1], log10: [1], max: [1],
    min: [1], PI: [0], pow: [2], rad: [1], random: [0], sin: [1], sinrad: [1], sum: [1], sqrt: [1], tan: [1], tanrad: [1],
  },
  geo: { polygon: [1], distance: [2], latlong: [1] },
  util: { uuid: [0] },
  env: { desktop: [0], mobile: [0] },
  regex: { test: [2, 3] },
};

/** Paths a Collect function names by itself, whatever its arguments (idm:position() is the position of `.`) */
export const FUNCTION_PATHS: Record<string, string[]> = { 'idm:position/0': ['.'] };

/** Whether Collect knows a function (ExpressionFactory.isValidFunction) */
export function isCollectFunction(prefix: string | null, name: string): boolean {
  if (!prefix) return COLLECT_CORE_NAMES.has(name);
  return !!COLLECT_FUNCTIONS[prefix] && name in COLLECT_FUNCTIONS[prefix];
}

// ---------------------------------------------------------------------------------------------------------------
// Tokens (XPath 1.0, section 3.7)

type Token =
  | { kind: 'literal'; value: string; at: number }
  | { kind: 'number'; value: number; at: number }
  | { kind: 'name'; value: string; at: number } // NCName, QName, prefix:*, *
  | { kind: 'variable'; value: string; at: number }
  | { kind: 'op'; value: string; at: number } // operators and punctuation
  | { kind: 'end'; at: number };

const NAME_START = /[A-Za-z_À-￿]/;
const NAME_CHAR = /[A-Za-z0-9_.\-·À-￿]/;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const precedingAllowsOperator = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return false;
    if (prev.kind === 'op') return [')', ']', '.', '..'].includes(prev.value);
    return true; // a name, literal, number or variable
  };
  const readName = (): string => {
    const start = i;
    while (i < text.length && NAME_CHAR.test(text[i])) i++;
    return text.slice(start, i);
  };
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) throw new ExpressionSyntaxError(`A text in quotes is not closed (at ${at + 1}).`);
      tokens.push({ kind: 'literal', value: text.slice(i + 1, end), at });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      const m = /^(\d+(\.\d*)?|\.\d+)/.exec(text.slice(i))!;
      tokens.push({ kind: 'number', value: Number(m[0]), at });
      i += m[0].length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['//', '!=', '<=', '>=', '::', '..'].includes(two)) {
      tokens.push({ kind: 'op', value: two, at });
      i += 2;
      continue;
    }
    if ('/|+-=<>()[].@,'.includes(c)) {
      tokens.push({ kind: 'op', value: c, at });
      i++;
      continue;
    }
    if (c === '*') {
      // Multiplication after an operand, else the name test "any"
      tokens.push(precedingAllowsOperator() ? { kind: 'op', value: '*', at } : { kind: 'name', value: '*', at });
      i++;
      continue;
    }
    if (c === '$') {
      i++;
      if (!NAME_START.test(text[i] ?? '')) throw new ExpressionSyntaxError(`A $ is not followed by a name (at ${at + 1}).`);
      let name = readName();
      if (text[i] === ':' && NAME_START.test(text[i + 1] ?? '')) {
        i++;
        name += ':' + readName();
      }
      tokens.push({ kind: 'variable', value: name, at });
      continue;
    }
    if (NAME_START.test(c)) {
      let name = readName();
      // An operator name where an operator is expected (and, or, div, mod)
      if (precedingAllowsOperator() && ['and', 'or', 'div', 'mod'].includes(name)) {
        tokens.push({ kind: 'op', value: name, at });
        continue;
      }
      if (text[i] === ':' && text[i + 1] !== ':') {
        if (text[i + 1] === '*') {
          name += ':*';
          i += 2;
        } else if (NAME_START.test(text[i + 1] ?? '')) {
          i++;
          name += ':' + readName();
        }
      }
      tokens.push({ kind: 'name', value: name, at });
      continue;
    }
    throw new ExpressionSyntaxError(`"${c}" is not expected here (at ${at + 1}).`);
  }
  tokens.push({ kind: 'end', at: text.length });
  return tokens;
}

// ---------------------------------------------------------------------------------------------------------------
// The grammar (XPath 1.0, section 3)

const NODE_TYPES = new Set(['comment', 'text', 'processing-instruction', 'node']);
const AXES = new Set([
  'ancestor', 'ancestor-or-self', 'attribute', 'child', 'descendant', 'descendant-or-self', 'following', 'following-sibling',
  'namespace', 'parent', 'preceding', 'preceding-sibling', 'self',
]);

/** The deepest nesting read (brackets, calls, minus signs): deeper is refused, not a stack overflow */
const MAX_DEPTH = 100;

class Parser {
  private i = 0;
  private depth = 0;

  /** Reads one nested part, refusing one nested too deep */
  private nested<T>(read: () => T): T {
    if (++this.depth > MAX_DEPTH) throw this.error(`The expression is nested more than ${MAX_DEPTH} deep`);
    try {
      return read();
    } finally {
      this.depth--;
    }
  }
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }
  private isOp(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === 'op' && t.value === value;
  }
  private take(): Token {
    return this.tokens[this.i++];
  }
  private expect(value: string): void {
    if (!this.isOp(value)) throw this.error(`"${value}" is missing`);
    this.i++;
  }
  private error(what: string): ExpressionSyntaxError {
    const t = this.peek();
    const here = t.kind === 'end' ? 'at the end' : `at ${t.at + 1}`;
    return new ExpressionSyntaxError(`${what} (${here}).`);
  }

  parse(): Expr {
    if (this.peek().kind === 'end') throw this.error('The expression is empty');
    const e = this.orExpr();
    if (this.peek().kind !== 'end') throw this.error('Something follows the end of the expression');
    return e;
  }

  private binary(next: () => Expr, ops: BinaryOp[]): Expr {
    let left = next();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op' || !(ops as string[]).includes(t.value)) return left;
      this.i++;
      left = { type: 'binary', op: t.value as BinaryOp, left, right: next() };
    }
  }
  private orExpr = (): Expr => this.nested(() => this.binary(this.andExpr, ['or']));
  private andExpr = (): Expr => this.binary(this.equalityExpr, ['and']);
  private equalityExpr = (): Expr => this.binary(this.relationalExpr, ['=', '!=']);
  private relationalExpr = (): Expr => this.binary(this.additiveExpr, ['<', '<=', '>', '>=']);
  private additiveExpr = (): Expr => this.binary(this.multiplicativeExpr, ['+', '-']);
  private multiplicativeExpr = (): Expr => this.binary(this.unaryExpr, ['*', 'div', 'mod']);
  private unaryExpr = (): Expr => {
    if (this.isOp('-')) {
      this.i++;
      return { type: 'negate', arg: this.nested(() => this.unaryExpr()) };
    }
    return this.unionExpr();
  };
  private unionExpr = (): Expr => this.binary(this.pathExpr, ['|']);

  /** PathExpr: a location path, or a filter expression with steps after it */
  private pathExpr = (): Expr => {
    const t = this.peek();
    const isPrimary =
      t.kind === 'variable' ||
      t.kind === 'literal' ||
      t.kind === 'number' ||
      this.isOp('(') ||
      (t.kind === 'name' && this.isOp('(', 1) && !NODE_TYPES.has(t.value) && t.value !== '*');
    if (!isPrimary) return this.locationPath();
    const primary = this.primary();
    const predicates = this.predicates();
    const steps: Step[] = [];
    if (this.isOp('/') || this.isOp('//')) {
      this.relativePath(steps, true);
    }
    if (predicates.length === 0 && steps.length === 0) return primary;
    return { type: 'filter', primary, predicates, steps };
  };

  private primary(): Expr {
    const t = this.take();
    if (t.kind === 'variable') return { type: 'variable', name: t.value };
    if (t.kind === 'literal') return { type: 'literal', value: t.value };
    if (t.kind === 'number') return { type: 'number', value: t.value };
    if (t.kind === 'op' && t.value === '(') {
      const e = this.orExpr();
      this.expect(')');
      return e;
    }
    if (t.kind === 'name') {
      this.expect('(');
      const args: Expr[] = [];
      if (!this.isOp(')')) {
        args.push(this.orExpr());
        while (this.isOp(',')) {
          this.i++;
          args.push(this.orExpr());
        }
      }
      this.expect(')');
      const colon = t.value.indexOf(':');
      const prefix = colon >= 0 ? t.value.slice(0, colon) : null;
      const name = colon >= 0 ? t.value.slice(colon + 1) : t.value;
      return { type: 'call', prefix, name, args, core: prefix === null && CORE_FUNCTIONS.has(name) };
    }
    this.i--;
    throw this.error('An expression is expected');
  }

  private predicates(): Expr[] {
    const list: Expr[] = [];
    while (this.isOp('[')) {
      this.i++;
      list.push(this.orExpr());
      this.expect(']');
    }
    return list;
  }

  private locationPath(): Expr {
    const steps: Step[] = [];
    if (this.isOp('/')) {
      this.i++;
      // "/" alone is the root; else a relative path follows
      if (this.startsStep()) this.relativePath(steps, false);
      return { type: 'path', absolute: true, steps };
    }
    if (this.isOp('//')) {
      this.i++;
      steps.push({ axis: 'descendant-or-self', test: 'node()', predicates: [] });
      this.relativePath(steps, false);
      return { type: 'path', absolute: true, steps };
    }
    if (!this.startsStep()) throw this.error('An expression is expected');
    this.relativePath(steps, false);
    return { type: 'path', absolute: false, steps };
  }

  private startsStep(): boolean {
    const t = this.peek();
    return t.kind === 'name' || this.isOp('.') || this.isOp('..') || this.isOp('@');
  }

  /** Steps separated by / or //; `leading`: a separator comes first */
  private relativePath(steps: Step[], leading: boolean): void {
    if (!leading) steps.push(this.step());
    while (this.isOp('/') || this.isOp('//')) {
      const separator = this.take();
      if (separator.kind === 'op' && separator.value === '//') steps.push({ axis: 'descendant-or-self', test: 'node()', predicates: [] });
      steps.push(this.step());
    }
  }

  private step(): Step {
    if (this.isOp('.')) {
      this.i++;
      return { axis: 'self', test: 'node()', predicates: [] };
    }
    if (this.isOp('..')) {
      this.i++;
      return { axis: 'parent', test: 'node()', predicates: [] };
    }
    let axis = 'child';
    if (this.isOp('@')) {
      this.i++;
      axis = 'attribute';
    } else if (this.peek().kind === 'name' && this.isOp('::', 1)) {
      const named = this.take();
      axis = named.kind === 'name' ? named.value : '';
      if (!AXES.has(axis)) throw this.error(`"${axis}" is not an axis`);
      this.i++;
    }
    const t = this.peek();
    if (t.kind !== 'name') throw this.error('A name is expected');
    this.i++;
    let test = t.value;
    if (NODE_TYPES.has(test) && this.isOp('(')) {
      this.i++;
      if (test === 'processing-instruction' && this.peek().kind === 'literal') this.i++;
      this.expect(')');
      test += '()';
    }
    return { axis, test, predicates: this.predicates() };
  }
}

/**
 * Collect's expression as JXPath compiles it: `parent()` written as the step `__parent` first, as Collect does
 * (Path.getNormalizedPath); throws ExpressionSyntaxError when it is not one.
 */
export function parseExpression(text: string): Expr {
  const normalized = text.replace(/\bparent\(\)/g, '__parent');
  return new Parser(tokenize(normalized)).parse();
}

// ---------------------------------------------------------------------------------------------------------------
// What an expression names, as Collect works it out (ReferencedPathEvaluator)

/** A step written as JXPath writes it, predicates left out (Path.getAbsolutePath takes them away) */
function stepText(step: Step): string {
  if (step.axis === 'self' && step.test === 'node()') return '.';
  if (step.axis === 'parent' && step.test === 'node()') return '..';
  if (step.axis === 'attribute') return '@' + step.test;
  if (step.axis === 'child') return step.test;
  return `${step.axis}::${step.test}`;
}

function primaryText(e: Expr): string {
  switch (e.type) {
    case 'variable':
      return '$' + e.name;
    case 'call':
      return `${e.prefix ? e.prefix + ':' : ''}${e.name}(…)`;
    default:
      return '(…)';
  }
}

/** The paths an expression names, each as Collect resolves it in the schema (`a/b`, `__parent/x`, `$this/@code`) */
export function referencedPaths(e: Expr): Set<string> {
  const out = new Set<string>();
  const ofSteps = (prefix: string, steps: Step[]) => {
    if (steps.length === 0) return;
    out.add(prefix + steps.map(stepText).join('/'));
    let base = '';
    for (const step of steps) {
      base += stepText(step) + '/';
      for (const p of step.predicates) {
        for (const path of referencedPaths(p)) out.add(path.startsWith('$this') || path.startsWith('$context') ? path : base + path);
      }
    }
  };
  const visit = (x: Expr): void => {
    switch (x.type) {
      case 'path':
        ofSteps(x.absolute ? '/' : '', x.steps);
        return;
      case 'filter': {
        // JXPath writes an expression path from its primary: "$this/@code"
        const head = primaryText(x.primary);
        if (x.steps.length > 0) {
          out.add(head + '/' + x.steps.map(stepText).join('/'));
          let base = head + '/';
          for (const step of x.steps) {
            base += stepText(step) + '/';
            for (const p of step.predicates) {
              for (const path of referencedPaths(p)) out.add(path.startsWith('$this') || path.startsWith('$context') ? path : base + path);
            }
          }
        }
        for (const p of x.predicates) for (const path of referencedPaths(p)) out.add(path);
        // The primary itself is not followed (as Collect does): a call's arguments in it are not paths of the expression
        return;
      }
      case 'binary':
        visit(x.left);
        visit(x.right);
        return;
      case 'negate':
        visit(x.arg);
        return;
      case 'call':
        if (!x.core && x.prefix) for (const p of FUNCTION_PATHS[`${x.prefix}:${x.name}/${x.args.length}`] ?? []) out.add(p);
        x.args.forEach(visit);
        return;
      default:
        return;
    }
  };
  visit(e);
  return out;
}

/** Every call of an expression with where it is: in the operations Collect checks, or inside a path's predicates */
export function calls(e: Expr): Array<{ call: Extract<Expr, { type: 'call' }>; inPredicate: boolean }> {
  const out: Array<{ call: Extract<Expr, { type: 'call' }>; inPredicate: boolean }> = [];
  const visit = (x: Expr, inPredicate: boolean): void => {
    switch (x.type) {
      case 'call':
        out.push({ call: x, inPredicate });
        x.args.forEach((a) => visit(a, inPredicate));
        return;
      case 'binary':
        visit(x.left, inPredicate);
        visit(x.right, inPredicate);
        return;
      case 'negate':
        visit(x.arg, inPredicate);
        return;
      case 'path':
        for (const s of x.steps) for (const p of s.predicates) visit(p, true);
        return;
      case 'filter':
        visit(x.primary, true);
        for (const p of x.predicates) visit(p, true);
        for (const s of x.steps) for (const p of s.predicates) visit(p, true);
        return;
      default:
        return;
    }
  };
  visit(e, false);
  return out;
}
