// The names on the project's plots that are nobody in it (People, coordinators; FormerMembers.tsx): the names typed in
// Collect Earth, which can be given to a person, apart from the people who left, which can only be anonymised.
import type { FormerMember, Member } from "./api";

export interface FormerMembersView {
  /** Names typed in Collect Earth (a backup, a CEO project, an older Collect Earth): give to someone, or anonymise */
  typed: FormerMember[];
  /** Accounts that left the project: anonymise */
  left: FormerMember[];
  /** Already former-member-N */
  anonymized: FormerMember[];
}

export function formerMembersView(list: readonly FormerMember[]): FormerMembersView {
  const byRecords = (a: FormerMember, b: FormerMember) => b.records - a.records || a.operator.localeCompare(b.operator);
  return {
    typed: list.filter((f) => f.typed && !f.anonymized).sort(byRecords),
    left: list.filter((f) => !f.typed && !f.anonymized),
    anonymized: list.filter((f) => f.anonymized),
  };
}

/**
 * Whom a typed name can be given to: the people of the project who collect first (the usual owner of a typed name),
 * then the others; the one whose username is the typed name in other letters ("Marta", marta) first of all, as it is
 * most likely theirs. Disabled accounts are left out.
 */
export function giveCandidates(members: readonly Member[], typedName: string): Member[] {
  const rank = (m: Member) => (m.username.toLowerCase() === typedName.trim().toLowerCase() ? 0 : m.role === "operator" ? 1 : 2);
  return members.filter((m) => !m.disabled).sort((a, b) => rank(a) - rank(b) || a.username.localeCompare(b.username));
}

/**
 * The names older Collect Earth versions gave when nobody typed one: several people may be behind such a name, so
 * giving all its plots to one person is warned about.
 */
const DEFAULT_NAMES = ["collect earth user"];
export function isDefaultName(name: string): boolean {
  return DEFAULT_NAMES.includes(name.trim().toLowerCase());
}
