// The server's check of Collect expressions (src/survey/expression.ts, check.ts) held to Collect's own: a corpus of
// expressions (every one of Collect's three Collect Earth templates and of the CEO imports, and cases written here,
// broken and not) is written to the desktop's test resources; the desktop's ExpressionVerdictsTest runs Collect's
// ExpressionValidator on each and keeps its verdicts beside it; here the server's verdict must be the same on each,
// or stricter where the server knowingly refuses more (`beyondCollect`: what Collect lets through and the form then
// fails on). After changing the corpus: UPDATE_DESIGNER_IDML=1 here, then
// `mvn test -pl collect-earth-app -am -Dtest=ExpressionVerdictsTest -Ddesigner.update=true` in collect-earth.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkExpression, checkSurvey, problemText, expressionsOf, nodeAt, pathOf, schemaOf, type ExpressionKind, type SchemaNode } from '../src/survey/check.js';
import { parseExpression, referencedPaths } from '../src/survey/expression.js';
import { readXml } from '../src/survey/xmlTree.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const DESIGNER = `${REPO}collect-earth/collect-earth-app/src/test/resources/designer/`;
const CORPUS_PATH = `${DESIGNER}expressions.json`;
const VERDICTS_PATH = `${DESIGNER}expression-verdicts.json`;

interface Entry {
  id: string;
  /** The survey, from the repository's root */
  survey: string;
  /** The node the expression is of, by its path of names */
  node: string;
  kind: ExpressionKind;
  expression: string;
}

const BASIC = 'collect-earth-cloud/templates/collect_earth.idm.xml';
const IPCC = 'collect-earth-cloud/templates/collect_earth_ipcc.idm.xml';

/** Written here: [survey, node, kind, expression] */
const CASES: Array<[string, string, ExpressionKind, string]> = [
  [BASIC, 'plot/integer_demo', 'boolean', 'yes_no_demo = true()'],
  [BASIC, 'plot/integer_demo', 'boolean', 'no_such_question = 1'],
  [BASIC, 'plot/integer_demo', 'boolean', 'integer_demo > 5 and'],
  [BASIC, 'plot/integer_demo', 'boolean', '(integer_demo > 5'],
  [BASIC, 'plot/integer_demo', 'boolean', 'integer_demo > 5)'],
  [BASIC, 'plot/integer_demo', 'boolean', 'idm:blank(code_demo)'],
  [BASIC, 'plot/integer_demo', 'boolean', 'idm:blank()'],
  [BASIC, 'plot/integer_demo', 'boolean', 'idm:nothing(code_demo)'],
  [BASIC, 'plot/integer_demo', 'boolean', 'foo(code_demo)'],
  [BASIC, 'plot/integer_demo', 'boolean', "translate(short_text_demo, 'a', 'b') = 'x'"],
  [BASIC, 'plot/integer_demo', 'boolean', "concat() = 'x'"],
  [BASIC, 'plot/integer_demo', 'boolean', 'math:pow(integer_demo, 2) > 4'],
  [BASIC, 'plot/integer_demo', 'boolean', 'math:pow(integer_demo) > 4'],
  [BASIC, 'plot/integer_demo', 'boolean', '$this > 5'],
  [BASIC, 'plot/integer_demo', 'boolean', '$this/@value > 5'],
  [BASIC, 'plot/integer_demo', 'boolean', "code_demo/@code = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "code_demo/@nope = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', 'demo_date/@year > 2000'],
  [BASIC, 'plot/integer_demo', 'boolean', 'location/@x > 0'],
  [BASIC, 'plot/integer_demo', 'boolean', "parent()/code_demo = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "../code_demo = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "/plot/code_demo = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "'a' = 'a'"],
  [BASIC, 'plot/integer_demo', 'boolean', '1 + 2 > 2'],
  [BASIC, 'plot/integer_demo', 'boolean', 'string-length(short_text_demo) > 5'],
  [BASIC, 'plot/integer_demo', 'boolean', "short_text_demo != ''"],
  [BASIC, 'plot/integer_demo', 'boolean', "code_demo = 'A' or code_demo= 'B'"],
  [BASIC, 'plot/integer_demo', 'boolean', 'not(yes_no_demo)'],
  [BASIC, 'plot/integer_demo', 'boolean', '$foo = 1'],
  [BASIC, 'plot/integer_demo', 'boolean', 'idm:currentDate() > demo_date'],
  [BASIC, 'plot/integer_demo', 'boolean', "regex:test(short_text_demo, '^[A-Z]+$')"],
  [BASIC, 'plot/integer_demo', 'boolean', 'regex:test(short_text_demo)'],
  [BASIC, 'plot/integer_demo', 'value', 'idm:array(1, 2, 3)'],
  [BASIC, 'plot/integer_demo', 'boolean', 'code_demo = "A"'],
  [BASIC, 'plot/integer_demo', 'boolean', 'integer_demo div 2 > 1'],
  [BASIC, 'plot/integer_demo', 'boolean', 'integer_demo mod 2 = 0'],
  [BASIC, 'plot/integer_demo', 'boolean', '-integer_demo < 0'],
  [BASIC, 'plot/integer_demo', 'boolean', "code_demo[. = 'A']"],
  [BASIC, 'plot/integer_demo', 'boolean', 'count(code_demo) > 0'],
  [BASIC, 'plot/integer_demo', 'value', 'code_demo | yes_no_demo'],
  [BASIC, 'plot/integer_demo', 'boolean', 'env:desktop()'],
  [BASIC, 'plot/integer_demo', 'boolean', "util:uuid() != ''"],
  [BASIC, 'plot/integer_demo', 'boolean', 'geo:distance(location, location) > 0'],
  [BASIC, 'plot/integer_demo', 'boolean', 'idm:position() = 1'],
  [BASIC, 'plot/integer_demo', 'boolean', 'this() = 5'],
  [BASIC, 'plot/integer_demo', 'boolean', "Code_demo = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "code_demo == 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "code_demo = 'A"],
  [BASIC, 'plot/integer_demo', 'boolean', 'code_demo = A'],
  [BASIC, 'plot/integer_demo', 'boolean', 'idm:not-blank(code_demo) and idm:blank(short_text_demo)'],
  [BASIC, 'plot/integer_demo', 'boolean', 'sum(integer_demo) > 1'],
  [BASIC, 'plot/integer_demo', 'boolean', 'math:max(integer_demo) > 1'],
  [BASIC, 'plot/integer_demo', 'boolean', 'boolean(code_demo)'],
  [BASIC, 'plot/integer_demo', 'boolean', "$context/code_demo = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "starts-with(short_text_demo, 'Pl')"],
  [BASIC, 'plot/integer_demo', 'boolean', "idm:lookup('a', 'b', 'c', 'd') != ''"],
  [BASIC, 'plot/integer_demo', 'boolean', "idm:lookup('a', 'b', 'c') != ''"],
  [BASIC, 'plot/integer_demo', 'boolean', "code_demo[idm:nothing()] = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', 'count(*) > 0'],
  [BASIC, 'plot/integer_demo', 'boolean', "child::code_demo = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', "@code = 'A'"],
  [BASIC, 'plot/code_demo', 'boolean', "$this/@code = 'A'"],
  [BASIC, 'plot/integer_demo', 'boolean', '.5 < integer_demo'],
  [BASIC, 'plot/integer_demo', 'value', 'integer_demo * 2'],
  [BASIC, 'plot/integer_demo', 'value', "concat(short_text_demo, 'x')"],
  [BASIC, 'plot/integer_demo', 'value', 'idm:currentDate()'],
  [BASIC, 'plot/integer_demo', 'boolean', 'yes_no_demo = true() and (code_demo = "A" or code_demo = "B")'],
  [BASIC, 'plot/integer_demo', 'boolean', 'code_demo = \'A\' and not(idm:blank(short_text_demo)) or integer_demo >= 10'],
  [BASIC, 'plot/integer_demo', 'boolean', 'integer_demo > '],
  [BASIC, 'plot/integer_demo', 'boolean', 'and'],
  [BASIC, 'plot/integer_demo', 'boolean', 'integer_demo >> 5'],
  [BASIC, 'plot/integer_demo', 'boolean', 'idm:blank(code_demo,)'],
  [BASIC, 'plot/code_demo', 'path', 'yes_no_demo'],
  [BASIC, 'plot/code_demo', 'path', 'no_such_question'],
  [IPCC, 'plot/land_cover/percentage', 'boolean', "parent()/plot_distribution = 'single'"],
  [IPCC, 'plot/land_cover/percentage', 'boolean', "coverage != 'na'"],
  [IPCC, 'plot/land_cover/percentage', 'boolean', "parent()/land_cover[element='trees']/percentage > 0"],
  [IPCC, 'plot/land_cover/percentage', 'boolean', "parent()/land_cover[elementx='trees']/percentage > 0"],
  [IPCC, 'plot/land_cover/percentage', 'boolean', "parent()/parent()/plot_distribution = 'single'"],
  [IPCC, 'plot/land_cover/percentage', 'boolean', "plot_distribution = 'single'"],
  [IPCC, 'plot/plot_distribution', 'boolean', 'sum(land_use/percentage) >= 90'],
  [IPCC, 'plot/plot_distribution', 'boolean', 'land_use/nothing > 1'],
  [IPCC, 'plot/plot_distribution', 'boolean', "land_cover[element='trees']/percentage + land_cover[element='crops']/percentage > 0"],
];

function corpus(): Entry[] {
  const entries: Entry[] = [];
  const surveys = [
    ...readdirSync(`${REPO}collect-earth-cloud/templates`).filter((f) => f.endsWith('.xml')).map((f) => `collect-earth-cloud/templates/${f}`),
    ...readdirSync(`${REPO}collect-earth/collect-earth-app/src/test/resources/ceo`).filter((f) => f.endsWith('.idm.xml')).map((f) => `collect-earth/collect-earth-app/src/test/resources/ceo/${f}`),
  ];
  for (const survey of surveys) {
    const doc = readXml(readFileSync(REPO + survey));
    const seen = new Set<string>();
    const walk = (node: SchemaNode) => {
      if (node.parent) {
        for (const x of expressionsOf(doc, node)) {
          const key = `${pathOf(node)}|${x.kind}|${x.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          entries.push({ id: `${survey.split('/').pop()}#${entries.length}`, survey, node: pathOf(node), kind: x.kind, expression: x.text });
        }
      }
      node.children.forEach(walk);
    };
    walk(schemaOf(doc));
  }
  CASES.forEach(([survey, node, kind, expression], i) => entries.push({ id: `case#${i}`, survey, node, kind, expression }));
  return entries;
}

describe('the parser of Collect expressions', () => {
  it('reads the paths an expression names as Collect does', () => {
    const paths = (e: string) => [...referencedPaths(parseExpression(e))].sort();
    expect(paths("parent()/land_cover[element='trees']/percentage > 0")).toEqual(['__parent/land_cover/element', '__parent/land_cover/percentage']);
    expect(paths('$this > 5 and idm:blank(code)')).toEqual(['code']);
    expect(paths("$this/@code = 'A'")).toEqual(['$this/@code']);
    expect(paths('idm:position() = 1')).toEqual(['.']);
    expect(paths("'a and b' = x")).toEqual(['x']);
  });

  it('refuses what is not an expression', () => {
    for (const e of ['', 'a >', '(a', 'a)', "a = 'b", 'a == b', 'a >> b', 'f(a,)', '$']) expect(() => parseExpression(e), e).toThrow();
  });
});

describe("the server's check agrees with Collect's", () => {
  const entries = corpus();

  it('the corpus is the one the desktop test reads', () => {
    expect(entries.length).toBeGreaterThan(600);
    // One entry a line: a change shows as the lines of the entries it concerns
    const written = '[\n' + entries.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n';
    if (process.env.UPDATE_DESIGNER_IDML === '1' || !existsSync(CORPUS_PATH)) writeFileSync(CORPUS_PATH, written);
    expect(readFileSync(CORPUS_PATH, 'utf8').replace(/\r\n/g, '\n')).toBe(written);
  });

  it("gives Collect's verdict on every expression, or a stricter one it knows of", () => {
    expect(existsSync(VERDICTS_PATH), 'run the desktop ExpressionVerdictsTest with -Ddesigner.update=true').toBe(true);
    const verdicts = JSON.parse(readFileSync(VERDICTS_PATH, 'utf8')) as Record<string, { ok: boolean; message: string | null }>;
    const roots = new Map<string, SchemaNode>();
    const disagreements: string[] = [];
    let stricter = 0;
    let refusedByCollect = 0;
    for (const e of entries) {
      const collect = verdicts[e.id];
      expect(collect, `${e.id}: no verdict of Collect's; run the desktop's ExpressionVerdictsTest`).toBeDefined();
      if (!roots.has(e.survey)) roots.set(e.survey, schemaOf(readXml(readFileSync(REPO + e.survey))));
      const node = nodeAt(roots.get(e.survey)!, e.node)!;
      const ours = checkExpression(node, e.kind, e.expression);
      if (!collect.ok) refusedByCollect++;
      if (ours.ok === collect.ok) continue;
      if (!ours.ok && ours.beyondCollect) {
        stricter++;
        continue;
      }
      disagreements.push(`${e.id} ${e.node} [${e.kind}] ${e.expression}\n   Collect: ${collect.ok ? 'ok' : collect.message}\n   server: ${ours.ok ? 'ok' : ours.message}`);
    }
    expect(disagreements, disagreements.join('\n')).toEqual([]);
    // The corpus does test refusals, and the server's own refusals beyond Collect's stay few and known
    expect(refusedByCollect).toBeGreaterThan(25);
    expect(stricter).toBeLessThanOrEqual(5);
  });
});

describe('the survey check', () => {
  it('finds nothing in the surveys that open in Collect Earth', () => {
    for (const f of readdirSync(`${REPO}collect-earth-cloud/templates`).filter((x) => x.endsWith('.xml'))) {
      expect(checkSurvey(readFileSync(`${REPO}collect-earth-cloud/templates/${f}`)), f).toEqual([]);
    }
    for (const f of readdirSync(DESIGNER).filter((x) => x.endsWith('.idm.xml'))) expect(checkSurvey(readFileSync(DESIGNER + f)), f).toEqual([]);
  });

  it("finds Collect Earth's rules broken, and a broken expression, with where", () => {
    let text = readFileSync(`${REPO}collect-earth-cloud/templates/collect_earth.idm.xml`, 'latin1');
    text = text
      .replace('name="plot_file"', 'name="plot_files"')
      .replace('name="memo_text_demo" relevant="yes_no_demo = true()"', 'name="memo_text_demo" relevant="yes_no_demo = tru()"')
      .replace('name="short_text_demo"', 'name="short_text_2"')
      .replace('list="demo_codelist"', 'list="no_list"');
    const problems = checkSurvey(Buffer.from(text, 'latin1'));
    expect(problems.map((p) => [p.node, problemText(p)])).toEqual([
      ['plot', 'Collect Earth needs the field plot_file.'],
      ['plot/short_text_2', 'short_text_2: Collect Earth cannot use a name ending in _ or _ and digits.'],
      ['plot/code_demo', 'The list no_list does not exist.'],
      ['plot/memo_text_demo', 'There is no function tru.'],
    ]);
    expect(problems[3]).toMatchObject({ code: 'unknownFunction', values: { name: 'tru' }, beyondCollect: false });
    expect(problems[3].expression).toBe('yes_no_demo = tru()');
  });
});
