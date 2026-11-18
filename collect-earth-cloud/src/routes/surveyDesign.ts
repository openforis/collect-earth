// The survey designer (docs/plans/2026-11-18-survey-designer.md), stage 1: the project's survey as the designer shows
// it, read-only, for Setup › Survey form.
import type { FastifyInstance } from 'fastify';
import { readCep } from '../cep.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { checkSurvey } from '../survey/check.js';
import { surveyDesign } from '../survey/design.js';
import type { SurveyDesignAnswer } from '../wire/survey.js';

export async function registerSurveyDesignRoutes(app: FastifyInstance, store: Store): Promise<void> {
  app.get('/v1/projects/:pid/survey/design', { preHandler: requireProjectMembership(store, 'admin') }, async (request) => {
    const { pid } = request.params as { pid: string };
    const cep = await store.getCep(pid);
    if (!cep) return { design: null, unreadable: false, problems: [] } satisfies SurveyDesignAnswer;
    try {
      const files = readCep(cep);
      const survey = files.entries.get(files.surveyPath)!;
      // What Collect or Collect Earth would refuse in it: shown as warnings, as the survey came from Collect's designer
      return { design: surveyDesign(survey), unreadable: false, problems: checkSurvey(survey) } satisfies SurveyDesignAnswer;
    } catch (err) {
      request.log.warn({ err }, 'could not read the survey of the project file for the designer');
      return { design: null, unreadable: true, problems: [] } satisfies SurveyDesignAnswer;
    }
  });
}
