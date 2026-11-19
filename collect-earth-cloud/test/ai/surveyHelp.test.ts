// The survey designer's help from the AI assistant (stage 4b): the model is sent the survey's structure only, and
// every rule it answers is checked as a coordinator's and tried on the plots collected before it is offered.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import type { AiClient, AiRequest } from '../../src/ai/client.js';
import { createFakeClient } from '../../src/ai/fake.js';
import { DESCRIBE_SCHEMA, helpStructure, ruleOfModel, SUGGEST_SCHEMA } from '../../src/ai/surveyHelp.js';
import { zipCep } from '../../src/cep.js';
import { LOCAL_OFF_ROUTES } from '../../src/local.js';
import { surveyDesign } from '../../src/survey/design.js';
import type { SurveyDesignAnswer, SurveyHelpAnswer } from '../../src/wire/survey.js';
import { FIXTURE_DATE, realDemoCep } from '../fixtures/cep.js';
import { batchRequest, bearer, createProject, envelope, makeContext, setupPlatformAdmin, type TestContext } from '../helpers.js';
import { aiResponse, scripted } from './fakeClient.js';

const basic = readFileSync(fileURLToPath(new URL('../../templates/collect_earth.idm.xml', import.meta.url)));

describe('what the model is sent and what is kept of its answer', () => {
  it('sends the questions, their lists and rules, never more', () => {
    const s = helpStructure(surveyDesign(basic), 'en');
    const integer = s.questions.find((q) => q.name === 'integer_demo')!;
    expect(integer).toMatchObject({ type: 'integer', place: 'plot', required: 'always' });
    expect(integer.rules?.[0]).toMatch(/^error: range/);
    expect(s.questions.find((q) => q.name === 'memo_text_demo')?.shownWhen).toBe('yes_no_demo is true');
    // The fields Collect Earth fills in are not sent
    expect(s.questions.some((q) => q.name === 'operator' || q.name === 'location')).toBe(false);
    expect(s.lists.find((l) => l.name === 'demo_codelist')?.codes[0]).toEqual({ code: 'A', label: expect.any(String) });
  });

  it("reads the model's rule as the builder's, or not at all", () => {
    expect(ruleOfModel({ kind: 'range', flag: 'warning', message: 'Too high', max: { number: 50, inclusive: false } }, 'es')).toEqual({
      flag: 'warning',
      message: { es: 'Too high' },
      when: null,
      kind: 'range',
      min: null,
      max: { bound: { number: 50 }, inclusive: false },
    });
    expect(ruleOfModel({ kind: 'range', flag: 'error', message: 'x' }, 'en')).toBeNull();
    expect(ruleOfModel({ kind: 'pattern', flag: 'error', message: 'x' }, 'en')).toBeNull();
    expect(ruleOfModel({ kind: 'length', flag: 'error', message: 'x', minChars: 2, when: { kind: 'all', parts: [{ question: 'a', test: 'answered', value: 'ignored' }] } }, 'en')?.when).toEqual({
      kind: 'all',
      parts: [{ question: 'a', test: 'answered', value: null }],
    });
  });
});

describe('POST /survey/help', () => {
  let ctx: TestContext;
  let client: AiClient = createFakeClient();
  const delegating: AiClient = { generate: (req: AiRequest) => client.generate(req) };
  let owner: { token: string; userId: string };
  let pid: string;
  let design: NonNullable<SurveyDesignAnswer['design']>;
  const id = (name: string) => [...design.pages.flatMap((p) => p.items), ...design.calculated].find((q) => q.name === name)!.id;
  const help = (payload: object, token = owner.token) => ctx.app.inject({ method: 'POST', url: `/v1/projects/${pid}/survey/help`, headers: bearer(token), payload });

  async function setUp(enabled = true) {
    client = createFakeClient();
    ctx = await makeContext({ aiVertexApiKey: 'test-key', aiConfigured: true }, { ai: { client: delegating } });
    owner = await setupPlatformAdmin(ctx.app);
    expect((await ctx.app.inject({ method: 'PUT', url: '/v1/admin/settings', headers: bearer(owner.token), payload: { aiEnabled: true } })).statusCode).toBe(200);
    const project = await createProject(ctx.app, 'Secret Forest Project');
    pid = project.projectId;
    await ctx.store.addMembership(pid, owner.userId, 'admin');
    if (enabled) expect((await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/ai`, headers: bearer(owner.token), payload: { enabled: true } })).statusCode).toBe(200);
    const files = unzipSync(realDemoCep());
    delete files['survey_guide.pdf'];
    const entries = new Map(Object.entries(files));
    entries.set('placemark.idm.xml', basic);
    const up = await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/cep`, headers: { ...bearer(project.adminToken), 'content-type': 'application/zip' }, payload: zipCep(entries, FIXTURE_DATE) });
    expect(up.statusCode, up.body).toBeLessThan(300);
    const records = [
      envelope({ recordKey: '1', operator: 'zorbagrill', summary: { collect_text_id: '1', collect_integer_integer_demo: '987654', collect_text_short_text_demo: 'SECRET ANSWER' } }),
      envelope({ recordKey: '2', operator: 'zorbagrill', summary: { collect_text_id: '2', collect_integer_integer_demo: '12' } }),
    ];
    expect((await batchRequest(ctx.app, pid, project.projectToken, records)).statusCode).toBe(200);
    design = ((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/survey/design`, headers: bearer(owner.token) })).json() as SurveyDesignAnswer).design!;
  }

  afterEach(async () => {
    await ctx.app.close();
  });

  it('writes a described rule, checked and tried on the plots; the model never sees an answer or a person', async () => {
    await setUp();
    const fake = scripted([
      aiResponse({ text: JSON.stringify({ possible: true, why: 'A range.', rule: { kind: 'range', flag: 'error', message: 'Entre 0 y 100', min: { number: 0, inclusive: true }, max: { number: 100, inclusive: true } } }) }),
    ]);
    client = fake;
    const res = await help({ task: 'describe', question: id('integer_demo'), text: 'between 0 and 100', language: 'fr', surveyLanguage: 'es' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      task: 'describe',
      rule: { flag: 'error', message: { es: 'Entre 0 y 100' }, when: null, kind: 'range', min: { bound: { number: 0 }, inclusive: true }, max: { bound: { number: 100 }, inclusive: true } },
      why: 'A range.',
      flagged: 1,
      checked: 2,
    } satisfies SurveyHelpAnswer);
    const [req] = fake.requests;
    expect(req.responseSchema).toEqual(DESCRIBE_SCHEMA);
    const sent = JSON.stringify(req);
    expect(sent).toContain('integer_demo');
    expect(sent).toContain('French');
    for (const secret of ['SECRET ANSWER', 'zorbagrill', 'Secret Forest Project', '987654']) expect(sent).not.toContain(secret);
    // Counted as a run of its own, not in the AI tab
    expect((await ctx.store.listAiRuns(pid, 10))[0]).toMatchObject({ kind: 'survey', status: 'done' });
    expect((await ctx.app.inject({ method: 'GET', url: `/v1/projects/${pid}/ai/runs`, headers: bearer(owner.token) })).json().runs).toEqual([]);
  });

  it("refuses a rule the coordinator's checks refuse, and says when a request cannot be a rule", async () => {
    await setUp();
    client = scripted([
      aiResponse({ text: JSON.stringify({ possible: true, why: 'Long enough.', rule: { kind: 'length', flag: 'error', message: 'x', minChars: 3 } }) }),
      aiResponse({ text: JSON.stringify({ possible: false, why: 'A pattern of letters is not a rule of the designer.' }) }),
    ]);
    const wrongKind = (await help({ task: 'describe', question: id('integer_demo'), text: 'three letters', language: 'en' })).json();
    expect(wrongKind).toMatchObject({ rule: null, why: 'Long enough. A length is for a text.' });
    expect((await help({ task: 'describe', question: id('short_text_demo'), text: 'like AB-123', language: 'en' })).json()).toMatchObject({ rule: null, why: 'A pattern of letters is not a rule of the designer.' });
  });

  it('suggests only rules that pass the checks, with the plots each would flag', async () => {
    await setUp();
    const fake = scripted([
      aiResponse({
        text: JSON.stringify({
          suggestions: [
            { question: 'integer_demo', why: 'Never negative.', rule: { kind: 'range', flag: 'warning', message: 'Not negative', min: { number: 0, inclusive: true } } },
            { question: 'integer_demo', why: 'Under 100.', rule: { kind: 'range', flag: 'warning', message: 'Under 100', max: { number: 100, inclusive: true } } },
            { question: 'made_up', why: 'x', rule: { kind: 'range', flag: 'error', message: 'x', min: { number: 0, inclusive: true } } },
            { question: 'code_demo', why: 'x', rule: { kind: 'range', flag: 'error', message: 'x', min: { number: 0, inclusive: true } } },
          ],
        }),
      }),
    ]);
    client = fake;
    const res = await help({ task: 'suggest', language: 'en' });
    expect(res.statusCode, res.body).toBe(200);
    expect(fake.requests[0].responseSchema).toEqual(SUGGEST_SCHEMA);
    const answer = res.json() as Extract<SurveyHelpAnswer, { task: 'suggest' }>;
    expect(answer.suggestions.map((s) => [s.questionName, s.why, s.flagged, s.checked])).toEqual([
      ['integer_demo', 'Never negative.', 0, 2],
      ['integer_demo', 'Under 100.', 1, 2],
    ]);
  });

  it('translates a message into languages of the survey, and explains an advanced condition', async () => {
    await setUp();
    // Only into the survey's own languages
    expect((await help({ task: 'translate', text: 'Too high', from: 'en', to: ['de'], language: 'en' })).statusCode).toBe(400);
    const ok = await help({ task: 'translate', text: 'Too high', from: 'en', to: ['es', 'fr', 'de'], language: 'en' });
    expect(ok.json()).toEqual({ task: 'translate', translations: { es: '[es] Too high', fr: '[fr] Too high' } });
    // The basic template's demo_date is required under a condition the rows read; its calculated values have formulas
    const calculated = design.calculated[0];
    const explained = await help({ task: 'explain', question: calculated.id, which: 'formula', index: 0, language: 'en' });
    expect(explained.statusCode, explained.body).toBe(200);
    expect(explained.json().text).toMatch(/^Test assistant \(no AI model\): it depends on/);
    // Only the survey's own expressions are explained
    expect((await help({ task: 'explain', question: id('integer_demo'), which: 'shownWhen', language: 'en' })).statusCode).toBe(400);
  });

  it('works with the development fake, and follows the switches', async () => {
    await setUp(false);
    expect((await help({ task: 'suggest', language: 'en' })).json().error).toBe('ai_not_enabled');
    await ctx.app.inject({ method: 'PUT', url: `/v1/projects/${pid}/ai`, headers: bearer(owner.token), payload: { enabled: true } });
    const described = (await help({ task: 'describe', question: id('integer_demo'), text: 'at most 100', language: 'en' })).json();
    expect(described.rule).toMatchObject({ kind: 'range', max: { bound: { number: 100 } } });
    expect(described).toMatchObject({ flagged: 1, checked: 2 });
    expect((await help({ task: 'suggest', language: 'en' })).json().suggestions.length).toBeGreaterThan(0);
    expect((await help({ task: 'nothing', language: 'en' })).statusCode).toBe(400);
    expect(LOCAL_OFF_ROUTES).toContain('POST /v1/projects/:pid/survey/help');
  });
});
