// The survey designer's help from the AI assistant (docs/plans/2026-11-18-survey-designer.md, stage 4b): a rule
// described in words, rules suggested, a message translated, an advanced condition or formula explained. The model is
// sent the survey's structure only (src/ai/surveyHelp.ts); every rule it answers is checked as a coordinator's
// (SurveyEdit) and tried on the plots collected (surveyImpact) before the coordinator sees it, and is only offered:
// nothing is saved here.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiAvailable } from '../ai/available.js';
import { AI_LANGUAGES, type AiLanguage } from '../ai/prompts.js';
import type { AiRunService } from '../ai/service.js';
import {
  DESCRIBE_SCHEMA,
  describeSystem,
  describeTurn,
  EXPLAIN_SCHEMA,
  explainSystem,
  explainTurn,
  helpStructure,
  MAX_EXPLAIN,
  MAX_REQUEST,
  MAX_SUGGESTIONS,
  MAX_WHY_TEXT,
  plain,
  ruleOfModel,
  SUGGEST_SCHEMA,
  suggestSystem,
  suggestTurn,
  TRANSLATE_SCHEMA,
  translateSystem,
  translateTurn,
} from '../ai/surveyHelp.js';
import { readCep } from '../cep.js';
import type { Config } from '../config.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { checkSurvey, newProblems } from '../survey/check.js';
import { surveyDesign } from '../survey/design.js';
import { SurveyEdit, SurveyEditError } from '../survey/edit.js';
import { surveyImpact, type ImpactRecord } from '../survey/impact.js';
import type { DesignQuestion, NewRule, SuggestedRule, SurveyDesign, SurveyHelpAnswer } from '../wire/survey.js';
import { NOT_ENABLED, SESSION_REQUIRED, sendOneCallRefusal, UNAVAILABLE } from './ai.js';

const bad = (reason: string) => ({ error: 'bad_request', reason });
const isString = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const LANGUAGE = /^[a-z]{2,3}(_[A-Z]{2})?$/;

/** Every question of the survey, a table's columns among them */
function questionsOf(design: SurveyDesign): DesignQuestion[] {
  return [
    ...design.pages.flatMap((p) => p.items.flatMap((i) => (i.kind === 'table' ? i.columns : [i]))),
    ...design.fromPlotFile,
    ...design.calculated,
    ...design.hidden,
  ];
}

/** A rule checked as a coordinator's on the survey, and tried on the plots collected; the reason when it fails */
function tried(survey: Buffer, id: number, rule: NewRule, records: readonly ImpactRecord[]): { flagged: number; checked: number } | string {
  try {
    const edit = new SurveyEdit(survey);
    edit.putRule(id, rule);
    // Only problems it brings: a survey uploaded with known ones takes rules as the save does
    if (newProblems(checkSurvey(survey), edit.problems()).length > 0) return 'The survey check refuses it.';
    const effect = surveyImpact(survey, [{ op: 'addRule', id, rule }], records, edit.bytes()).effects.find((e) => e.kind === 'ruleFlags');
    return effect && effect.kind === 'ruleFlags' ? { flagged: effect.flagged, checked: effect.checked } : { flagged: 0, checked: 0 };
  } catch (err) {
    if (err instanceof SurveyEditError) return err.message;
    throw err;
  }
}

export async function registerSurveyHelpRoutes(app: FastifyInstance, store: Store, config: Config, options: { runs: AiRunService }): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const { runs } = options;

  app.post('/v1/projects/:pid/survey/help', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, userId } = request.membership!;
    if (!userId) return reply.code(403).send(SESSION_REQUIRED);
    const [settings, enabled] = await Promise.all([store.getSettings(), store.isAiEnabled(projectId)]);
    if (!aiAvailable(config, settings) || !runs.hasClient) return reply.code(409).send(UNAVAILABLE);
    if (!enabled) return reply.code(409).send(NOT_ENABLED);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const language = (AI_LANGUAGES as readonly string[]).includes(body.language as string) ? (body.language as AiLanguage) : null;
    if (!language) return reply.code(400).send(bad(`language must be one of ${AI_LANGUAGES.join(', ')}`));
    const cep = await store.getCep(projectId);
    if (!cep) return reply.code(404).send({ error: 'no_project_file', reason: 'Upload the project file first.' });
    const files = readCep(cep);
    const survey = Buffer.from(files.entries.get(files.surveyPath)!);
    let design: SurveyDesign;
    try {
      design = surveyDesign(survey);
    } catch {
      return reply.code(409).send({ error: 'survey_unreadable', reason: 'The survey of the project file cannot be read.' });
    }
    const questions = questionsOf(design);
    const byId = new Map(questions.map((q) => [q.id, q]));
    const byName = new Map(questions.map((q) => [q.name, q]));
    const surveyLanguage = typeof body.surveyLanguage === 'string' && design.languages.includes(body.surveyLanguage) ? body.surveyLanguage : design.languages[0];
    const structure = () => helpStructure(design, surveyLanguage);
    await runs.failStale(projectId);
    const call = (system: string, turn: string, schema: object, maxOutputTokens: number) =>
      runs.surveyHelp(projectId, userId, { system, turn, schema, maxOutputTokens }, settings);
    const records = async () => (await store.listRecordSummaries(projectId)) as ImpactRecord[];

    switch (body.task) {
      case 'describe': {
        const q = Number.isInteger(body.question) ? byId.get(body.question as number) : undefined;
        if (!q || !isString(body.text, MAX_REQUEST)) return reply.code(400).send(bad(`question must be a question's id, text at most ${MAX_REQUEST} characters`));
        const out = await call(describeSystem(language, surveyLanguage), describeTurn(structure(), q.name, plain(body.text, MAX_REQUEST)), DESCRIBE_SCHEMA, 2048);
        if (!out.ok) return sendOneCallRefusal(reply, out, settings);
        const json = out.json as { possible?: unknown; why?: unknown; rule?: unknown };
        const why = plain(json.why, MAX_WHY_TEXT);
        const rule = json.possible === true ? ruleOfModel(json.rule, surveyLanguage) : null;
        if (!rule) return reply.header('cache-control', 'no-store').send({ task: 'describe', rule: null, why, flagged: 0, checked: 0 } satisfies SurveyHelpAnswer);
        const result = tried(survey, q.id, rule, await records());
        if (typeof result === 'string') {
          return reply.header('cache-control', 'no-store').send({ task: 'describe', rule: null, why: `${why} ${result}`.trim(), flagged: 0, checked: 0 } satisfies SurveyHelpAnswer);
        }
        return reply.header('cache-control', 'no-store').send({ task: 'describe', rule, why, ...result } satisfies SurveyHelpAnswer);
      }
      case 'suggest': {
        const out = await call(suggestSystem(language, surveyLanguage), suggestTurn(structure()), SUGGEST_SCHEMA, 6144);
        if (!out.ok) return sendOneCallRefusal(reply, out, settings);
        const list = (out.json as { suggestions?: unknown }).suggestions;
        const collected = await records();
        const suggestions: SuggestedRule[] = [];
        const seen = new Set<string>();
        for (const raw of Array.isArray(list) ? list : []) {
          if (suggestions.length >= MAX_SUGGESTIONS) break;
          const s = (raw ?? {}) as { question?: unknown; why?: unknown; rule?: unknown };
          const q = typeof s.question === 'string' ? byName.get(s.question) : undefined;
          const rule = q ? ruleOfModel(s.rule, surveyLanguage) : null;
          if (!q || !rule) continue;
          const key = JSON.stringify([q.name, { ...rule, message: {} }]);
          if (seen.has(key)) continue;
          seen.add(key);
          // What does not pass the coordinator's checks is not offered
          const result = tried(survey, q.id, rule, collected);
          if (typeof result === 'string') continue;
          suggestions.push({ question: q.id, questionName: q.name, rule, why: plain(s.why, MAX_WHY_TEXT), ...result });
        }
        return reply.header('cache-control', 'no-store').send({ task: 'suggest', suggestions } satisfies SurveyHelpAnswer);
      }
      case 'translate': {
        const from = typeof body.from === 'string' && design.languages.includes(body.from) ? body.from : null;
        const to = Array.isArray(body.to) ? [...new Set(body.to.filter((l): l is string => typeof l === 'string' && LANGUAGE.test(l) && design.languages.includes(l) && l !== from))] : [];
        if (!from || to.length === 0 || !isString(body.text, MAX_REQUEST)) {
          return reply.code(400).send(bad(`from and to must be languages of the survey, text at most ${MAX_REQUEST} characters`));
        }
        const out = await call(translateSystem(), translateTurn(plain(body.text, MAX_REQUEST), from, to), TRANSLATE_SCHEMA, 2048);
        if (!out.ok) return sendOneCallRefusal(reply, out, settings);
        const list = (out.json as { translations?: unknown }).translations;
        const translations: Record<string, string> = {};
        for (const raw of Array.isArray(list) ? list : []) {
          const t = (raw ?? {}) as { language?: unknown; text?: unknown };
          const text = plain(t.text, MAX_REQUEST);
          if (typeof t.language === 'string' && to.includes(t.language) && text && !(t.language in translations)) translations[t.language] = text;
        }
        return reply.header('cache-control', 'no-store').send({ task: 'translate', translations } satisfies SurveyHelpAnswer);
      }
      case 'explain': {
        const q = Number.isInteger(body.question) ? byId.get(body.question as number) : undefined;
        const index = body.index === undefined ? 0 : body.index;
        if (!q || !Number.isInteger(index)) return reply.code(400).send(bad('question must be a question\'s id'));
        // The expression is the survey's own, never one sent by the dashboard
        let expression: string | null = null;
        let what = 'condition';
        if (body.which === 'shownWhen' && q.shownWhen?.kind === 'advanced') expression = q.shownWhen.text;
        else if (body.which === 'required' && typeof q.required === 'object' && q.required.when.kind === 'advanced') expression = q.required.when.text;
        else if (body.which === 'rule') {
          const r = q.rules[index as number];
          if (r?.kind === 'advanced') expression = r.when?.kind === 'advanced' ? `${r.text} (applies when: ${r.when.text})` : r.text;
          what = 'rule (the answer must make it true)';
        } else if (body.which === 'formula') {
          const f = q.formulas?.[index as number];
          if (f) expression = `${f.expression ?? JSON.stringify(f.value)}${f.when ? ` if ${f.when}` : ''}`;
          what = 'formula of a calculated value (its value, when its condition holds)';
        }
        if (!expression) return reply.code(400).send(bad('the question has no such advanced condition, rule or formula'));
        const out = await call(explainSystem(language), explainTurn(structure(), q.name, what, expression), EXPLAIN_SCHEMA, 1536);
        if (!out.ok) return sendOneCallRefusal(reply, out, settings);
        return reply.header('cache-control', 'no-store').send({ task: 'explain', text: plain((out.json as { text?: unknown }).text, MAX_EXPLAIN) } satisfies SurveyHelpAnswer);
      }
      default:
        return reply.code(400).send(bad('task must be describe, suggest, translate or explain'));
    }
  });
}
