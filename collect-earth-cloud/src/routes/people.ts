import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isTimeZone } from '../days.js';
import { fastSecondsOf, flagCountsOf } from '../flags.js';
import { peopleTable, personDetail, type PeopleInput } from '../people.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { ProjectStateCache, ServedState } from '../projectState.js';
import { remember, type QualityService } from '../qualityService.js';
import { sentBackTo } from '../sendBack.js';
import type { Store } from '../store/store.js';
import type { InviteSummary, MemberActivity } from '../types.js';

/** My work is worked out at most once in this long per person; asked again sooner, the last answer is given. */
export const MY_WORK_MIN_INTERVAL_MS = 5_000;
/** How many people's last My work answer are kept for that. */
const MAX_MY_WORK_ANSWERS = 1000;
/** The invitation links made for a member (to get the new project file) are found among this many latest invite.created entries. */
const INVITE_AUDIT_LOOKBACK = 500;

function timeZoneOf(request: FastifyRequest): string {
  const query = (request.query ?? {}) as { tz?: string };
  return isTimeZone(query.tz) ? query.tz : 'UTC';
}

/** The quality figures at hand (never computed here, never waited for); null when none or they cannot be had. */
async function peek(quality: QualityService, projectId: string, log: FastifyBaseLogger) {
  try {
    return await quality.peek(projectId, log);
  } catch (err) {
    log.warn({ err, projectId }, 'people: the quality figures could not be had');
    return null;
  }
}

/** invite id -> the member it was made for (invite.created with forUserId, from a person's page). */
export async function invitesFor(store: Store, projectId: string, invites: readonly InviteSummary[], usernames: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (invites.length === 0) return result;
  const open = new Set(invites.map((i) => i.id));
  const entries = await store.listAudit(projectId, { limit: INVITE_AUDIT_LOOKBACK, action: 'invite.created' });
  for (const e of entries) {
    const details = (e.details ?? {}) as { inviteId?: unknown; forUserId?: unknown };
    if (typeof details.inviteId === 'string' && open.has(details.inviteId) && typeof details.forUserId === 'string') {
      const name = usernames.get(details.forUserId);
      if (name !== undefined) result.set(details.inviteId, name);
    }
  }
  return result;
}

/**
 * The page's input: the project's state (ProjectStateCache: the plots and the records
 * resolved, kept between requests), then what is cheap and changes on its own clock,
 * read for each request: activity, settings, the project file's date, decisions, the
 * quality figures at hand, and (for coordinators) the open invitation links.
 */
export async function loadPeople(
  store: Store,
  quality: QualityService,
  served: ServedState,
  request: FastifyRequest,
  now: number,
  options: PeopleOptions,
): Promise<PeopleInput> {
  return loadPeopleFor(store, quality, served, { projectId: request.membership!.projectId, timeZone: timeZoneOf(request), log: request.log }, now, options);
}

export interface PeopleOptions {
  activityOf?: string;
  invites: boolean;
  flags?: boolean;
  sentBackOf?: string;
}

/** The same input for a project and time zone without a request (the email digests, Task 19). */
export async function loadPeopleFor(
  store: Store,
  quality: QualityService,
  served: ServedState,
  at: { projectId: string; timeZone: string; log: FastifyBaseLogger },
  now: number,
  options: PeopleOptions,
): Promise<PeopleInput> {
  const { projectId, log } = at;
  const { state, members } = served;
  const [settings, activity, invites, cep, decisions, figures, qualitySettings] = await Promise.all([
    store.getProgressSettings(projectId),
    store.listMemberActivity(projectId),
    options.invites ? store.listInvites(projectId, now) : Promise.resolve([] as InviteSummary[]),
    store.getCepInfo(projectId),
    store.listQualityDecisions(projectId),
    peek(quality, projectId, log),
    store.getQualitySettings(projectId),
  ]);
  const usernames = new Map(members.map((m) => [m.userId, m.username]));
  const inviteFor = options.invites ? await invitesFor(store, projectId, invites, usernames) : undefined;
  // A person's page: the plots sent back to them, as their "To check again" files hold them.
  const sentBackUser = options.sentBackOf !== undefined ? usernames.get(options.sentBackOf) : undefined;
  const sentBack =
    options.sentBackOf !== undefined && sentBackUser !== undefined
      ? (
          await sentBackTo(store, projectId, { userId: options.sentBackOf, username: sentBackUser }, {
            info: state.context.info,
            context: async () => state.context,
            outline: () => quality.outline(projectId, log),
          })
        ).plots
      : undefined;
  // My work: only the person's own activity is kept.
  const own: MemberActivity[] = options.activityOf === undefined ? activity : activity.filter((a) => a.userId === options.activityOf);
  return {
    now,
    timeZone: at.timeZone,
    settings,
    records: [],
    prepared: state.units,
    info: state.context.info,
    units: state.context.units,
    copyHolders: state.context.copyHolders,
    mainHolders: state.context.mainHolders,
    fileUnits: state.context.fileUnits,
    assignments: state.assignments,
    members,
    activity: own,
    invites,
    files: state.files,
    cep,
    quality: figures,
    decisions,
    inviteFor,
    fastSeconds: fastSecondsOf(qualitySettings),
    // The person page's flag counts: from the figures at hand, worked out only when asked.
    flagCounts:
      options.flags && figures
        ? (username) => flagCountsOf(figures, decisions, fastSecondsOf(qualitySettings), username)
        : undefined,
    sentBack,
  };
}

/** When the figures are older than the records: the time they are from (a newer state is being worked out). */
const asOf = (served: ServedState) => (served.stale ? served.state.builtAt : null);

/**
 * The People tab (monitoring Phase 3): `GET /people?tz=` (the table, the open invitation
 * links and the week) and `GET /people/:userId?tz=` (one person's page), for coordinators
 * only: reviewers and collectors get 403 (decision 3). `GET /my-work?tz=`: the same page
 * of the person asking, for any member signed in as a person (never anyone else's, and
 * nothing that tells which of their plots are quality checks).
 */
export async function registerPeopleRoutes(
  app: FastifyInstance,
  store: Store,
  quality: QualityService,
  states: ProjectStateCache,
  now: () => number = Date.now,
): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  const member = { preHandler: requireProjectMembership(store) };
  /** `${projectId} ${userId} ${tz}` -> the last My work answer and when it was made. */
  const myWork = new Map<string, { at: number; body: unknown }>();

  app.get('/v1/projects/:pid/people', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const at = now();
    const served = await states.get(projectId, request.log);
    const input = await loadPeople(store, quality, served, request, at, { invites: true });
    return reply.send({ ...peopleTable(input), asOf: asOf(served) });
  });

  app.get('/v1/projects/:pid/people/:userId', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const { userId } = request.params as { userId: string };
    const at = now();
    const served = await states.get(projectId, request.log);
    if (!served.members.some((m) => m.userId === userId)) {
      return reply.code(404).send({ error: 'not_found', reason: 'no such person in this project' });
    }
    const detail = personDetail(await loadPeople(store, quality, served, request, at, { invites: false, flags: true, sentBackOf: userId }), userId, { self: false });
    if (!detail) {
      return reply.code(404).send({ error: 'not_found', reason: 'no such person in this project' });
    }
    return reply.send({ ...detail, asOf: asOf(served) });
  });

  app.get('/v1/projects/:pid/my-work', member, async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId, userId } = request.membership!;
    if (!userId) {
      return reply.code(403).send({ error: 'forbidden', reason: 'My work needs a signed-in person, not a project token' });
    }
    const at = now();
    // Asked again within a few seconds (a reload, a page left open): the last answer.
    const key = `${projectId} ${userId} ${timeZoneOf(request)}`;
    const last = myWork.get(key);
    if (last && at - last.at < MY_WORK_MIN_INTERVAL_MS) {
      return reply.send(last.body);
    }
    const served = await states.get(projectId, request.log);
    const detail = personDetail(await loadPeople(store, quality, served, request, at, { activityOf: userId, invites: false, sentBackOf: userId }), userId, { self: true });
    if (!detail) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const body = { ...detail, asOf: asOf(served) };
    remember(myWork, key, { at, body }, MAX_MY_WORK_ANSWERS);
    return reply.send(body);
  });
}
