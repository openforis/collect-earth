import type { Assignment, CsvFile, Member } from "./api";

// The plot-file / person checkbox grid: which boxes are ticked, and back.

export const pairKey = (csvFileId: string, userId: string) => `${csvFileId}\u0000${userId}`;

/** The set of ticked boxes for an assignment list. */
export function toPairs(assignments: Assignment[]): Set<string> {
  return new Set(assignments.map((a) => pairKey(a.csvFileId, a.userId)));
}

/** The assignment list for the ticked boxes, keeping only files and people that still exist. */
export function fromPairs(pairs: Set<string>, files: CsvFile[], people: Member[]): Assignment[] {
  const result: Assignment[] = [];
  for (const file of files) {
    for (const person of people) {
      if (pairs.has(pairKey(file.id, person.userId))) result.push({ userId: person.userId, csvFileId: file.id });
    }
  }
  return result;
}

/** True when the ticked boxes differ from what is saved. */
export function hasChanges(pairs: Set<string>, saved: Set<string>): boolean {
  if (pairs.size !== saved.size) return true;
  for (const key of pairs) if (!saved.has(key)) return true;
  return false;
}
