// Survey health's texts (Task 6), built from the figures the server sends: pure, tested.
import type { HealthReason, HealthRow, SurveyHealthData } from "./api";
import { formatNumber } from "./format";
import type { MessageKey, Translate } from "./i18n";
import { formatRate } from "./qualityView";

export const REASON_KEYS: Record<HealthReason, MessageKey> = {
  low_agreement: "health.reason.low_agreement",
  often_other: "health.reason.often_other",
  often_empty: "health.reason.often_empty",
  often_changed: "health.reason.often_changed",
};

/** The other-like answers as shown: their labels, several joined by ", ". */
export function otherAnswersText(row: HealthRow): string {
  return (row.other?.answers ?? []).map((a) => a.label).join(", ");
}

/** Why a question is worth rewording, one sentence, from its figures. */
export function reasonText(t: Translate, reason: HealthReason, row: HealthRow, data: SurveyHealthData, language: string): string {
  const n = (v: number) => formatNumber(v, language);
  const r = (v: number) => formatRate(v, language);
  switch (reason) {
    case "low_agreement":
      return t(REASON_KEYS[reason], { rate: r(row.agreement!.rate!), n: n(row.agreement!.compared), min: r(data.thresholds.lowAgreement) });
    case "often_other":
      return t(REASON_KEYS[reason], { share: r(row.other!.share!), answers: otherAnswersText(row) });
    case "often_empty":
      return t(REASON_KEYS[reason], { share: r(row.emptyShare!) });
    default:
      return t(REASON_KEYS[reason], { n: n(row.decisions.changed), decided: n(data.decidedForCheck) });
  }
}

/** "27 % (8 of 30)"; "Too few plots (8 of 12)"; "—" when it is never known. Plus "6 not known" when some are. */
export function emptyText(t: Translate, row: HealthRow, language: string): string {
  const known = row.answered + row.blank + row.nonNumeric;
  const counts = { n: formatNumber(row.blank, language), known: formatNumber(known, language) };
  const main = known === 0 ? "—" : row.emptyShare === null ? t("health.tooFew", counts) : t("health.share", { share: formatRate(row.emptyShare, language), ...counts });
  return row.notKnown > 0 ? `${main} · ${t("health.notKnown", { n: formatNumber(row.notKnown, language) })}` : main;
}

/** "23 % (6 of 26): Other (specify)"; "None (0 of 26)"; "" for a number question. */
export function otherText(t: Translate, row: HealthRow, language: string): string {
  if (!row.other) return "";
  const counts = { n: formatNumber(row.other.count, language), known: formatNumber(row.answered, language) };
  if (row.answered === 0) return "—";
  if (row.other.count === 0) return t("health.counts", counts);
  const main = row.other.share === null ? t("health.tooFew", counts) : t("health.share", { share: formatRate(row.other.share, language), ...counts });
  return `${main}: ${otherAnswersText(row)}`;
}

/** "52 % (13 of 25 checks)"; "Too few checks (5 of 12)"; "—" when never compared. */
export function agreementText(t: Translate, row: HealthRow, language: string): string {
  const a = row.agreement;
  if (!a || a.compared === 0) return "—";
  const counts = { n: formatNumber(a.agreeing, language), known: formatNumber(a.compared, language) };
  return a.rate === null ? t("health.tooFewChecks", counts) : t("health.shareChecks", { share: formatRate(a.rate, language), ...counts });
}

/** "3 of 4 plots"; "—" when no plot was decided for the check. */
export function changedText(t: Translate, row: HealthRow, data: SurveyHealthData, language: string): string {
  if (data.decidedForCheck === 0) return "—";
  return t("health.changed", { n: formatNumber(row.decisions.changed, language), decided: formatNumber(data.decidedForCheck, language) });
}

/** The rule of the order, with the thresholds the server used. */
export function orderText(t: Translate, data: SurveyHealthData, language: string): string {
  const th = data.thresholds;
  return t("health.noteOrder", {
    agreement: formatRate(th.lowAgreement, language),
    other: formatRate(th.oftenOther, language),
    empty: formatRate(th.oftenEmpty, language),
    min: formatNumber(th.minPlots, language),
    changed: formatNumber(th.minChanged, language),
    changedShare: formatRate(th.oftenChanged, language),
  });
}
