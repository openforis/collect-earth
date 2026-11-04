import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import { isPlotUnit } from '../progress.js';
import type { ProjectStateCache } from '../projectState.js';
import { recordResolver } from '../quality.js';
import type { Store } from '../store/store.js';
import { timeSpent, type TimedRecord } from '../timeSpent.js';
import type { RecordState } from '../types.js';

/**
 * The submitted first assessments of the files' plots (as progress counts them: no checks, no plot in no file), with
 * the active time each took.
 */
export function timedRecords(states: readonly RecordState[], context: Parameters<typeof recordResolver>[0]): TimedRecord[] {
  const resolve = recordResolver(context);
  const isPlot = isPlotUnit(context.info);
  const out: TimedRecord[] = [];
  for (const r of states) {
    if (r.deleted || !r.activelySaved) continue;
    const { unit, round } = resolve(r);
    if (unit === null || round.assessment !== 'main' || !isPlot(unit) || !context.units.has(unit)) continue;
    out.push({ plot: unit, operator: r.operator, seconds: r.activeSeconds ?? null, submittedAt: r.firstSubmittedOn ?? r.modifiedOn });
  }
  return out;
}

/**
 * `GET /v1/projects/:pid/time-spent?person=`: how long the interpreters take per plot (Collect Earth's active time),
 * and the plots done much quicker than the team usually takes. Coordinators only (decided by the owner): it names
 * people and is about how they work.
 */
export async function registerTimeSpentRoutes(app: FastifyInstance, store: Store, states: ProjectStateCache): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };
  app.get('/v1/projects/:pid/time-spent', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const query = (request.query ?? {}) as { person?: unknown };
    const person = typeof query.person === 'string' && query.person !== '' ? query.person : undefined;
    const [served, records] = await Promise.all([states.get(projectId, request.log), store.listRecordStates(projectId)]);
    const { context } = served.state;
    const timed = timedRecords(records, { info: context.info, units: context.units, copyHolders: context.copyHolders });
    return reply.send(timeSpent(timed, { person }));
  });
}
