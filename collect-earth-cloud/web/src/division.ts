import type { CsvColumn, CsvColumns, Distribution, DivisionOrder, Member, NearbyInfo } from "./api";
import type { MessageKey, Translate } from "./i18n";

// The "divide the plots of a file" form: its state, from and to what the server
// stores, and what is missing before it can be sent. Kept apart from the React code
// so it can be tested.

export type DivisionMode = "whole" | "even" | "column";

export interface DivisionForm {
  mode: DivisionMode;
  /** Evenly: the people who share the plots. */
  people: string[];
  /** By a column: the column (0-based) and who collects each of its values. */
  column: number | null;
  groups: Record<string, string[]>;
  order: DivisionOrder;
  /** Quality check: also give a share of each person's plots to a second person. */
  overlap: boolean;
  /** As typed, so a half-typed number can be shown and checked. */
  overlapPercent: string;
}

export const DEFAULT_OVERLAP_PERCENT = 10;
export const MIN_OVERLAP_PERCENT = 5;
export const MAX_OVERLAP_PERCENT = 50;

/** Collectors and reviewers first (coordinators normally do not collect), then by name. */
export function sortPeople(members: Member[]): Member[] {
  return [...members].sort((a, b) => Number(a.role === "admin") - Number(b.role === "admin") || a.username.localeCompare(b.username));
}

/** The people who normally collect: collectors and reviewers, or everyone when there are none. */
export function collectors(members: Member[]): Member[] {
  const people = sortPeople(members).filter((m) => m.role !== "admin");
  return people.length > 0 ? people : sortPeople(members);
}

/**
 * The form for what the file has now. `holders` are the people who hold plots now:
 * they are ticked when the form starts on "Evenly" without a saved list of people.
 */
export function initialForm(distribution: Distribution | null, holders: string[], members: Member[]): DivisionForm {
  const ids = new Set(members.map((m) => m.userId));
  const known = (people: string[]) => people.filter((id) => ids.has(id));
  const startPeople = known(holders).length > 0 ? known(holders) : collectors(members).map((m) => m.userId);
  const form: DivisionForm = {
    mode: "whole",
    people: startPeople,
    column: null,
    groups: {},
    order: "file",
    overlap: false,
    overlapPercent: String(DEFAULT_OVERLAP_PERCENT),
  };
  if (!distribution || distribution.mode === "whole") return form;
  // Plots moved by hand: there is no rule to show, so start from an even division between the same people.
  // After a division by place, the same order (the served files keep it).
  if (distribution.mode === "manual") return { ...form, mode: "even", order: distribution.order ?? form.order };
  const overlap = (distribution.overlapPercent ?? 0) > 0;
  const common = {
    order: distribution.order,
    overlap,
    overlapPercent: String(overlap ? distribution.overlapPercent : DEFAULT_OVERLAP_PERCENT),
  };
  if (distribution.mode === "even") return { ...form, ...common, mode: "even", people: known(distribution.people) };
  const groups: Record<string, string[]> = {};
  for (const group of distribution.groups) {
    const people = known(group.people);
    if (people.length > 0) groups[group.value] = people;
  }
  return { ...form, ...common, mode: "column", column: distribution.column, groups };
}

/** A column has few enough different values to divide by. */
export function columnUsable(column: CsvColumn): boolean {
  return column.values !== null && column.values.length > 0;
}

/** "province (e.g. La Paz, Oruro)" or, without a header, "Column 5 (e.g. La Paz, Oruro)". */
export function columnLabel(column: CsvColumn, t: Translate): string {
  const label = column.name?.trim() || t("divide.columnN", { n: column.index + 1 });
  const examples = (column.values ?? [])
    .map((v) => v.value)
    .filter((v) => v.trim() !== "")
    .slice(0, 3);
  return examples.length > 0 ? t("divide.columnExamples", { label, examples: examples.join(", ") }) : label;
}

/** "Give every value to one person, in turn": the first value to the first person, and so on. */
export function giveInTurn(values: string[], people: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  if (people.length === 0) return groups;
  values.forEach((value, i) => {
    groups[value] = [people[i % people.length]];
  });
  return groups;
}

function percent(form: DivisionForm): number | null {
  const text = form.overlapPercent.trim();
  const n = Number(text);
  return text !== "" && Number.isInteger(n) && n >= MIN_OVERLAP_PERCENT && n <= MAX_OVERLAP_PERCENT ? n : null;
}

/** The selected column, when it can be used. */
function selectedColumn(form: DivisionForm, columns: CsvColumns | null): CsvColumn | null {
  const column = columns?.columns.find((c) => c.index === form.column) ?? null;
  return column && columnUsable(column) ? column : null;
}

/** The groups to send: values of the column that someone collects, in the column's order. */
function groupsToSend(form: DivisionForm, columns: CsvColumns | null): { value: string; people: string[] }[] {
  const column = selectedColumn(form, columns);
  if (!column) return [];
  return (column.values ?? [])
    .map((v) => ({ value: v.value, people: form.groups[v.value] ?? [] }))
    .filter((g) => g.people.length > 0);
}

/** Everyone who would get plots (for the "at least two people to compare" rule). */
function everyone(form: DivisionForm, columns: CsvColumns | null): Set<string> {
  if (form.mode === "even") return new Set(form.people);
  return new Set(groupsToSend(form, columns).flatMap((g) => g.people));
}

/** What still has to be chosen before the form can be sent; null when it is complete. */
export function formProblem(form: DivisionForm, columns: CsvColumns | null): MessageKey | null {
  if (form.mode === "whole") return null;
  if (form.order === "nearby" && columns && !columns.nearby.available) return "divide.problemNearby";
  if (form.mode === "even" && form.people.length === 0) return "divide.problemNoPeople";
  if (form.mode === "column") {
    if (!selectedColumn(form, columns)) return "divide.problemNoColumn";
    if (groupsToSend(form, columns).length === 0) return "divide.problemNoGroups";
  }
  if (form.overlap) {
    if (percent(form) === null) return "divide.problemPercent";
    if (everyone(form, columns).size < 2) return "divide.problemOverlapOnePerson";
  }
  return null;
}

/**
 * What to say under the "close on the map" order: why it cannot be chosen, or how many plots
 * have no latitude and longitude (they are shared out last); null when nothing is to be said.
 * `format` writes a count in the viewer's language.
 */
export function nearbyNote(info: NearbyInfo, t: Translate, format: (n: number) => string): string | null {
  if (!info.available) {
    if (info.reason === "other_srs" && info.srid) return t("divide.orderNearbyOtherSrs", { srid: info.srid });
    return info.reason === "no_places" ? t("divide.orderNearbyNoPlaces") : t("divide.orderNearbyUnknown");
  }
  if (info.withoutPlace === 1) return t("divide.orderNearbyMissingOne");
  return info.withoutPlace > 1 ? t("divide.orderNearbyMissing", { count: format(info.withoutPlace) }) : null;
}

/** The request body for a complete form (see formProblem). */
export function toRequest(form: DivisionForm, columns: CsvColumns | null): Distribution {
  const overlapPercent = form.overlap ? (percent(form) ?? undefined) : undefined;
  const extra = overlapPercent !== undefined ? { overlapPercent } : {};
  switch (form.mode) {
    case "whole":
      return { mode: "whole" };
    case "even":
      return { mode: "even", people: [...form.people], order: form.order, ...extra };
    case "column":
      return { mode: "column", column: form.column ?? 0, groups: groupsToSend(form, columns), order: form.order, ...extra };
  }
}

/**
 * The request to apply after a preview: mixed plots are shuffled from a seed, so the
 * seed of the preview is sent back to get exactly the division that was shown.
 */
export function withSeed(request: Distribution, previewed: Distribution | null): Distribution {
  if (request.mode !== "even" && request.mode !== "column") return request;
  if (request.order !== "mixed" || !previewed || previewed.mode !== request.mode) return request;
  const seed = "seed" in previewed ? previewed.seed : undefined;
  return seed === undefined ? request : { ...request, seed };
}
