// Setup's overview once every getting-started step is done: each section with one line on where it stands.

import type { ProjectStatus } from "../api";
import { formatDay, formatNumber } from "../format";
import type { MessageKey, Translate } from "../i18n";
import { dayText } from "../progressView";
import type { ProjectView } from "../router";

/** What the lines are made from; null: not loaded yet (or it failed), the line then says nothing more. */
export interface SetupFacts {
  cepUpdatedAt: number | null;
  plotFiles: number;
  plots: number;
  /** The areas have a source (set here, or a file of the project file) */
  areasSet: boolean | null;
  /** The imagery windows shown besides Google Earth, by their names */
  imagery: string[] | null;
  /** The automatic checks draw plots */
  checksOn: boolean | null;
  /** The deadline (YYYY-MM-DD), or "" for none */
  deadline: string | null;
  shareLinks: number | null;
  status: ProjectStatus;
}

export interface SetupLine {
  view: Exclude<ProjectView<"setup">, "overview">;
  /** null while its figures load */
  text: string | null;
}

export function setupLines(f: SetupFacts, t: Translate, language: string): SetupLine[] {
  const n = (v: number) => formatNumber(v, language);
  return [
    { view: "survey", text: f.cepUpdatedAt === null ? t("summary.surveyNone") : t("summary.survey", { date: formatDay(f.cepUpdatedAt, language) }) },
    { view: "plots", text: t("summary.plots", { files: n(f.plotFiles), plots: n(f.plots) }) },
    { view: "areas", text: f.areasSet === null ? null : t(f.areasSet ? "summary.areasSet" : "summary.areasNone") },
    { view: "layout", text: f.imagery === null ? null : f.imagery.length > 0 ? f.imagery.join(" · ") : t("fold.noImagery") },
    { view: "quality", text: f.checksOn === null ? null : t(f.checksOn ? "summary.checksOn" : "summary.checksOff") },
    { view: "schedule", text: f.deadline === null ? null : f.deadline === "" ? t("summary.noDeadline") : t("summary.deadline", { date: dayText(f.deadline, language) }) },
    { view: "sharing", text: f.shareLinks === null ? null : t("summary.links", { count: n(f.shareLinks) }) },
    { view: "next", text: t("summary.next") },
    { view: "project", text: `${t("status.title")}: ${t(`project.status.${f.status}` as MessageKey)}` },
  ];
}
