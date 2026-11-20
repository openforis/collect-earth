import type { Assignment, CsvFile, Member } from "./api";

// The plot-file / person checkbox grid: which boxes are ticked, and back.

export const pairKey = (csvFileId: string, userId: string) => `${csvFileId}\u0000${userId}`;

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
