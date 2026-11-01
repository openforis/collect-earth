import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isTimeZone } from '../days.js';
import { peopleTable, personDetail, type PeopleInput } from '../people.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { loadPlotContext, type QualityService } from '../qualityService.js';
import type { Store } from '../store/store.js';

/**
 * Everything the People tab works from, read once per request: the records' states (no
 * answers), the plot files and who holds what, the members, their activity, the open
 * invitation links, the project file's date, and the quality figures this server has
 * at hand (QualityService.peek: never computed for these pages, never waited for).
 */
async function loadPeople(store: Store, quality: QualityService, request: FastifyRequest, now: number): Promise<PeopleInput> {
  const projectId = request.membership!.projectId;
  const query = (request.query ?? {}) as { tz?: string };
  const timeZone = isTimeZone(query.tz) ? query.tz : 'UTC';
  const [info, files, members] = await Promise.all([store.getRoundInfo(projectId), store.listCsvFiles(projectId), store.listMembers(projectId)]);
  const [records, context, assignments, settings, activity, invites, cep, decisions, served] = await Promise.all([
    store.listRecordStates(projectId),
    loadPlotContext(store, projectId, request.log, { info, files, members }),
    store.listAssignments(projectId),
    store.getProgressSettings(projectId),
    store.listMemberActivity(projectId),
    store.listInvites(projectId, now),
    store.getCepInfo(projectId),
    store.listQualityDecisions(projectId),
    quality.peek(projectId, request.log).catch((err: unknown) => {
      request.log.warn({ err, projectId }, 'people: the quality figures could not be had');
      return null;
    }),
  ]);
  return {
    now,
    timeZone,
    settings,
    records,
    info: context.info,
    units: context.units,
    copyHolders: context.copyHolders,
    mainHolders: context.mainHolders,
    fileUnits: context.fileUnits,
    assignments,
    members,
    activity,
    invites,
    files,
    cep,
    quality: served,
    decisions,
  };
}

/**
 * The People tab (monitoring Phase 3): `GET /people?tz=` (the table, the open invitation
 * links and the week) and `GET /people/:userId?tz=` (one person's page), for coordinators
 * only: reviewers and collectors get 403 (decision 3). `GET /my-work?tz=`: the same page
 * of the person asking, for any member signed in as a person (never anyone else's).
 */
export async function registerPeopleRoutes(app: FastifyInstance, store: Store, quality: QualityService, now: () => number = Date.now): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const member = { preHandler: requireProjectMembership(store) };

  app.get('/v1/projects/:pid/people', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(peopleTable(await loadPeople(store, quality, request, now())));
  });

  app.get('/v1/projects/:pid/people/:userId', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.params as { userId: string };
    const detail = personDetail(await loadPeople(store, quality, request, now()), userId, { self: false });
    if (!detail) {
      return reply.code(404).send({ error: 'not_found', reason: 'no such person in this project' });
    }
    return reply.send(detail);
  });

  app.get('/v1/projects/:pid/my-work', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const { userId } = request.membership!;
    if (!userId) {
      return reply.code(403).send({ error: 'forbidden', reason: 'My work needs a signed-in person, not a project token' });
    }
    const detail = personDetail(await loadPeople(store, quality, request, now()), userId, { self: true });
    if (!detail) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send(detail);
  });
}
