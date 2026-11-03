import type { RoundInfo } from './cep.js';

/**
 * Plots, records and rounds: which plot (assignment unit) a record belongs to, and
 * which round it is. Pure functions on the RoundInfo of the served survey; a project
 * with no project file yet (null) behaves like an id-only survey.
 *
 * A record key is the survey's key values joined by "," (Collect Earth's
 * `String.join(",", getRootEntityKeyValues())`). The plot file has the same key
 * columns first, except the round the server added: that column is not in the
 * coordinator's file.
 */

/** The keys of the SERVED survey: how many, and where round is among them. */
export interface KeyShape {
  count: number;
  roundIndex: number | null;
}

export function keyShape(info: RoundInfo | null): KeyShape {
  if (!info) {
    return { count: 1, roundIndex: null };
  }
  // An unreadable survey has no keys, but its plots still have an id.
  const count = Math.max(1, info.keyCount);
  const roundIndex = info.state !== 'none' && info.roundIndex !== null && info.roundIndex < count ? info.roundIndex : null;
  return { count, roundIndex };
}

/** Columns of the UPLOADED plot file that form an assignment unit: added → count-1, else count. */
export function fileKeyCount(info: RoundInfo | null): number {
  const { count } = keyShape(info);
  return info?.state === 'added' ? Math.max(1, count - 1) : count;
}

/** Splits a key (record key, or a plot unit key from the file) into the plot and its round part. */
export function splitKey(key: string, parts: number, roundIndex: number | null): { plot: string; round: string | null } {
  const fields = key.split(',');
  if (roundIndex === null || roundIndex >= parts || roundIndex >= fields.length) {
    return { plot: key, round: null };
  }
  const round = fields[roundIndex];
  fields.splice(roundIndex, 1);
  return { plot: fields.join(','), round };
}

export type Assessment = 'main' | 'check' | 'other';

export interface RecordRound {
  plot: string;
  round: string;
  assessment: Assessment;
}

/**
 * The round of one record.
 * - round in the key: round = that part. With a reassessment code (always for added),
 *   check when it equals the code; else main for own (every other code), and for
 *   added main on "1" and other on anything else.
 * - no reassessment code (none, or own without one): told apart by the person. check
 *   when the operator holds the plot as a quality-check copy (overlap) in some divided
 *   file, else main; without round in the key, round is a virtual "1" or "2".
 *
 * `copyHolders` maps a plot unit key (as in the plot file) to the usernames that hold
 * it only as a quality-check copy. `unit` is the record's unit when the caller has
 * resolved it (unitOfRecord); otherwise the record key, its first key parts (a key
 * with more parts than the survey has keys) and its plot are tried.
 */
export function recordRound(
  r: { recordKey: string; operator: string },
  info: RoundInfo | null,
  copyHolders: ReadonlyMap<string, ReadonlySet<string>>,
  unit?: string | null,
): RecordRound {
  const shape = keyShape(info);
  const { plot, round } = splitKey(r.recordKey, shape.count, shape.roundIndex);
  const code = info?.reassessmentCode ?? null;
  if (round !== null && code !== null) {
    if (round === code) {
      return { plot, round, assessment: 'check' };
    }
    return { plot, round, assessment: info!.state === 'added' && round !== '1' ? 'other' : 'main' };
  }
  const candidates =
    unit !== undefined && unit !== null ? [unit] : [r.recordKey, leadingParts(r.recordKey, shape.count), plot];
  const isCopy = candidates.some((key) => key !== null && copyHolders.get(key)?.has(r.operator) === true);
  return { plot, round: round ?? (isCopy ? '2' : '1'), assessment: isCopy ? 'check' : 'main' };
}

/**
 * The other way round of a copyHolders map (unit -> usernames holding it as a copy):
 * username -> the units they hold as copies, for unitOfRecord's `copyUnits`.
 */
export function copyUnitsByUser(copyHolders: ReadonlyMap<string, ReadonlySet<string>>): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const [unit, users] of copyHolders) {
    for (const u of users) {
      let set = result.get(u);
      if (!set) {
        set = new Set();
        result.set(u, set);
      }
      set.add(unit);
    }
  }
  return result;
}

/**
 * Units of an own-round file by plot: plot → round → unit. Cached per units Set, so a
 * Set passed to unitOfRecord must not be changed afterwards (callers build a new one).
 */
type UnitIndex = Map<string, Map<string, string>>;
const unitIndexes = new WeakMap<ReadonlySet<string>, { shape: string; index: UnitIndex }>();

function unitIndex(units: ReadonlySet<string>, shape: KeyShape): UnitIndex {
  const id = `${shape.count}:${shape.roundIndex}`;
  const cached = unitIndexes.get(units);
  if (cached && cached.shape === id) {
    return cached.index;
  }
  const index: UnitIndex = new Map();
  for (const unit of units) {
    const { plot, round } = splitKey(unit, shape.count, shape.roundIndex);
    if (round === null) {
      continue;
    }
    let rounds = index.get(plot);
    if (!rounds) {
      rounds = new Map();
      index.set(plot, rounds);
    }
    if (!rounds.has(round)) {
      rounds.set(round, unit);
    }
  }
  unitIndexes.set(units, { shape: id, index });
  return index;
}

/** The first `count` parts of a key, when it has more (a data problem); else null. */
function leadingParts(key: string, count: number): string | null {
  const fields = key.split(',');
  return fields.length > count ? fields.slice(0, count).join(',') : null;
}

/**
 * The plot unit (a plot id as in the plot file) a record belongs to, or null. The
 * match is exact: "17" never catches "170,1" or "17x". A record key with more parts
 * than the survey has keys is matched by its first ones.
 * - units without a round part (added, none): the record's plot.
 * - units with one (own): the same key, or else the unit of the same plot whose round
 *   is the record's. A check record (the reassessment code) matches the unit of the
 *   same plot with any round: the served copy had its round replaced. When the plot
 *   has several, it is the one the operator holds as a copy (`copyUnits`, the units
 *   they hold as quality-check copies), else the first in the file.
 */
export function unitOfRecord(
  recordKey: string,
  units: ReadonlySet<string>,
  info: RoundInfo | null,
  copyUnits?: ReadonlySet<string>,
): string | null {
  const shape = keyShape(info);
  if (info?.state !== 'own' || shape.roundIndex === null) {
    const { plot } = splitKey(recordKey, shape.count, shape.roundIndex);
    if (units.has(plot)) {
      return plot;
    }
    const leading = leadingParts(recordKey, shape.count);
    if (leading === null) {
      return null;
    }
    const lead = splitKey(leading, shape.count, shape.roundIndex).plot;
    return units.has(lead) ? lead : null;
  }
  if (units.has(recordKey)) {
    return recordKey;
  }
  const key = leadingParts(recordKey, shape.count) ?? recordKey;
  if (units.has(key)) {
    return key;
  }
  const { plot, round } = splitKey(key, shape.count, shape.roundIndex);
  if (round === null) {
    return null;
  }
  const rounds = unitIndex(units, shape).get(plot);
  if (!rounds) {
    return null;
  }
  const same = rounds.get(round);
  if (same !== undefined) {
    return same;
  }
  if (round === info.reassessmentCode) {
    if (copyUnits) {
      for (const candidate of rounds.values()) {
        if (copyUnits.has(candidate)) {
          return candidate;
        }
      }
    }
    return rounds.values().next().value ?? null;
  }
  return null;
}

/**
 * The record keys a plot unit (a plot id as in the plot file) can have, so that one plot's
 * records are read without reading the others (the plot page). The inverse of unitOfRecord
 * for keys of the survey's shape (a key with more parts than the survey has keys, a data
 * problem, is not found this way):
 * - no round in the key: the unit itself, for the first assessment and the copies alike;
 * - the round the server added (the unit has no round part): the unit with each round code
 *   put back in its place, "1" and the reassessment code first;
 * - an own round (the unit has its round part): the unit, and the same plot with the
 *   reassessment code (its check, whose served copy had its round replaced).
 * The records read must still be resolved (recordResolver): a check of an own round goes
 * to one of the plot's units only.
 */
export function recordKeysOfUnit(unit: string, info: RoundInfo | null): string[] {
  const shape = keyShape(info);
  if (!info || shape.roundIndex === null) {
    return [unit];
  }
  const code = info.reassessmentCode;
  if (info.state === 'added') {
    const fields = unit.split(',');
    if (shape.roundIndex > fields.length) return [unit];
    const codes = [...new Set(['1', ...(code !== null ? [code] : []), ...info.roundCodes.map((c) => c.code)])];
    return codes.map((round) => {
      const parts = [...fields];
      parts.splice(shape.roundIndex!, 0, round);
      return parts.join(',');
    });
  }
  const { plot, round } = splitKey(unit, shape.count, shape.roundIndex);
  if (round === null || code === null || round === code) {
    return [unit];
  }
  const parts = plot.split(',');
  parts.splice(shape.roundIndex, 0, code);
  return [unit, parts.join(',')];
}
