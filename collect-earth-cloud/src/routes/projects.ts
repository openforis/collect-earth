import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Store } from '../store/store.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';

interface SurveyBody {
  surveyUri?: string;
  surveyName?: string;
  idmlBase64?: string;
}

/** Project provisioning, ping/metadata, and survey-definition upload. */
export async function registerProjectRoutes(
  app: FastifyInstance,
  store: Store,
  config: Config,
): Promise<void> {
  // Provisioning. In the hosted model the platform operator calls this; guarded by
  // x-admin-key when ADMIN_API_KEY is configured. Not a project-scoped route.
  app.post('/v1/projects', async (request: FastifyRequest, reply: FastifyReply) => {
    if (config.adminApiKey) {
      const provided = request.headers['x-admin-key'];
      if (provided !== config.adminApiKey) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    }
    const body = (request.body ?? {}) as { name?: string };
    const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : 'Untitled project';
    const result = await store.createProject({ name });
    return reply.code(201).send(result);
  });

  // Ping / metadata — used by the desktop "Test connection" button and by clients
  // to confirm the token before syncing.
  app.get(
    '/v1/projects/:pid',
    { preHandler: requireProjectMembership(store) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectId = request.membership!.projectId;
      const project = await store.getProject(projectId);
      if (!project) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.send({
        projectId: project.projectId,
        name: project.name,
        surveyUri: project.surveyUri,
        surveyName: project.surveyName,
        hasSurvey: project.idmlBase64 !== null,
        role: request.membership!.role,
      });
    },
  );

  // Survey definition upload (admin only). Body: { surveyUri, surveyName?, idmlBase64 }.
  app.put(
    '/v1/projects/:pid/survey',
    { preHandler: requireProjectMembership(store, 'admin') },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as SurveyBody;
      if (!body.surveyUri || !body.idmlBase64) {
        return reply.code(400).send({ error: 'bad_request', reason: 'surveyUri and idmlBase64 are required' });
      }
      await store.setSurvey(
        request.membership!.projectId,
        body.surveyUri,
        body.surveyName ?? null,
        body.idmlBase64,
      );
      return reply.send({ ok: true });
    },
  );
}
