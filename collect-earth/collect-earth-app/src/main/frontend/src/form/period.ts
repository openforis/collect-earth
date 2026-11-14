// A repeat survey's plot header (docs/plans/2026-11-11-repeat-survey.md, stage 2): the plot's main characteristics as
// they were collected in the earlier period, and the collector's answer to whether the plot is still the same, has
// changed since, or was interpreted wrongly then. The answer is the survey's `period_status`, which the cloud adds to a
// repeat survey; the form asks it in the header, never among the questions.
import { answersToCopy, fieldsOfStep, type FieldInfo, type FormModel, type Item } from "./model";

/** The period status' question, as the form names it (its summary key) */
export const PERIOD_STATUS_FIELD = "collect_code_period_status";
export const PERIOD_STATUSES = ["same", "changed", "corrected"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

/** The earlier period of a plot, as the header shows it. */
export interface PlotPeriods {
  /** this period's label ("2025"), null when the server gave none */
  label: string | null;
  /** the latest earlier period: its label and answers, by question */
  earlier: { label: string; answers: Record<string, string> };
  /** the plot's main characteristics: each question's label and its earlier answer, as read (empty ones left out) */
  header: { key: string; label: string; answer: string }[];
}

type Options = Record<string, { code: string; label: string }[]>;

/** An answer as people read it: each code's name ("Forest"), a qualifier after it, several joined by commas */
export function answerText(key: string, value: string, options: Options): string {
  return value
    .split("===")
    .filter((v) => v !== "")
    .map((part) => {
      const [code, qualifier] = part.split("::");
      const name = options[key]?.find((o) => o.code === code)?.label || code;
      return qualifier ? `${name} (${qualifier})` : name;
    })
    .join(", ");
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The earlier period of a plot from Collect Earth's answer (GET /api/cloud/plot-periods), or null when it has none. */
export function toPlotPeriods(json: unknown): PlotPeriods | null {
  if (!isObject(json) || !Array.isArray(json.periods) || json.periods.length === 0) return null;
  const last = json.periods[json.periods.length - 1];
  if (!isObject(last) || typeof last.label !== "string" || !isObject(last.answers)) return null;
  const answers = Object.fromEntries(Object.entries(last.answers).filter((e): e is [string, string] => typeof e[1] === "string"));
  const labels = isObject(json.labels) ? (json.labels as Record<string, string>) : {};
  const options = isObject(json.options) ? (json.options as Options) : {};
  const keys = Array.isArray(json.header) ? json.header.filter((k): k is string => typeof k === "string") : [];
  return {
    label: typeof json.label === "string" ? json.label : null,
    earlier: { label: last.label, answers },
    header: keys
      .filter((key) => (answers[key] ?? "") !== "")
      .map((key) => ({ key, label: typeof labels[key] === "string" ? labels[key] : key, answer: answerText(key, answers[key], options) })),
  };
}

/** The model without the period status' question, and whether it had it (the header asks it). */
export function withoutPeriodStatus(model: FormModel): { model: FormModel; had: boolean } {
  let had = false;
  const keep = (item: Item): Item | null => {
    if (item.kind === "field" && item.name === PERIOD_STATUS_FIELD) {
      had = true;
      return null;
    }
    if (item.kind === "group") {
      const fields = item.fields.filter((f) => f.name !== PERIOD_STATUS_FIELD);
      if (fields.length !== item.fields.length) had = true;
      return fields.length > 0 ? { ...item, fields } : null;
    }
    return item;
  };
  const tabs = model.tabs.map((tab) => ({ ...tab, items: tab.items.map(keep).filter((i): i is Item => i !== null) }));
  return { model: had ? { ...model, tabs } : model, had };
}

/**
 * "Still the same": the earlier answers to copy into the questions shown, on every step, left empty, by question: the
 * choices and yes or no, as "Same as previous plot" copies them, and the numbers too (a percentage of tree cover, a
 * count), since it is the same plot and its land has not changed; never a key, a text, a date or a calculated value.
 */
export function earlierToCopy(model: FormModel, infos: Record<string, FieldInfo>, earlier: Record<string, string>,
  value: (name: string) => string): [string, string][] {
  return model.tabs.flatMap((tab) => answersToCopy(fieldsOfStep(tab, infos), model.keys, earlier, value, true));
}
