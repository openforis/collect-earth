// What the survey designer's dialogs share: a change sent and waited for (the dialog stays open with what was typed
// until it is saved, and shows inside why it was not), and what is typed in them counted as changes not saved.

import { createContext, useContext, useEffect, useId, useState, type ReactNode } from "react";
import type { Drafts } from "./surveyEditView";

/** What a dialog adding to the survey hears back: saved, or what to show in it */
export interface AddResult {
  saved: boolean;
  problem?: ReactNode;
}

/**
 * A dialog's change sent: busy while it is saved; closed once it is, else the problem shown in it and what was typed
 * kept (the "Before saving" question cancelled, the save refused or failed)
 */
export function useSubmit(onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ReactNode>(null);
  const run = async (result: Promise<AddResult>): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const r = await result;
    setBusy(false);
    if (r.saved) onClose();
    else setProblem(r.problem ?? null);
  };
  return { busy, problem, run, setProblem };
}

/** The designer's dialogs holding something typed (null outside the designer) */
export const DraftContext = createContext<Drafts | null>(null);

/** A dialog or form says whether something is typed in it: leaving the page then asks first */
export function useDraft(dirty: boolean): void {
  const drafts = useContext(DraftContext);
  const id = useId();
  useEffect(() => {
    drafts?.set(id, dirty);
  }, [drafts, id, dirty]);
  useEffect(() => () => drafts?.set(id, false), [drafts, id]);
}
