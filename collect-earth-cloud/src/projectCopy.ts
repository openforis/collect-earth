import { fileKeyCount } from './rounds.js';
import type { Store } from './store/store.js';

/**
 * A new project made from another (a template): the same survey, project file (served and as
 * uploaded, with what the server did about round), plot files, progress and quality settings;
 * with `members`, also its people (same roles), whole-file assignments and divisions. Never its
 * records, decisions, notes, flags, checks drawn, reference plots or training sets, and the AI
 * assistant stays off (sending to it is each project's own choice). It
 * starts as a draft with `ownerId` as its coordinator. A copy that fails half way is deleted.
 */
export async function copyProject(store: Store, sourceId: string, input: { name: string; ownerId: string; members: boolean }): Promise<string> {
  const { projectId } = await store.createProject({ name: input.name, status: 'draft' });
  try {
    await store.addMembership(projectId, input.ownerId, 'admin');
    const source = await store.getProject(sourceId);
    if (source?.surveyUri && source.idmlBase64) {
      await store.setSurvey(projectId, source.surveyUri, source.surveyName, source.idmlBase64);
    }
    const [served, info, original] = await Promise.all([store.getCep(sourceId), store.getRoundInfo(sourceId), store.getOriginalCep(sourceId)]);
    if (served && info) {
      await store.putCep(projectId, served, info, original && !original.equals(served) ? original : null);
    }
    const ids = new Map<string, string>();
    const files = await store.listCsvFiles(sourceId);
    for (const file of files) {
      const full = await store.getCsvFile(sourceId, file.id);
      if (full) ids.set(file.id, (await store.putCsvFile(projectId, file.filename, full.data)).id);
    }
    // Plot files are counted with the survey's key columns, as their upload counted them.
    if (info && files.length > 0) await store.recountPlots(projectId, fileKeyCount(info));
    await store.setProgressSettings(projectId, await store.getProgressSettings(sourceId));
    await store.setQualitySettings(projectId, await store.getQualitySettings(sourceId));

    if (input.members) {
      for (const m of await store.listMembers(sourceId)) {
        if (m.userId !== input.ownerId) await store.addMembership(projectId, m.userId, m.role);
      }
      const assignments = (await store.listAssignments(sourceId)).filter((a) => ids.has(a.csvFileId));
      await store.setAssignments(projectId, assignments.map((a) => ({ userId: a.userId, csvFileId: ids.get(a.csvFileId)! })));
      // A division's plots as it dealt them: not the copies the check sampling drew or the reference plots' copies.
      const reference = new Set((await store.listReferencePlots(sourceId)).map((r) => `${r.csvFileId} ${r.plotKey}`));
      for (const file of files) {
        if (!file.distribution || !ids.has(file.id)) continue;
        const plots = (await store.listPlotAssignments(sourceId, file.id)).filter(
          (a) => a.sampledAt === undefined && !(a.overlap && reference.has(`${file.id} ${a.plotKey}`)),
        );
        await store.setDivision(projectId, ids.get(file.id)!, file.distribution, plots.map(({ plotKey, userId, overlap }) => ({ plotKey, userId, overlap })));
      }
    }
    await store.appendAudit(projectId, { actorUserId: input.ownerId, action: 'settings.changed', details: { setting: 'copy', from: source?.name ?? null } });
    return projectId;
  } catch (err) {
    await store.deleteProject(projectId);
    throw err;
  }
}
