// The survey check (docs/plans/2026-11-18-survey-designer.md, "Checking the survey"): what Collect and Collect Earth
// would refuse in a survey, found on the server before it is saved, as Collect has no part in the cloud.
// - every expression of the survey, as Collect's ExpressionValidator checks it (expression.ts parses), and a little
//   more where Collect lets through what then fails in the form: marked `beyondCollect`;
// - Collect Earth's survey rules (CollectEarthSurveyValidator, and Collect's SurveyValidator on names and keys).
// test/expressionCheck.test.ts holds the expressions' verdicts to Collect's own on a corpus.

import {
  calls,
  CORE_ARITY,
  COLLECT_FUNCTIONS,
  ExpressionSyntaxError,
  isCollectFunction,
  parseExpression,
  referencedPaths,
  type Expr,
} from './expression.js';
import type { SurveyCheckCode, SurveyProblem } from '../wire/survey.js';
import { attrValue, childElements, childrenNamed, firstChild, readXml, textValue, type XmlDocument, type XmlElement } from './xmlTree.js';

const ATTRIBUTE_TAGS = new Set(['text', 'number', 'range', 'code', 'boolean', 'date', 'time', 'coordinate', 'taxon', 'file']);

/** The fields of each kind of attribute, which `@field` names (Collect's *AttributeDefinition) */
const FIELDS: Record<string, string[]> = {
  text: ['value'],
  number: ['value', 'unit_name', 'unit'],
  range: ['from', 'to', 'unit_name', 'unit'],
  code: ['code', 'qualifier'],
  boolean: ['value'],
  date: ['year', 'month', 'day'],
  time: ['hour', 'minute'],
  coordinate: ['x', 'y', 'srs', 'altitude', 'accuracy'],
  taxon: ['code', 'scientific_name', 'vernacular_name', 'language_code', 'language_variety', 'family_code', 'family_scientific_name'],
  file: ['file_name', 'file_size'],
};

/** A node of the survey's schema */
export interface SchemaNode {
  name: string;
  /** entity, or the attribute's element name */
  kind: string;
  parent: SchemaNode | null;
  children: SchemaNode[];
  element: XmlElement;
}

export function schemaOf(doc: XmlDocument): SchemaNode {
  const schema = firstChild(doc.root, 'schema');
  const plot = schema && childrenNamed(schema, 'entity')[0];
  if (!plot) throw new Error('The survey has no plot.');
  const build = (e: XmlElement, parent: SchemaNode | null): SchemaNode => {
    const node: SchemaNode = { name: attrValue(doc, e, 'name') ?? '', kind: e.name === 'entity' ? 'entity' : e.name, parent, children: [], element: e };
    for (const c of childElements(e)) {
      if (c.name === 'entity' || ATTRIBUTE_TAGS.has(c.name)) node.children.push(build(c, node));
    }
    return node;
  };
  return build(plot, null);
}

/** A node by its path of names from the plot ("plot/land_use/lu") */
export function nodeAt(root: SchemaNode, path: string): SchemaNode | undefined {
  const names = path.split('/');
  if (names[0] !== root.name) return undefined;
  let at: SchemaNode | undefined = root;
  for (const n of names.slice(1)) at = at?.children.find((c) => c.name === n);
  return at;
}

export const pathOf = (n: SchemaNode): string => (n.parent ? `${pathOf(n.parent)}/${n.name}` : n.name);

/** What an expression is: a condition (yes/no), a value, or a path to a node (a code list's parent) */
export type ExpressionKind = 'boolean' | 'value' | 'path';

/** What is wrong, as a code and its values (the dashboard words them in each language; problemText in English) */
export type ProblemCode = SurveyCheckCode;
export interface Problem {
  code: ProblemCode;
  values: Record<string, string>;
}

export type ExpressionVerdict = { ok: true } | ({ ok: false; message: string; beyondCollect: boolean } & Problem);

const ok: ExpressionVerdict = { ok: true };
const refused = (code: ProblemCode, values: Record<string, string> = {}, beyondCollect = false): ExpressionVerdict => ({
  ok: false,
  code,
  values,
  message: problemText({ code, values }),
  beyondCollect,
});

/** A problem in English, for the logs and the tests */
export function problemText(p: Problem): string {
  const v = p.values;
  switch (p.code) {
    case 'syntax': return `The expression cannot be read: ${v.detail}`;
    case 'unknownFunction': return `There is no function ${v.name}.`;
    case 'argumentCount': return `${v.name} takes ${v.expected} arguments, not ${v.found}.`;
    case 'unknownQuestion': return `There is no question ${v.name} in ${v.in}.`;
    case 'unknownField': return `${v.on} has no field ${v.field}.`;
    case 'insideField': return `Nothing is inside ${v.on}.`;
    case 'insideQuestion': return `${v.on} is a question, with no ${v.name} inside.`;
    case 'aboveThePlot': return 'parent() goes above the plot.';
    case 'unknownVariable': return `There is no variable $${v.name}: only $this and $context.`;
    case 'noPlot': return 'The survey has no plot.';
    case 'rootName': return `The survey's root is ${v.name}: Collect Earth needs plot.`;
    case 'missingField': return `Collect Earth needs the field ${v.name}.`;
    case 'fieldKind': return `${v.name} must be a ${v.expected} field for Collect Earth, not ${v.found}.`;
    case 'noKey': return 'The plot has no key.';
    case 'tooManyKeys': return `The plot has ${v.count} keys: at most 3.`;
    case 'listTwice': return `Two lists are named ${v.name}.`;
    case 'codeTwice': return `The list ${v.list} has the code ${v.code} twice.`;
    case 'questionTwice': return `Two questions are named ${v.name} in ${v.in}.`;
    case 'badName': return `${v.name}: a name has lower case letters, digits and _ only, and starts with a letter.`;
    case 'nameSuffix': return `${v.name}: Collect Earth cannot use a name ending in _ or _ and digits.`;
    case 'longName': return `${v.name}: the name, with those of its tables, is longer than ${v.max} characters.`;
    case 'nestedTable': return 'Collect Earth cannot have a table inside a table.';
    case 'unknownList': return `The list ${v.name} does not exist.`;
  }
}

/**
 * An expression of `node` (its relevance, a rule, a formula...), checked as Collect checks it: parsed, its functions
 * known with their numbers of arguments, every path it names found in the schema, from the node's parent (`$this` the
 * node itself). Then what Collect lets through but the form cannot evaluate: functions inside a path's brackets, the
 * core functions' numbers of arguments, variables other than $this and $context.
 */
export function checkExpression(node: SchemaNode, kind: ExpressionKind, text: string): ExpressionVerdict {
  let expr: Expr;
  try {
    expr = parseExpression(text);
  } catch (e) {
    if (e instanceof ExpressionSyntaxError) return refused('syntax', { detail: e.message });
    throw e;
  }
  const context = node.parent ?? node;
  // Collect's functions, in the operations it walks (not inside a path's brackets)
  const found = calls(expr);
  // A path (a list's parent question) is resolved only: Collect checks no function in it (validateSchemaPathExpression)
  for (const { call, inPredicate } of kind === 'path' ? [] : found) {
    if (inPredicate || call.core) continue;
    const full = call.prefix ? `${call.prefix}:${call.name}` : call.name;
    if (!isCollectFunction(call.prefix, call.name)) return refused('unknownFunction', { name: full });
    if (call.prefix) {
      const counts = COLLECT_FUNCTIONS[call.prefix][call.name];
      if (counts && !counts.includes(call.args.length)) {
        return refused('argumentCount', { name: full, expected: counts.join(' / '), found: String(call.args.length) });
      }
    }
  }
  for (const p of referencedPaths(expr)) {
    const problem = resolve(context, node, p);
    if (problem) return refused(problem.code, problem.values);
  }
  // Beyond Collect's check: what then fails when the form evaluates it
  for (const { call, inPredicate } of found) {
    const full = call.prefix ? `${call.prefix}:${call.name}` : call.name;
    if (inPredicate && !call.core && !isCollectFunction(call.prefix, call.name)) return refused('unknownFunction', { name: full }, true);
    if (inPredicate && call.prefix) {
      const counts = COLLECT_FUNCTIONS[call.prefix]?.[call.name];
      if (counts && !counts.includes(call.args.length)) {
        return refused('argumentCount', { name: full, expected: counts.join(' / '), found: String(call.args.length) }, true);
      }
    }
    if (call.core) {
      const [min, max] = CORE_ARITY[call.name];
      if (call.args.length < min || call.args.length > max) {
        const expected = min === max ? `${min}` : max === Infinity ? `${min}+` : `${min}–${max}`;
        return refused('argumentCount', { name: call.name, expected, found: String(call.args.length) }, true);
      }
    }
  }
  const variables = new Set<string>();
  const visitVars = (x: Expr): void => {
    if (x.type === 'variable') variables.add(x.name);
    else if (x.type === 'binary') {
      visitVars(x.left);
      visitVars(x.right);
    } else if (x.type === 'negate') visitVars(x.arg);
    else if (x.type === 'call') x.args.forEach(visitVars);
    else if (x.type === 'filter') {
      visitVars(x.primary);
      x.predicates.forEach(visitVars);
      x.steps.forEach((s) => s.predicates.forEach(visitVars));
    } else if (x.type === 'path') x.steps.forEach((s) => s.predicates.forEach(visitVars));
  };
  visitVars(expr);
  for (const v of variables) if (v !== 'this' && v !== 'context') return refused('unknownVariable', { name: v }, true);
  return ok;
}

/** A path Collect resolves from the context node (AbstractExpression.getReferencedNodeDefinition); its problem, if any */
function resolve(context: SchemaNode, thisNode: SchemaNode, path: string): Problem | null {
  const sections = path.split('/').filter((s) => s !== '');
  let at = context;
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (at.kind !== 'entity' && section.startsWith('@')) {
      if (i < sections.length - 1) return { code: 'insideField', values: { on: `${pathOf(at)}/${section}` } };
      const field = section.slice(1);
      return FIELDS[at.kind]?.includes(field) ? null : { code: 'unknownField', values: { on: pathOf(at), field } };
    }
    if (section === '__parent') {
      if (!at.parent) return { code: 'aboveThePlot', values: {} };
      at = at.parent;
    } else if (section === 'this()' || section === '.' || section === '$this') {
      at = thisNode;
    } else if (section === '$context') {
      at = context;
    } else {
      const name = section.replace(/\[.+]/, '');
      if (at.kind !== 'entity') return { code: 'insideQuestion', values: { on: pathOf(at), name } };
      const child = at.children.find((c) => c.name === name);
      if (!child) return { code: 'unknownQuestion', values: { name, in: pathOf(at) } };
      at = child;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The whole survey

/** Where an expression is in a node, as SurveyValidator checks them */
export interface NodeExpression {
  where: 'relevant' | 'requiredIf' | 'minCount' | 'maxCount' | 'defaultIf' | 'defaultExpr' | 'checkIf' | 'checkExpr' | 'compare' | 'parent' | 'distance';
  kind: ExpressionKind;
  text: string;
}

/** The expressions of a node, as Collect validates them (SurveyValidator.validateExpressions), and requiredIf */
export function expressionsOf(doc: XmlDocument, node: SchemaNode): NodeExpression[] {
  const e = node.element;
  const out: NodeExpression[] = [];
  const add = (where: NodeExpression['where'], kind: ExpressionKind, text: string | undefined) => {
    if (text !== undefined && text.trim() !== '') out.push({ where, kind, text });
  };
  add('minCount', 'value', attrValue(doc, e, 'minCount'));
  add('maxCount', 'value', attrValue(doc, e, 'maxCount'));
  add('relevant', 'boolean', attrValue(doc, e, 'relevant'));
  // Not checked by Collect's SurveyValidator, but evaluated by the form all the same
  add('requiredIf', 'boolean', attrValue(doc, e, 'requiredIf'));
  if (node.kind === 'code') add('parent', 'path', attrValue(doc, e, 'parent'));
  for (const d of childrenNamed(e, 'default')) {
    add('defaultIf', 'boolean', attrValue(doc, d, 'if'));
    add('defaultExpr', 'value', attrValue(doc, d, 'expr'));
  }
  for (const c of childElements(e)) {
    if (!['check', 'compare', 'distance', 'pattern', 'unique'].includes(c.name)) continue;
    add('checkIf', 'boolean', attrValue(doc, c, 'if'));
    if (c.name === 'check') add('checkExpr', 'boolean', attrValue(doc, c, 'expr'));
    if (c.name === 'compare') add('compare', 'boolean', comparisonExpression(doc, c));
    if (c.name === 'distance') for (const a of ['from', 'to', 'min', 'max']) add('distance', 'value', attrValue(doc, c, a));
  }
  return out;
}

/** A compare check as one condition, as Collect builds it (ComparisonCheck.buildExpression) */
export function comparisonExpression(doc: XmlDocument, c: XmlElement): string {
  const parts: string[] = [];
  for (const [attr, op] of [['gt', '>'], ['gte', '>='], ['lt', '<'], ['lte', '<='], ['eq', '=']] as const) {
    const v = attrValue(doc, c, attr);
    if (v !== undefined && v.trim() !== '') parts.push(`$this ${op} ${v}`);
  }
  return parts.join(' and ');
}

export type { SurveyProblem } from '../wire/survey.js';

/** The fields Collect Earth needs, with their kinds (CollectEarthSurveyValidator.REQUIRED_FIELDS) */
const REQUIRED_FIELDS: Array<[string, string]> = [
  ['id', 'text'],
  ['operator', 'text'],
  ['location', 'coordinate'],
  ['plot_file', 'text'],
  ['actively_saved', 'boolean'],
  ['actively_saved_on', 'date'],
];
const NAME = /^[a-z][a-z0-9_]*$/;
const MAX_NAME = 63;

/** Everything Collect or Collect Earth would refuse in a survey: none, and the survey opens */
export function checkSurvey(bytes: Uint8Array): SurveyProblem[] {
  const doc = readXml(bytes);
  const problems: SurveyProblem[] = [];
  const problem = (node: SchemaNode | null, code: ProblemCode, values: Record<string, string> = {}, expression: string | null = null, beyondCollect = false) =>
    problems.push({ node: node ? pathOf(node) : null, code, values, expression, beyondCollect });
  let root: SchemaNode;
  try {
    root = schemaOf(doc);
  } catch {
    problem(null, 'noPlot');
    return problems;
  }
  if (root.name !== 'plot') problem(root, 'rootName', { name: root.name });
  for (const [name, kind] of REQUIRED_FIELDS) {
    const field = root.children.find((c) => c.name === name);
    if (!field) problem(root, 'missingField', { name });
    else if (field.kind !== kind) problem(field, 'fieldKind', { name, expected: kind, found: field.kind });
  }
  const keys = root.children.filter((c) => attrValue(doc, c.element, 'key') === 'true');
  if (keys.length === 0) problem(root, 'noKey');
  if (keys.length > 3) problem(root, 'tooManyKeys', { count: String(keys.length) });

  const lists = new Map<string, XmlElement>();
  const codeLists = firstChild(doc.root, 'codeLists');
  for (const l of codeLists ? childrenNamed(codeLists, 'list') : []) {
    const name = attrValue(doc, l, 'name') ?? '';
    if (lists.has(name)) problem(null, 'listTwice', { name });
    lists.set(name, l);
    const codes = new Set<string>();
    const walk = (parent: XmlElement | undefined) => {
      for (const item of parent ? childrenNamed(parent, 'item') : []) {
        const code = textValue(doc, firstChild(item, 'code') ?? item).trim();
        if (codes.has(code)) problem(null, 'codeTwice', { list: name, code });
        codes.add(code);
        walk(item);
      }
    };
    walk(firstChild(l, 'items'));
  }

  const visit = (node: SchemaNode) => {
    const names = new Set<string>();
    for (const c of node.children) {
      if (names.has(c.name)) problem(node, 'questionTwice', { name: c.name, in: pathOf(node) });
      names.add(c.name);
    }
    if (node.parent) {
      if (!NAME.test(node.name)) problem(node, 'badName', { name: node.name });
      else if (/_\d*$/.test(node.name)) problem(node, 'nameSuffix', { name: node.name });
      if (pathOf(node).length - root.name.length - 1 > MAX_NAME) problem(node, 'longName', { name: node.name, max: String(MAX_NAME) });
      if (node.kind === 'entity' && node.parent.parent) problem(node, 'nestedTable');
      if (node.kind === 'code') {
        const list = attrValue(doc, node.element, 'list');
        if (!list || !lists.has(list)) problem(node, 'unknownList', { name: list ?? '' });
      }
    }
    for (const x of expressionsOf(doc, node)) {
      const verdict = checkExpression(node, x.kind, x.text);
      if (!verdict.ok) problem(node, verdict.code, verdict.values, x.text, verdict.beyondCollect);
    }
    node.children.forEach(visit);
  };
  visit(root);
  return problems;
}

/** The problems a changed survey has that the survey before had not */
export function newProblems(before: SurveyProblem[], after: SurveyProblem[]): SurveyProblem[] {
  const key = (p: SurveyProblem) => JSON.stringify([p.node, p.code, p.values, p.expression]);
  const known = new Set(before.map(key));
  return after.filter((p) => !known.has(key(p)));
}
