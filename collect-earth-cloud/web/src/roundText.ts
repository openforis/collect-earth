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
  // The uploaded file differs from the served one when the server added round or the note.
  const noteAdded = info.note?.state === "added";
  switch (info.state) {
    case "added":
      return { severity: "success", keys: ["file.round.added"], download: true, choose: false };
    case "own":
      return { severity: "success", keys: ["file.round.own"], download: noteAdded, choose: true };
    default:
      // No refusal: the file came once data was collected, and the server left it as it was.
      return info.refusal
        ? {
            severity: BROKEN_FILE.has(info.refusal) ? "warning" : "info",
            keys: [refusalMessageKey(info.refusal), BROKEN_FILE.has(info.refusal) ? "file.round.checkFile" : "file.round.carryOn"],
            download: noteAdded,
            choose: false,
          }
        : { severity: "info", keys: ["file.round.noneLate"], download: noteAdded, choose: false };
  }
}

/** Why the server did not add the coordinator's note (NoteInfo.refusal); the file's own problems share one sentence. */
const NOTE_REFUSAL_MESSAGES: Record<string, MessageKey> = {
  records_exist: "file.note.refusal.recordsExist",
  note_name_taken: "file.note.refusal.noteNameTaken",
  nested_plot_columns: "file.note.refusal.nestedPlotColumns",
  note_mismatch: "file.note.refusal.noteMismatch",
};

export const NOTE_REFUSAL_KEYS: MessageKey[] = [...Object.values(NOTE_REFUSAL_MESSAGES), "file.note.refusal.other"];

/** What the Project file page says about the coordinator's note (Task 16); null when the server says nothing. */
export function noteMessage(info: RoundInfo): { severity: "success" | "info"; keys: MessageKey[] } | null {
  if (!info.note) return null;
  if (info.note.state === "added") return { severity: "success", keys: ["file.note.added"] };
  const refusal = info.note.refusal;
  const key = (refusal && Object.hasOwn(NOTE_REFUSAL_MESSAGES, refusal) && NOTE_REFUSAL_MESSAGES[refusal]) || "file.note.refusal.other";
  return { severity: "info", keys: [key, "file.note.myWork"] };
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
