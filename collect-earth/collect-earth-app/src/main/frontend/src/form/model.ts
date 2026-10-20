// The web form generated from the survey: the model Collect Earth describes it with (/surveyForm,
// SurveyFormModelBuilder.java) and the pure logic around the balloon save protocol
// (placemark-info-expanded / save-data-expanded), kept apart from React so it can be unit tested.

export type FieldType = "boolean" | "code" | "coordinate" | "date" | "time" | "integer" | "real" | "text" | "memo" | "unsupported";

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
    const code = splitValues(local)[0];
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

/** The visible fields in error, in form order, with the tab each one is on. */
export function errorList(model: FormModel, infos: Record<string, FieldInfo>): { tab: number; field: Field; message: string }[] {
  const result: { tab: number; field: Field; message: string }[] = [];
  model.tabs.forEach((tab, index) => {
    for (const item of tab.items) {
      const count = item.kind === "multiple" ? entityCount(item, infos) : 0;
      for (const field of itemFields(item, count)) {
        if (hasError(infos, field.name)) result.push({ tab: index, field, message: infos[field.name].errorMessage ?? "" });
      }
    }
  });
  return result;
}

/** A tab with nothing visible on it (every field not relevant) is skipped, as in the balloon. */
export function isTabVisible(tab: Tab, infos: Record<string, FieldInfo>): boolean {
  return tab.items.some((item) => {
    if (item.kind === "info" || item.kind === "multiple") return true;
    return itemFields(item).some((f) => isVisible(infos, f.name));
  });
}
