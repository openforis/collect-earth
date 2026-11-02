import { createHash } from 'node:crypto';
import type { RoundInfo } from './cep.js';
import { answerDigests, assessesPlot, countsAsSavedAgain } from './flags.js';
import { recordResolver } from './quality.js';
import type { PlotContext } from './qualityService.js';
import { recordKeysOfUnit } from './rounds.js';
import type { Store } from './store/store.js';
import type { Question } from './surveyOutline.js';
import type { CsvFile, QualityDecision, RecordRow } from './types.js';

/**
 * Send back for another look (Task 12). A plot decided "both need another look" (`recheck`)
 * goes back to everyone who made a record of it (its first assessment and its checks, drafts
 * too: assessesPlot, the rule of the figures' saved records): each gets it in a generated plot
 * file "To check again – <file>" in my-assignment, holding only their own plots sent back, with
 * the round column of their own record (a check stays a check, so it stays blind and its key
 * the same). A person's plot leaves their file once they submit it again
 * (countsAsSavedAgain, the review queue's rule), and every plot leaves when the decision is
 * undone or changed. Nothing is stored: it is all worked out from the decisions and the records.
 *
 * The file name says "again", true for both: nothing in it tells a check from a plot.
 */

/** The start of a generated file's name; the en dash as in the plan ("To check again – north.csv"). */
export const RECHECK_FILE_PREFIX = 'To check again – ';

/** The name of the generated file of the plots of plot file `filename` sent back. */
export function recheckFilename(filename: string): string {
  return `${RECHECK_FILE_PREFIX}${filename}`;
}

/**
 * The generated file's id: a UUID worked out from its plot file's id (the same for everyone and
 * on every call), so Collect Earth sees one file under one id and name while it has plots.
 */
export function recheckFileId(csvFileId: string): string {
  const h = createHash('sha256').update(`collect-earth-cloud:to-check-again:${csvFileId}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** One plot sent back to a person. */
export interface SentBackPlot {
  /** The plot (unit) as the decisions key it. */
  plot: string;
  comment: string | null;
  decidedAt: number;
  decidedBy: string | null;
  /**
   * Which of their records it is: the first assessment ('main') or a check. Only to build the
   * round column: never sent to a collector (checks are blind).
   */
  assessment: 'main' | 'check';
  /** They submitted it again since the decision (it has left their file). */
  submittedAgain: boolean;
  /** The plot file it is served from (null: in no plot file, or submitted again). */
  sourceFileId: string | null;
  /** The generated file it is in while waiting (recheckFilename of the source), else null. */
  file: string | null;
}

/** A generated "To check again" file of one person: its plots, from one plot file. */
export interface RecheckFile {
  /** recheckFileId(sourceFileId). */
  id: string;
  filename: string;
  sourceFileId: string;
  /** The plots (units) in it. */
  plots: Set<string>;
  /** Those of them that are their checks (the round column of a check). */
  checks: Set<string>;
}

type ResolverContext = Pick<PlotContext, 'info' | 'units' | 'copyHolders'>;

/**
 * The plots sent back to one person (pure): the recheck decisions whose plot has a record of
 * theirs (not deleted, of a known round, first assessment or check), each with whether they
 * submitted it again since. `records` are the records of those plots (anyone's), as read by
 * their keys. Newest decision first.
 */
export function sentBackOf(input: {
  username: string;
  decisions: readonly QualityDecision[];
  records: readonly RecordRow[];
  context: ResolverContext;
  outline: ReadonlyMap<string, Question> | null;
}): Omit<SentBackPlot, 'sourceFileId' | 'file'>[] {
  const rechecks = new Map(input.decisions.filter((d) => d.decision === 'recheck').map((d) => [d.plot, d]));
  if (rechecks.size === 0) return [];
  const mine = input.records.filter((r) => r.operator === input.username);
  if (mine.length === 0) return [];
  const resolve = recordResolver(input.context);
  const digest = answerDigests(input.outline, mine);
  const byPlot = new Map<string, { main: boolean; again: boolean }>();
  for (const r of mine) {
    const { round, group } = resolve(r);
    const d = rechecks.get(group);
    if (!d || !assessesPlot(r, round.assessment)) continue;
    const { hash, full } = digest(r.summary);
    const again = countsAsSavedAgain({ operator: r.operator, time: r.modifiedOn, received: r.receivedAt, hash, full, submitted: r.activelySaved }, d, true);
    const seen = byPlot.get(group) ?? { main: false, again: false };
    byPlot.set(group, { main: seen.main || round.assessment === 'main', again: seen.again || again });
  }
  return [...byPlot]
    .map(([plot, p]) => {
      const d = rechecks.get(plot)!;
      return {
        plot,
        comment: d.comment,
        decidedAt: d.decidedAt,
        decidedBy: d.decidedBy,
        assessment: p.main ? ('main' as const) : ('check' as const),
        submittedAgain: p.again,
      };
    })
    .sort((a, b) => b.decidedAt - a.decidedAt || (a.plot < b.plot ? -1 : a.plot > b.plot ? 1 : 0));
}

/**
 * Where each plot waiting is served from (pure): the first plot file (in the files' order) in
 * which the person holds it (a whole file given to them, or a holding of a divided one), else
 * the first plot file that has it; then one generated file per plot file. Plots in no plot file
 * and plots submitted again are in none.
 */
export function recheckFilesOf(
  plots: readonly Omit<SentBackPlot, 'sourceFileId' | 'file'>[],
  files: readonly Pick<CsvFile, 'id' | 'filename'>[],
  fileUnits: ReadonlyMap<string, readonly string[]>,
  held: (csvFileId: string, plot: string) => boolean,
): { plots: SentBackPlot[]; files: RecheckFile[] } {
  const waiting = new Set(plots.filter((p) => !p.submittedAgain).map((p) => p.plot));
  // plot -> the files that have it, in the files' order.
  const inFiles = new Map<string, string[]>();
  if (waiting.size > 0) {
    for (const f of files) {
      for (const unit of fileUnits.get(f.id) ?? []) {
        if (!waiting.has(unit)) continue;
        const list = inFiles.get(unit);
        if (!list) inFiles.set(unit, [f.id]);
        else if (list[list.length - 1] !== f.id) list.push(f.id);
      }
    }
  }
  const names = new Map(files.map((f) => [f.id, f.filename]));
  const out = new Map<string, RecheckFile>();
  const listed: SentBackPlot[] = plots.map((p) => {
    const candidates = p.submittedAgain ? [] : (inFiles.get(p.plot) ?? []);
    const source = candidates.find((id) => held(id, p.plot)) ?? candidates[0] ?? null;
    if (source === null) return { ...p, sourceFileId: null, file: null };
    let file = out.get(source);
    if (!file) {
      file = { id: recheckFileId(source), filename: recheckFilename(names.get(source)!), sourceFileId: source, plots: new Set(), checks: new Set() };
      out.set(source, file);
    }
    file.plots.add(p.plot);
    if (p.assessment === 'check') file.checks.add(p.plot);
    return { ...p, sourceFileId: source, file: file.filename };
  });
  // In the plot files' order, so the list Collect Earth shows does not move.
  const order = new Map(files.map((f, i) => [f.id, i]));
  return { plots: listed, files: [...out.values()].sort((a, b) => order.get(a.sourceFileId)! - order.get(b.sourceFileId)!) };
}

/** What sentBackTo reads besides the store: the plot files' plots (loaded only when needed) and the survey's outline. */
export interface SentBackDeps {
  context: () => Promise<PlotContext>;
  outline: () => Promise<ReadonlyMap<string, Question> | null>;
  /** The round info, when the caller has it already. */
  info?: RoundInfo | null;
}

/**
 * The plots sent back to one member and their "To check again" files. Reads the decisions, then
 * only the records of the plots decided recheck (by their keys); the plot files' plots and the
 * person's holdings only when some of those records are theirs.
 */
export async function sentBackTo(
  store: Store,
  projectId: string,
  user: { userId: string; username: string },
  deps: SentBackDeps,
): Promise<{ plots: SentBackPlot[]; files: RecheckFile[] }> {
  const none = { plots: [], files: [] };
  const decisions = (await store.listQualityDecisions(projectId)).filter((d) => d.decision === 'recheck');
  if (decisions.length === 0) return none;
  const info = deps.info !== undefined ? deps.info : await store.getRoundInfo(projectId);
  const keys = [...new Set(decisions.flatMap((d) => recordKeysOfUnit(d.plot, info)))];
  const records = await store.listRecordsByKeys(projectId, keys);
  if (!records.some((r) => r.operator === user.username)) return none;
  const [context, outline, files, wholeFiles, holdings] = await Promise.all([
    deps.context(),
    deps.outline(),
    store.listCsvFiles(projectId),
    store.listAssignmentsForUser(projectId, user.userId),
    store.listPlotHoldings(projectId, user.userId),
  ]);
  const plots = sentBackOf({ username: user.username, decisions, records, context, outline });
  if (plots.length === 0) return none;
  const whole = new Set(wholeFiles.map((f) => f.id));
  const divided = new Map(holdings.map((h) => [h.csvFileId, new Set(h.plotKeys)]));
  return recheckFilesOf(plots, files, context.fileUnits, (csvFileId, plot) => whole.has(csvFileId) || divided.get(csvFileId)?.has(plot) === true);
}
