// A project's survey guide (src/surveyGuide.ts): the PDF that says how to interpret the plots, kept on the server or
// linked, and carried in the project file as an address only (survey_guide_url), so the project file stays light.
// - GET    /v1/projects/:pid/survey-guide (any member) -> { guide: { kind, url, filename, bytes, updatedAt } | null, properties }:
//   `properties` is what Collect Earth writes into its settings during its sync (CloudCoordinatorSettings), as it does
//   the plot layout: { survey_guide_url } ("" without a guide).
// - PUT    /v1/projects/:pid/survey-guide (coordinators): { url } for a link, or the PDF as the body (application/pdf;
//   ?filename=) -> the same answer. 400 for a link that is no address or a body that is no PDF, 413 above MAX_GUIDE_BYTES
//   or the project's storage.
// - DELETE /v1/projects/:pid/survey-guide (coordinators) -> 204.
// - GET    /guide/:pid/:token (no login: Collect Earth opens it in a browser) -> the PDF. 404 for anything else.
// A change rewrites survey_guide_url in the stored project file (the served one and the one as uploaded), as a change
// of the plot layout does. Cloud only (LOCAL_OFF_ROUTES).
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { publicBaseUrl } from '../accountRules.js';
import { audit } from '../activity.js';
import { roundInfoOf, withProperties } from '../cep.js';
import type { Config } from '../config.js';
import { checkUploadFits } from '../limits.js';
import { rewriteProperties } from '../plotLayout.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import { GUIDE_PROPERTY, guideAddress, guideFilename, isPdf, linkProblem, MAX_GUIDE_BYTES, type SurveyGuide } from '../surveyGuide.js';
import type { SurveyGuideAnswer } from '../wire/projects.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answerOf = (guide: SurveyGuide | null): SurveyGuideAnswer => ({
  guide: guide ? { kind: guide.kind, url: guide.url, filename: guide.filename, bytes: guide.bytes, updatedAt: guide.updatedAt } : null,
  properties: { [GUIDE_PROPERTY]: guide?.url ?? '' },
});

/** The project file with the guide's address (`url`; "" without a guide), or as it is when it says so already. */
export function cepWithGuide(zip: Buffer, url: string, date: Date): Buffer {
  return withProperties(zip, (data) => rewriteProperties(data, { [GUIDE_PROPERTY]: url }), date);
}

/**
 * Writes the guide's address into the project file the server keeps (the served one and the one as uploaded): nothing
 * when the project has no project file yet (the upload writes it then, acceptCep). The people who had the project file
 * still have it: Collect Earth takes the address by itself during its sync.
 */
export async function writeGuideToCep(store: Store, projectId: string, url: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [served, before] = await Promise.all([store.getCep(projectId), store.getCepInfo(projectId)]);
    if (!served || !before) return;
    const date = new Date();
    const stored = await store.getOriginalCep(projectId);
    const original = stored && !stored.equals(served) ? cepWithGuide(stored, url, date) : null;
    const next = cepWithGuide(served, url, date);
    // Only over the project file the change was made on (a survey saved meanwhile in the designer is not undone): again then
    if (!(await store.replaceCep(projectId, served, next, (await store.getRoundInfo(projectId)) ?? roundInfoOf(next), original))) continue;
    const after = await store.getCepInfo(projectId);
    if (after) {
      for (const a of await store.listMemberActivity(projectId)) {
        if (a.lastCepDownloadAt !== null && a.lastCepDownloadAt >= before.updatedAt) await store.touchMemberActivity(projectId, a.userId, { lastCepDownloadAt: after.updatedAt });
      }
    }
    return;
  }
  throw new Error('the project file kept changing: the guide could not be written into it');
}

export async function registerSurveyGuideRoutes(app: FastifyInstance, store: Store, config: Config): Promise<void> {
  const member = { preHandler: requireProjectMembership(store) };
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const url = '/v1/projects/:pid/survey-guide';

  app.get(url, member, async (request: FastifyRequest, reply: FastifyReply) => reply.send(answerOf(await store.getSurveyGuide(request.membership!.projectId))));

  app.put(url, admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const by = request.membership!.userId ?? null;
    const body = request.body;
    let guide: SurveyGuide;
    if (Buffer.isBuffer(body)) {
      if (body.length > MAX_GUIDE_BYTES) return reply.code(413).send({ error: 'guide_too_large', maxBytes: MAX_GUIDE_BYTES, reason: `The guide is larger than the ${MAX_GUIDE_BYTES / (1024 * 1024)} MB the server keeps: link to it instead.` });
      if (!isPdf(body)) return reply.code(400).send({ error: 'not_a_pdf', reason: 'The guide must be a PDF file.' });
      // the one there is goes: only what this one adds counts
      const had = (await store.getSurveyGuide(projectId))?.bytes ?? 0;
      const over = await checkUploadFits(store, projectId, { kind: 'records' }, Math.max(0, body.length - had));
      if (over) return reply.code(413).send(over);
      const base = publicBaseUrl(config, request);
      guide = await store.setSurveyGuide(projectId, { kind: 'file', filename: guideFilename((request.query as { filename?: unknown } | null)?.filename), data: body, urlOf: (token) => guideAddress(base, projectId, token) }, by);
    } else {
      const link = (body as { url?: unknown } | null)?.url;
      const problem = linkProblem(link);
      if (problem) return reply.code(400).send({ error: 'bad_request', reason: problem });
      guide = await store.setSurveyGuide(projectId, { kind: 'link', url: (link as string).trim() }, by);
    }
    await writeGuideToCep(store, projectId, guide.url);
    await audit(store, request, 'settings.changed', { setting: 'surveyGuide', kind: guide.kind });
    return reply.send(answerOf(guide));
  });

  app.delete(url, admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    if (await store.deleteSurveyGuide(projectId)) {
      await writeGuideToCep(store, projectId, '');
      await audit(store, request, 'settings.changed', { setting: 'surveyGuide', kind: 'none' });
    }
    return reply.code(204).send();
  });

  // The PDF, for whoever holds its address (the project file, Collect Earth, the dashboard): no login, as a browser opens it
  app.get('/guide/:pid/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pid, token } = request.params as { pid: string; token: string };
    const notFound = () => reply.code(404).type('text/plain; charset=utf-8').send('This survey guide is not there any more.');
    if (!UUID.test(pid) || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) return notFound();
    const guide = await store.getSurveyGuide(pid);
    if (!guide || guide.kind !== 'file') return notFound();
    const given = Buffer.from(token);
    const kept = Buffer.from(guide.token);
    if (given.length !== kept.length || !timingSafeEqual(given, kept)) return notFound();
    const data = await store.getSurveyGuideFile(pid);
    if (!data) return notFound();
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${guide.filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(guide.filename)}`)
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .send(data);
  });
}
