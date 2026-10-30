import type { RoundCode, RoundInfo } from "./api";
import type { MessageKey } from "./i18n";

/** Why the server did not add round (RoundInfo.refusal), as the sentence to show. */
const REFUSAL_MESSAGES: Record<string, MessageKey> = {
  not_a_zip: "file.round.refusal.notAZip",
  too_large: "file.round.refusal.tooLarge",
  no_survey: "file.round.refusal.noSurvey",
  survey_unreadable: "file.round.refusal.surveyUnreadable",
  several_entities: "file.round.refusal.severalEntities",
  several_keys: "file.round.refusal.severalKeys",
  round_not_key: "file.round.refusal.roundNotKey",
  balloon_missing: "file.round.refusal.balloonMissing",
  balloon_marker_missing: "file.round.refusal.balloonMarkerMissing",
  balloon_ids_missing: "file.round.refusal.balloonIdsMissing",
  template_missing: "file.round.refusal.templateMissing",
  template_marker_missing: "file.round.refusal.templateMarkerMissing",
};

export const REFUSAL_CODES = Object.keys(REFUSAL_MESSAGES);

/** Refusals where the file itself looks wrong: adding round in the designer would not help. */
const BROKEN_FILE = new Set(["not_a_zip", "too_large", "no_survey", "survey_unreadable"]);

export function refusalMessageKey(refusal: string | null): MessageKey {
  return (refusal && Object.hasOwn(REFUSAL_MESSAGES, refusal) && REFUSAL_MESSAGES[refusal]) || "file.round.refusal.unknown";
}

/** What the Project file page says about round: the sentences, in order, and how it looks. */
export interface RoundMessage {
  severity: "success" | "info" | "warning";
  keys: MessageKey[];
  /** added: offer the file as uploaded. */
  download: boolean;
  /** own: ask which code marks a re-assessment. */
  choose: boolean;
}

export function roundMessage(info: RoundInfo): RoundMessage {
  switch (info.state) {
    case "added":
      return { severity: "success", keys: ["file.round.added"], download: true, choose: false };
    case "own":
      return { severity: "success", keys: ["file.round.own"], download: false, choose: true };
    default:
      // No refusal: the file came once data was collected, and the server left it as it was.
      return info.refusal
        ? {
            severity: BROKEN_FILE.has(info.refusal) ? "warning" : "info",
            keys: [refusalMessageKey(info.refusal), BROKEN_FILE.has(info.refusal) ? "file.round.checkFile" : "file.round.carryOn"],
            download: false,
            choose: false,
          }
        : { severity: "info", keys: ["file.round.noneLate"], download: false, choose: false };
  }
}

/** A round code as shown in the list: "2 – Re-assessment", or the code alone without a label. */
export function roundCodeLabel(code: RoundCode): string {
  return code.label && code.label !== code.code ? `${code.code} – ${code.label}` : code.code;
}

/** A safe file name for the downloaded original: the project name, else "project". */
export function originalFileName(projectName: string): string {
  const base = projectName.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `${base || "project"}.cep`;
}
