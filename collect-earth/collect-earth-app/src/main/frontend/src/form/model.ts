// The web form generated from the survey: the model Collect Earth describes it with (/surveyForm,
// SurveyFormModelBuilder.java) and the pure logic around the balloon save protocol
// (placemark-info-expanded / save-data-expanded), kept apart from React so it can be unit tested.

import type { MessageKey } from "../i18n";

export type FieldType = "boolean" | "code" | "coordinate" | "date" | "time" | "integer" | "real" | "integerRange" | "realRange"
  | "text" | "memo" | "unsupported";

export interface CodeItem {
  id: number;
  code: string;
  label: string;
  description?: string;
  /** Item of the parent code field this one belongs to (hierarchical lists) */
  parentId?: number;
  qualifiable?: boolean;
}

export interface Field {
  kind: "field";
  /** Balloon parameter name, e.g. collect_code_land_use or collect_entity_cover[trees].code_coverage */
  name: string;
  type: FieldType;
  label: string;
  description?: string;
  multiple?: boolean;
  readOnly?: boolean;
  calculated?: boolean;
  affirmativeOnly?: boolean;
  unit?: string;
  code?: { layout: "buttons" | "dropdown"; parent?: string; items: CodeItem[] };
}

export interface InfoItem { kind: "info"; name: string; label: string }
export interface GroupItem { kind: "group"; label: string; description?: string; fields: Field[] }
export interface TableItem {
  kind: "table";
  label: string;
  description?: string;
  columns: { label: string; description?: string }[];
  rows: { code: string; label: string; description?: string; fields: Field[] }[];
}
/** Entities the operator adds: field names hold "$index" (1, 2, ...) */
export interface MultipleItem { kind: "multiple"; entity: string; label: string; description?: string; fields: Field[] }
export type Item = Field | InfoItem | GroupItem | TableItem | MultipleItem;

export interface Tab { id: string; label: string; items: Item[] }

export interface FormModel {
  survey: string;
  language: string;
  keys: string[];
  csvFields: string[];
  tabs: Tab[];
  unsupported: { name: string; reason: string }[];
}

/** Per-field state the server returns after every load and save (PlacemarkInputFieldInfo) */
export interface FieldInfo {
  value?: string | null;
  visible?: boolean;
  inError?: boolean;
  errorMessage?: string | null;
  codeItemId?: number | null;
  possibleCodedItems?: { code: string; label: string }[] | null;
}

export interface LoadResult {
  success: boolean;
  message?: string | null;
  activelySaved?: boolean;
  validData?: boolean;
  skipFilled?: boolean;
  currentStep?: string | null;
  deletedEntityDefName?: string | null;
  inputFieldInfoByParameterName?: Record<string, FieldInfo> | null;
}

export const ACTIVELY_SAVED = "collect_boolean_actively_saved";
/** Separates the values of a multiple attribute (BalloonInputFieldsUtils.PARAMETER_SEPARATOR) */
export const SEPARATOR = "===";

export function splitValues(value: string | null | undefined): string[] {
  return value ? value.split(SEPARATOR).filter((v) => v !== "") : [];
}

export function joinValues(values: string[]): string {
  return values.join(SEPARATOR);
}

/** Between a code and the text of a qualifiable item ("other::Eucalyptus"), as CodeAttributeHandler reads it */
export const QUALIFIER_SEPARATOR = "::";

export interface CodeValue { code: string; qualifier: string }

/** The codes of a code field, each with its qualifier ("" when none) */
export function parseCodes(value: string | null | undefined): CodeValue[] {
  return splitValues(value).map((v) => {
    const at = v.indexOf(QUALIFIER_SEPARATOR);
    return at < 0 ? { code: v, qualifier: "" } : { code: v.slice(0, at), qualifier: v.slice(at + QUALIFIER_SEPARATOR.length) };
  });
}

export function formatCodes(codes: CodeValue[]): string {
  return joinValues(codes.map((c) => (c.qualifier.trim() ? c.code + QUALIFIER_SEPARATOR + c.qualifier : c.code)));
}

/** A new selection of codes, keeping the qualifiers of the codes that stay selected */
export function selectCodes(value: string | null | undefined, codes: string[]): string {
  const current = parseCodes(value);
  return formatCodes(codes.map((code) => ({ code, qualifier: current.find((c) => c.code === code)?.qualifier ?? "" })));
}

/**
 * The codes selected once the button of `code` is clicked, or null when nothing changes: a multiple choice toggles the
 * code, a single choice picks it, and a click on the answer already chosen keeps it (clearing it takes the clear button
 * or Delete, never a click that may be a slip).
 */
export function clickCode(selected: string[], code: string, multiple: boolean): string[] | null {
  if (multiple) return selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code];
  return selected.length === 1 && selected[0] === code ? null : [code];
}

/** The value with the qualifier of one of its codes changed */
export function qualify(value: string | null | undefined, code: string, qualifier: string): string {
  return formatCodes(parseCodes(value).map((c) => (c.code === code ? { code, qualifier } : c)));
}

// ---------- value formats: the server's (DateAttributeHandler, TimeAttributeHandler) <-> the inputs' ----------

/** MM/dd/yyyy (server) -> yyyy-MM-dd (input type=date) */
export function dateToInput(value: string | null | undefined): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value ?? "");
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : "";
}

/** yyyy-MM-dd -> MM/dd/yyyy */
export function dateFromInput(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** H:mm or HH:mm -> HH:mm (input type=time); the server already speaks HH:mm */
export function timeToInput(value: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

/** "lat,lon[,srs]" -> [lat, lon] */
export function coordinateToInput(value: string | null | undefined): [string, string] {
  const parts = (value ?? "").split(",");
  return [parts[0]?.trim() ?? "", parts[1]?.trim() ?? ""];
}

export function coordinateFromInput(lat: string, lon: string): string {
  return lat.trim() || lon.trim() ? `${lat.trim()},${lon.trim()}` : "";
}

/** "FROM-TO", or one number for a range of one value (RangeAttributeHandler); negative numbers keep their sign. */
export function rangeToInput(value: string | null | undefined): [string, string] {
  const m = /^(-?[\d.]+)(?:-(-?[\d.]+))?$/.exec((value ?? "").replace(/\s/g, ""));
  return m ? [m[1], m[2] ?? m[1]] : ["", ""];
}

export function rangeFromInput(from: string, to: string): string {
  const a = from.trim();
  const b = to.trim();
  if (!a || !b) return a || b;
  return a === b ? a : `${a}-${b}`;
}

/** Decimal comma typed on a Spanish/French/Portuguese keyboard: the server wants a dot. */
export function normalizeNumber(value: string): string {
  return value.trim().replace(",", ".");
}

// ---------- structure ----------

/** Every field of the form by name (multiple items: as many entities as the server reported). */
export function fieldsByName(model: FormModel, infos: Record<string, FieldInfo>): Record<string, Field> {
  const result: Record<string, Field> = {};
  for (const tab of model.tabs) {
    for (const item of tab.items) {
      const count = item.kind === "multiple" ? entityCount(item, infos) : 0;
      for (const field of itemFields(item, count)) result[field.name] = field;
    }
  }
  return result;
}

/** The fields of an item, with "$index" replaced for each entity of a multiple item. */
export function itemFields(item: Item, entityCount = 0): Field[] {
  switch (item.kind) {
    case "field": return [item];
    case "group": return item.fields;
    case "table": return item.rows.flatMap((r) => r.fields);
    case "multiple": {
      const result: Field[] = [];
      for (let i = 1; i <= entityCount; i++) result.push(...item.fields.map((f) => indexedField(f, i)));
      return result;
    }
    default: return [];
  }
}

export function indexedField(field: Field, index: number): Field {
  const name = field.name.replace("$index", String(index));
  const parent = field.code?.parent?.replace("$index", String(index));
  return { ...field, name, code: field.code ? { ...field.code, parent } : undefined };
}

/** How many entities of a multiple item the server knows about (from the indexed names it returned). */
export function entityCount(item: MultipleItem, infos: Record<string, FieldInfo>): number {
  const prefix = item.fields[0]?.name.split("$index")[0];
  if (!prefix) return 0;
  let max = 0;
  for (const name of Object.keys(infos)) {
    if (!name.startsWith(prefix)) continue;
    const n = parseInt(name.slice(prefix.length), 10);
    if (n > max) max = n;
  }
  return max;
}

// ---------- server state ----------

/**
 * Merges a server response into the known field state. A partial update only returns what changed;
 * a full one (load, submit) returns every field.
 */
export function mergeInfos(known: Record<string, FieldInfo>, response: LoadResult, full: boolean): Record<string, FieldInfo> {
  const incoming = response.inputFieldInfoByParameterName ?? {};
  const merged: Record<string, FieldInfo> = full ? {} : { ...known };
  for (const [name, info] of Object.entries(incoming)) {
    merged[name] = { ...(full ? {} : known[name]), ...info };
  }
  if (response.deletedEntityDefName) {
    // the server deleted the last entity of this kind: forget its fields
    const prefix = `collect_entity_${response.deletedEntityDefName}[`;
    let last = 0;
    for (const name of Object.keys(merged)) {
      if (name.startsWith(prefix)) last = Math.max(last, parseInt(name.slice(prefix.length), 10) || 0);
    }
    for (const name of Object.keys(merged)) {
      if (name.startsWith(`${prefix}${last}]`)) delete merged[name];
    }
  }
  return merged;
}

/** A field the server has not reported on yet is shown; one it says is not relevant is hidden. */
export function isVisible(infos: Record<string, FieldInfo>, name: string): boolean {
  return infos[name]?.visible !== false;
}

export function hasError(infos: Record<string, FieldInfo>, name: string): boolean {
  const info = infos[name];
  return !!info && info.visible !== false && !!info.inError;
}

/** The code items to offer: the children of the parent field's selection, intersected with the valid ones. */
export function availableItems(field: Field, infos: Record<string, FieldInfo>, values: Record<string, string>,
  fieldsByName: Record<string, Field>): CodeItem[] {
  const code = field.code;
  if (!code) return [];
  let items = code.items;
  if (code.parent) {
    const parentId = selectedItemId(code.parent, infos, values, fieldsByName);
    items = parentId == null ? [] : items.filter((i) => i.parentId === parentId);
  }
  const valid = infos[field.name]?.possibleCodedItems;
  if (valid && valid.length) {
    const codes = new Set(valid.map((v) => v.code));
    const filtered = items.filter((i) => codes.has(i.code));
    // the server lists the valid items of the saved parent; while a new parent is being saved, keep ours
    if (filtered.length) items = filtered;
  }
  return items;
}

/**
 * Id of the item selected in a code field: the one the operator just picked (known locally), else the
 * one the server reported (calculated parents are only known to the server).
 */
export function selectedItemId(name: string, infos: Record<string, FieldInfo>, values: Record<string, string>,
  fieldsByName: Record<string, Field>): number | null {
  const f = fieldsByName[name];
  const local = values[name];
  if (local != null && f?.code) {
    const code = parseCodes(local)[0]?.code;
    if (code == null) return null; // cleared
    const parentId = f.code.parent ? selectedItemId(f.code.parent, infos, values, fieldsByName) : null;
    const item = f.code.items.find((i) => i.code === code && (parentId == null || i.parentId == null || i.parentId === parentId));
    if (item) return item.id;
  }
  return infos[name]?.codeItemId ?? null;
}

/** Body of a save-data-expanded request (application/x-www-form-urlencoded), as the balloon builds it. */
export function saveBody(placemarkId: string, values: Record<string, string>, step: number, partial: boolean): URLSearchParams {
  const body = new URLSearchParams();
  body.append("placemarkId", placemarkId);
  body.append("currentStep", String(step));
  body.append("partialUpdate", String(partial));
  for (const [name, value] of Object.entries(values)) {
    body.append(`values[${encodeURIComponent(name)}]`, value);
  }
  return body;
}

/** Tabs (by index) holding a visible field in error. */
export function tabsWithErrors(model: FormModel, infos: Record<string, FieldInfo>): Set<number> {
  const result = new Set<number>();
  model.tabs.forEach((tab, index) => {
    for (const item of tab.items) {
      const count = item.kind === "multiple" ? entityCount(item, infos) : 0;
      if (itemFields(item, count).some((f) => hasError(infos, f.name))) {
        result.add(index);
        return;
      }
    }
  });
  return result;
}

export interface FieldError {
  tab: number;
  field: Field;
  /** where it is when its label alone does not say: the row of a table, the entity of a multiple item */
  context?: string;
  /** the server's message */
  message: string;
}

/** The visible fields in error, in form order, with the tab each one is on. */
export function errorList(model: FormModel, infos: Record<string, FieldInfo>): FieldError[] {
  const result: FieldError[] = [];
  model.tabs.forEach((tab, index) => {
    for (const item of tab.items) {
      const count = item.kind === "multiple" ? entityCount(item, infos) : 0;
      itemFields(item, count).forEach((field, k) => {
        if (!hasError(infos, field.name)) return;
        let context: string | undefined;
        if (item.kind === "table") context = item.rows.find((r) => r.fields.some((f) => f.name === field.name))?.label;
        else if (item.kind === "multiple") context = `${item.label} ${Math.floor(k / item.fields.length) + 1}`;
        result.push({ tab: index, field, context, message: infos[field.name].errorMessage ?? "" });
      });
    }
  });
  return result;
}

/**
 * What to do about a question left unanswered, in the words of its control: the server only says it is required, in
 * the same words for a list, a number or a date. A multiple field keeps the server's message, which says how many.
 */
export function requiredMessage(field: Field): MessageKey | null {
  if (field.multiple) return null;
  switch (field.type) {
    case "code": return "entry.required.choose";
    case "boolean": return field.affirmativeOnly ? "entry.required.tick" : "entry.required.yesNo";
    case "integer":
    case "real": return "entry.required.number";
    case "text":
    case "memo": return "entry.required.text";
    case "date": return "entry.required.date";
    case "time": return "entry.required.time";
    case "coordinate": return "entry.required.coordinate";
    case "integerRange":
    case "realRange": return "entry.required.range";
    default: return null;
  }
}

/** The server's message as text: those about a value that could not be read are HTML, for the balloon. */
export function plainMessage(message: string | null | undefined): string {
  const entities: Record<string, string> = { lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" };
  return (message ?? "").replace(/&(lt|gt|quot|#39|amp);/g, (_, e: string) => entities[e]);
}

/**
 * A tab with nothing visible on it (every field not relevant) is skipped, as in the balloon. Plot file data does
 * not count: the header shows it, not its tab.
 */
export function isTabVisible(tab: Tab, infos: Record<string, FieldInfo>): boolean {
  return tab.items.some((item) => {
    if (item.kind === "info") return false;
    if (item.kind === "multiple") return true;
    return itemFields(item).some((f) => isVisible(infos, f.name));
  });
}

/**
 * Whether a question is answered with the number keys, Enter or Space: a choice (buttons or a list) or Yes and No.
 * Only those are ever given the focus by the form itself: a digit typed ahead must never end up in a text, a number
 * or a comment, which the user Tabs into.
 */
export function answeredWithKeys(field: Field): boolean {
  return !field.readOnly && (field.type === "code" || field.type === "boolean");
}

/** The most answers a list the survey lays out as a dropdown may have to be shown as buttons, all in view at once */
export const DROPDOWN_AS_BUTTONS = 6;

/** How a code question is shown: its answers as buttons, or a searchable list when the survey asks a dropdown of many */
export function codeControl(field: Field, items: CodeItem[]): "buttons" | "select" {
  return field.code?.layout === "dropdown" && items.length > DROPDOWN_AS_BUTTONS ? "select" : "buttons";
}

/** A question of a step, as the moves of the focus see it */
export interface StepQuestion {
  name: string;
  /** answered from the keyboard (see answeredWithKeys), and with something to answer now (a list with answers) */
  byKey: boolean;
  /** an answer is needed (required) and none is given yet */
  needed: boolean;
}

export interface Step { tab: number; questions: StepQuestion[] }

/**
 * The steps shown, by tab, each with its questions shown in their order (`describe`: null for one that is not a
 * question, as a calculated field).
 */
export function stepsOf(model: FormModel, infos: Record<string, FieldInfo>,
  describe: (field: Field) => StepQuestion | null): Step[] {
  const steps: Step[] = [];
  model.tabs.forEach((tab, index) => {
    if (!isTabVisible(tab, infos)) return;
    const questions = fieldsOfStep(tab, infos).map(describe).filter((q): q is StepQuestion => q != null);
    steps.push({ tab: index, questions });
  });
  return steps;
}

/** The fields shown on a step, in their order (every entity of a multiple item) */
export function fieldsOfStep(tab: Tab, infos: Record<string, FieldInfo>): Field[] {
  return tab.items.flatMap((item) => itemFields(item, item.kind === "multiple" ? entityCount(item, infos) : 0))
    .filter((f) => isVisible(infos, f.name));
}

/** Where the focus goes: a question of a step, or (name null) the step button of the footer, Submit when it is shown */
export interface FocusTarget { tab: number; name: string | null }

const toAnswer = (q: StepQuestion) => q.needed && q.byKey;

/**
 * The question to focus on step `tab`, when a plot opens or the step is shown: its first one needed that is answered
 * from the keyboard, or null when there is none (a key pressed in a plot looked at again must not edit it).
 */
export function firstToAnswer(steps: Step[], tab: number): string | null {
  return steps.find((s) => s.tab === tab)?.questions.find(toAnswer)?.name ?? null;
}

/**
 * Where the focus goes once question `from` of step `tab` is answered from the keyboard: the next question needed below
 * it that is answered from the keyboard; else one above it on the step; else, when the step still needs an answer typed
 * (which the user Tabs into), its step button; else the first such question of the next step that needs one (the steps
 * after it, then those before), skipping those with nothing needed; else, nothing left anywhere, the step button, which
 * is Submit then. Never a text, a number or a comment, nor an optional question.
 */
export function advanceTarget(steps: Step[], tab: number, from: string | null): FocusTarget {
  const at = steps.findIndex((s) => s.tab === tab);
  const step = steps[at];
  if (step) {
    const index = from == null ? -1 : step.questions.findIndex((q) => q.name === from);
    const below = step.questions.slice(index + 1).find(toAnswer) ?? step.questions.slice(0, Math.max(0, index)).find(toAnswer);
    if (below) return { tab, name: below.name };
    if (step.questions.some((q) => q.needed && q.name !== from)) return { tab, name: null };
  }
  const others = at < 0 ? steps : [...steps.slice(at + 1), ...steps.slice(0, at)];
  for (const other of others) {
    const first = other.questions.find(toAnswer);
    if (first) return { tab: other.tab, name: first.name };
  }
  return { tab, name: null };
}

/**
 * What an integer or a decimal number typed is not, or null when it is one (or nothing): the server reads "1.5x" as 1,
 * which the box then showed instead of what was typed, with no word of it. A decimal comma is a dot (normalizeNumber).
 */
export function numberProblem(type: FieldType, typed: string): MessageKey | null {
  const text = normalizeNumber(typed);
  if (text === "") return null;
  if (type === "integer") return /^[-+]?\d+$/.test(text) ? null : "entry.invalidInteger";
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text) ? null : "entry.invalidNumber";
}

/** The types of answer "Same as previous plot" never copies: what is written about one plot, and where it is */
const NOT_COPIED: FieldType[] = ["text", "memo", "coordinate", "unsupported"];

/** Whether the answer of a question may be copied from one plot to the next: not a key, a text, a calculated value */
function copiable(field: Field, keys: string[]): boolean {
  return !field.readOnly && !field.calculated && !NOT_COPIED.includes(field.type) && !keys.includes(field.name);
}

/** The answers of a plot submitted that the next one may copy (see answersToCopy), by question */
export function answersToRemember(fields: Record<string, Field>, keys: string[], value: (name: string) => string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of Object.values(fields)) {
    const v = value(field.name);
    if (copiable(field, keys) && v.trim() !== "") result[field.name] = v;
  }
  return result;
}

/**
 * The answers of the plot submitted before (`previous`) to copy to the questions of a step (`fields`, those shown, in
 * their order) still left empty: never into a key or a text, never over an answer given.
 */
export function answersToCopy(fields: Field[], keys: string[], previous: Record<string, string>,
  value: (name: string) => string): [string, string][] {
  return fields
    .filter((f) => copiable(f, keys) && value(f.name).trim() === "" && (previous[f.name] ?? "").trim() !== "")
    .map((f) => [f.name, previous[f.name]]);
}

/**
 * The questions the server asks an answer for, of those not answered yet: the model does not say which are required
 * (SurveyFormModelBuilder), the server does, by reporting each one left empty in error from the start, which is also
 * what "Choose an answer" is said of (see requiredMessage). Those shown, and answered on the form, only.
 */
export function unansweredRequired(fields: Record<string, Field>, infos: Record<string, FieldInfo>,
  value: (name: string) => string): string[] {
  return Object.values(fields)
    .filter((f) => !f.readOnly && f.type !== "unsupported" && hasError(infos, f.name) && value(f.name).trim() === "")
    .map((f) => f.name);
}

/**
 * The questions known to need an answer, after a server answer: `known`, with those it reports in error while empty,
 * and without those it reports shown, empty and not in error (no longer required, an answer elsewhere decided so).
 * Only the server's answers say it, never a local change: a question just cleared is not in error before the server
 * says it is. A question answered when the plot opened was never reported in error: it is not known to need one.
 */
export function updateRequired(known: Set<string>, fields: Record<string, Field>, infos: Record<string, FieldInfo>,
  value: (name: string) => string): Set<string> {
  const result = new Set(known);
  for (const name of unansweredRequired(fields, infos, value)) result.add(name);
  for (const name of known) {
    const info = infos[name];
    if (info && info.visible !== false && !info.inError && value(name).trim() === "") result.delete(name);
  }
  return result;
}

/**
 * The answers still needed on each tab, by index (none: not listed): the questions in error left empty, that the user
 * can answer. A value in error (a number out of range) is not counted, though the step is not done with it.
 */
export function neededByTab(errors: FieldError[], value: (name: string) => string): Record<number, number> {
  return errorsByTab(errors.filter((e) => !e.field.readOnly && value(e.field.name).trim() === ""));
}

/** How many of the errors are on each tab, by index (none: not listed) */
export function errorsByTab(errors: FieldError[]): Record<number, number> {
  const result: Record<number, number> = {};
  for (const e of errors) result[e.tab] = (result[e.tab] ?? 0) + 1;
  return result;
}

/**
 * The lines of the list of what a Submit found unfinished, in the order it found them: each one still in error, or
 * fixed since. Those answered are kept, and the questions an answer shows (a land use's subdivision) are not added: the
 * list above the questions never changes height, so it never moves the question being answered under the pointer. The
 * steps' counts, and the questions' own messages, show those.
 */
export function summaryLines(found: FieldError[], now: FieldError[]): { error: FieldError; fixed: boolean }[] {
  const left = new Map(now.map((e) => [e.field.name, e]));
  return found.map((e) => ({ error: left.get(e.field.name) ?? e, fixed: !left.has(e.field.name) }));
}
