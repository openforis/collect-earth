// A project that started standalone moves to the cloud: its coordinator uploads the Collect Earth backup (the
// desktop's Data export "ZIP (compressed XML)") and its records become the project's, stored as a sync stores them
// (last write wins, so a newer record in the project is kept; record events), each under its operator, with its
// step and submitted state. Coordinators only; nothing is stored by the preview.
//
// - POST /v1/projects/:pid/records/import/preview (zip body) -> counts, operators, problems
// - POST /v1/projects/:pid/records/import (zip body) -> { stored, kept, ... }
// Both take `?operators={"Anna Perez":"anna"}`: the account to keep an operator's records under (it becomes a member,
// as the CEO import does with the accounts the coordinator names). An operator not named keeps the name Collect Earth
// wrote, as a sync with a project token keeps it.
import type { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify';
import { audit } from '../activity.js';
import { CepError, readCep } from '../cep.js';
import { BackupImportError, backupReader, readBackup, surveyUriOf, type ImportedRecord } from '../collectImport.js';
import { checkUploadFits } from '../limits.js';
import { applyLww, recordEventOf } from '../lww.js';
import { requireProjectMembership } from '../plugins/projectAuth.js';
import type { Store } from '../store/store.js';
import type { RecordEnvelope } from '../types.js';

const MAX_PROBLEMS = 20;

interface Prepared {
  records: ImportedRecord[];
  problems: string[];
  problemCount: number;
  existing: Map<string, number>;
  operators: { name: string; username: string; records: number; member: boolean }[];
  /** Accounts named for operators that are not members yet. */
  newMembers: string[];
}

const id = (recordKey: string, operator: string) => `${recordKey}\u0000${operator}`;

/** The backup read against the project, or null when the reply already refuses it. */
async function prepare(store: Store, request: FastifyRequest, reply: FastifyReply): Promise<Prepared | null> {
  const projectId = request.membership!.projectId;
  const zip = request.body;
  if (!Buffer.isBuffer(zip) || zip.length === 0) {
    void reply.code(400).send({ error: 'bad_request', reason: 'expected the backup zip as the body' });
    return null;
  }
  const cep = await store.getCep(projectId);
  if (!cep) {
    void reply.code(409).send({ error: 'no_project_file', reason: 'Upload the project file first: the records are read with its survey.' });
    return null;
  }
  const served = readCep(cep);
  const servedSurvey = new TextDecoder().decode(served.entries.get(served.surveyPath)!);
  let backup: ReturnType<typeof readBackup>;
  let backupUri: string | null;
  try {
    backup = readBackup(zip);
    backupUri = surveyUriOf(backup.surveyXml);
  } catch (e) {
    if (e instanceof BackupImportError || e instanceof CepError) {
      void reply.code(400).send({ error: 'backup_unreadable', reason: e instanceof CepError ? "The backup's idml.xml cannot be read." : e.message });
      return null;
    }
    throw e;
  }
  const projectUri = surveyUriOf(servedSurvey);
  if (backupUri !== projectUri) {
    void reply.code(400).send({
      error: 'survey_mismatch',
      reason: `This backup is of another survey (${backupUri ?? 'none'}) than this project's (${projectUri ?? 'none'}): export the data of this project's survey in Collect Earth.`,
    });
    return null;
  }

  // The accounts the coordinator named, checked before anything is read further
  let named: Record<string, unknown> = {};
  const raw = (request.query as { operators?: unknown }).operators;
  if (typeof raw === 'string' && raw !== '') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) named = parsed as Record<string, unknown>;
    } catch {
      /* refused below */
    }
    if (Object.keys(named).length === 0 && raw !== '{}') {
      void reply.code(400).send({ error: 'bad_request', reason: 'operators must be a JSON object of operator name to username' });
      return null;
    }
  }
  const members = new Set((await store.listMembers(projectId)).map((m) => m.username));
  const accountOf = new Map<string, string>();
  for (const [name, value] of Object.entries(named)) {
    const username = typeof value === 'string' ? value.trim() : '';
    if (!username) continue;
    const account = await store.getUserByUsername(username);
    if (!account || account.disabledAt) {
      void reply.code(400).send({ error: 'unknown_account', reason: `No account "${username}" can take the records of "${name}" on this server.`, username });
      return null;
    }
    accountOf.set(name, account.username);
  }

  const read = backupReader(servedSurvey, await store.getRoundInfo(projectId));
  const records: ImportedRecord[] = [];
  const problems: string[] = [];
  let problemCount = 0;
  const byOperator = new Map<string, { username: string; records: number }>();
  for (const file of backup.files) {
    const r = read(file);
    if ('problem' in r) {
      problemCount++;
      if (problems.length < MAX_PROBLEMS) problems.push(r.problem);
      continue;
    }
    const username = accountOf.get(r.operator) ?? r.operator;
    const seen = byOperator.get(r.operator) ?? { username, records: 0 };
    seen.records++;
    byOperator.set(r.operator, seen);
    // its parsed nodes are not kept: every record is held until stored
    const { children: _children, keyValues: _keyValues, ...record } = r;
    records.push({ ...record, operator: username });
  }
  const existing = new Map<string, number>();
  for (const s of await store.listRecordStates(projectId)) existing.set(id(s.recordKey, s.operator), s.modifiedOn);
  const operators = [...byOperator].map(([name, o]) => ({ name, username: o.username, records: o.records, member: members.has(o.username) }));
  return { records, problems, problemCount, existing, operators, newMembers: [...new Set(operators.filter((o) => !o.member && accountOf.has(o.name)).map((o) => o.username))] };
}

/** What the coordinator sees before importing: nothing stored. */
function counts(p: Prepared) {
  let newerThere = 0;
  let olderThere = 0;
  for (const r of p.records) {
    const there = p.existing.get(id(r.recordKey, r.operator));
    if (there === undefined) continue;
    if (r.modifiedOn !== null && there > r.modifiedOn) newerThere++;
    else olderThere++;
  }
  const submitted = p.records.filter((r) => r.activelySaved).length;
  return {
    records: p.records.length,
    submitted,
    drafts: p.records.length - submitted,
    newRecords: p.records.length - newerThere - olderThere,
    newerThere,
    olderThere,
    operators: p.operators,
    problems: p.problems,
    problemCount: p.problemCount,
  };
}

export async function registerCollectImportRoutes(app: FastifyInstance, store: Store): Promise<void> {
  const admin = { preHandler: requireProjectMembership(store, 'admin') };

  app.post('/v1/projects/:pid/records/import/preview', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const prepared = await prepare(store, request, reply);
    if (!prepared) return reply;
    return reply.send(counts(prepared));
  });

  app.post('/v1/projects/:pid/records/import', admin, async (request: FastifyRequest, reply: FastifyReply) => {
    const projectId = request.membership!.projectId;
    const prepared = await prepare(store, request, reply);
    if (!prepared) return reply;
    const bytes = prepared.records.reduce((n, r) => n + Buffer.byteLength(r.xml) + Buffer.byteLength(JSON.stringify(r.summary)), 0);
    const over = await checkUploadFits(store, projectId, { kind: 'records' }, bytes);
    if (over) return reply.code(413).send(over);
    for (const username of prepared.newMembers) {
      const account = await store.getUserByUsername(username);
      if (account) await store.addMembership(projectId, account.id, 'operator');
    }
    let stored = 0;
    for (const r of prepared.records) {
      const envelope: RecordEnvelope = { recordKey: r.recordKey, surveyUri: '', operator: r.operator, modifiedOn: r.modifiedOn, activelySaved: r.activelySaved,
        step: r.step, xml: r.xml, summary: r.summary, deleted: false, payloadVersion: 1, activeSeconds: null };
      const kept = await store.putRecordWithEvent(projectId, r.recordKey, r.operator, (existing, submittedBefore) => {
        // Received when it was saved: it did not come late (the Progress tab's "work that arrives late")
        const { row, status } = applyLww(envelope, existing, r.modifiedOn ?? Date.now());
        if (status !== 'stored') return null;
        const next = { ...row, projectId };
        return { row: next, event: recordEventOf(existing, next, submittedBefore) };
      });
      if (kept) stored++;
    }
    const result = { ...counts(prepared), stored, kept: prepared.records.length - stored };
    await audit(store, request, 'project.imported', { source: 'collect-earth', records: stored, kept: result.kept, problems: prepared.problemCount, operators: prepared.operators.length });
    request.log.info({ projectId, stored, kept: result.kept }, 'records imported from a Collect Earth backup');
    return reply.send(result);
  });
}
