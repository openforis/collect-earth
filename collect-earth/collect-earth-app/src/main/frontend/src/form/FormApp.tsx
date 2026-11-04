import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SendIcon from "@mui/icons-material/Send";
import { type MessageKey, type Translate, useT } from "../i18n";
import { escapeBlurs, isTypeAheadKey, isTyping, mayAdvance, mayTakeFocus, panelKey, submitOnKey } from "../shortcuts";
import logo from "./collect-earth-logo.png";
import { AnsweredByKey, FieldView, errorText } from "./fields";
import {
  type Field, type FocusTarget, type FormModel, type GroupItem, type InfoItem, type Item, type MultipleItem, type Step,
  type TableItem, advanceTarget, answeredWithKeys, availableItems, entityCount, errorList, firstToAnswer, indexedField,
  isTabVisible, isVisible, itemFields, neededByTab, stepsOf, summaryLines, tabsWithErrors,
} from "./model";
import type { FormState, FormStore, SaveState } from "./store";

/** A narrow form, e.g. the plots map window narrowed next to Google Earth Web: every pixel goes to the questions. */
const NARROW = "@media (max-width: 480px)";
/** What answers a question from the keyboard, inside its box ([data-field]) */
const CONTROL = "input:not([disabled]), textarea, [role=radio], [role=checkbox], button";
/**
 * The longest the server's answer to an answer from the keyboard may take to move the focus once more, to a question it
 * showed above the one the focus moved to (see answeredByKey)
 */
const ADVANCE_WAIT = 3000;
/** The longest the number keys typed ahead wait for the focus to move on, before they go where it is */
const TYPE_AHEAD_WAIT = ADVANCE_WAIT + 1000;

/** Once the change of the state just made is rendered */
function afterRender(run: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(run));
}

/** Text typed at the end of a box, as the keys would (React sees the input event) */
function typeInto(input: HTMLInputElement, text: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, input.value + text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Resolves when `promise` does, or after `ms`, whichever comes first */
function within(promise: Promise<void>, ms: number): Promise<void> {
  let timer = 0;
  return Promise.race([promise, new Promise<void>((resolve) => { timer = window.setTimeout(resolve, ms); })])
    .finally(() => window.clearTimeout(timer));
}

export function FormApp({ store }: { store: FormStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const t = useT();
  useEffect(() => { void store.load(); }, [store]);

  if (state.phase === "loading") {
    return (
      <Stack spacing={2} sx={{ alignItems: "center", justifyContent: "center", height: "100vh" }} data-testid="entry-loading">
        <CircularProgress />
        <Typography color="text.secondary">{t("entry.loading")}</Typography>
      </Stack>
    );
  }
  if (state.phase === "failed" || !state.model) {
    const error = state.failure === "noPlot" ? t("entry.noPlot") : t("entry.failed", { error: state.failure ?? "" });
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" data-testid="entry-failed" action={<Button color="inherit" size="small" onClick={store.retry}>{t("entry.retry")}</Button>}>{error}</Alert>
      </Box>
    );
  }
  return <ReadyForm store={store} state={state} model={state.model} />;
}

function ReadyForm({ store, state, model }: { store: FormStore; state: FormState; model: FormModel }) {
  const t = useT();
  const content = useRef<HTMLDivElement>(null);
  const errorTabs = tabsWithErrors(model, state.infos);
  const left = neededByTab(errorList(model, state.infos), (n) => store.value(n));
  const tab = model.tabs[state.tab] ?? model.tabs[0];
  const back = store.neighbourTab(-1);
  const next = store.neighbourTab(1);
  const info = model.tabs.flatMap((tb) => tb.items.filter((i): i is InfoItem => i.kind === "info"));
  // the header goes on the first step, which is not tab 0 when that one has nothing to fill in
  const firstStep = Math.max(0, model.tabs.findIndex((tb) => isTabVisible(tb, state.infos)));

  /** The steps shown and their questions as they are now, for the moves of the focus (see advanceTarget) */
  const stepsNow = useCallback((): Step[] => {
    const now = store.getState();
    if (!now.model) return [];
    const byName = store.fieldsByName();
    return stepsOf(now.model, now.infos, (f) => {
      if (f.readOnly || f.type === "unsupported") return null;
      // a list whose answers depend on a question not answered yet has nothing to answer
      const byKey = answeredWithKeys(f) && (f.type !== "code" || availableItems(f, now.infos, now.pending, byName).length > 0);
      return { name: f.name, byKey, needed: store.isRequired(f.name) && store.value(f.name).trim() === "" };
    });
  }, [store]);

  /** The control of a question shown that the keyboard answers it with; for none, the step button (Submit when shown) */
  const controlOf = useCallback((name: string | null): HTMLElement | null => {
    if (name == null) return document.querySelector<HTMLElement>("[data-step-button]");
    return content.current?.querySelector(`[data-field="${CSS.escape(name)}"]`)?.querySelector<HTMLElement>(CONTROL) ?? null;
  }, []);

  // A change of step the user made makes a move of the focus on its way stale; one the move made itself does not
  const advance = useRef(0);
  const ownTab = useRef<number | null>(null);
  useEffect(() => {
    if (ownTab.current === state.tab) ownTab.current = null;
    else advance.current++;
  }, [state.tab]);

  /** The focus to a question or a step button, on its step, once rendered; `done` is told the control focused */
  const focusTarget = useCallback((target: FocusTarget, done?: (control: HTMLElement | null) => void) => {
    if (target.tab !== store.getState().tab) {
      ownTab.current = target.tab;
      store.setTab(target.tab);
      content.current?.scrollTo({ top: 0 });
    }
    afterRender(() => {
      const control = controlOf(target.name) ?? controlOf(null);
      control?.focus();
      done?.(control);
    });
  }, [store, controlOf]);

  /**
   * To a step. With `focus`, the keyboard is ready on it: on its first question to answer, else on its step button
   * (Submit on the last step, where Next is gone with the focus it had), never left on the page, where the number keys
   * do nothing.
   */
  const goTo = useCallback((index: number, focus = true) => {
    store.setTab(index);
    content.current?.scrollTo({ top: 0 });
    if (!focus) return;
    afterRender(() => {
      if (store.getState().tab !== index || !document.hasFocus()) return;
      (controlOf(firstToAnswer(stepsNow(), index)) ?? controlOf(null))?.focus();
    });
  }, [store, stepsNow, controlOf]);
  /** To a question, on its tab: in view, and ready to be answered from the keyboard */
  const goToField = useCallback((index: number, name: string) => {
    if (index !== store.getState().tab) goTo(index, false);
    // once the tab is rendered
    afterRender(() => {
      const box = content.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`);
      if (!box) return;
      box.scrollIntoView({ block: "center", behavior: "smooth" });
      box.querySelector<HTMLElement>(CONTROL)?.focus({ preventScroll: true });
    });
  }, [store, goTo]);

  // Errors after a submit: to the first one, on the tab the submit moved to (not those listed on opening the plot)
  useEffect(() => {
    if (!state.submitErrors?.length || store.getState().incomplete) return;
    const first = state.submitErrors.find((e) => e.tab === store.getState().tab) ?? state.submitErrors[0];
    goToField(first.tab, first.field.name);
  }, [state.submitErrors, store, goToField]);

  // Once, when the plot opens (a plot has a page of its own), and once the server said which questions are shown: the
  // first one needed and answered with keys takes the focus, to be answered from the keyboard, and the keys of the plots
  // map work. None when all are answered, and none when the user put the focus elsewhere meanwhile (see focusIsFree).
  const opened = useRef(false);
  const known = Object.keys(state.infos).length > 0;
  useEffect(() => {
    if (opened.current || !known) return;
    opened.current = true;
    // once the questions are rendered
    afterRender(() => {
      const name = firstToAnswer(stepsNow(), store.getState().tab);
      const control = name == null ? null : controlOf(name);
      if (control && focusIsFree()) control.focus();
    });
  }, [known, store, stepsNow, controlOf]);

  // The number keys typed while the focus moves on from an answer (see answeredByKey): kept, then pressed on the control
  // the focus moved to, so that none is lost, nor taken by the answer just given. `keys` counts every key pressed, for
  // the move made once more after the server's answer, only if nothing was typed since.
  const typeAhead = useRef<{ ticket: number; keys: string[] } | null>(null);
  const keys = useRef(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      keys.current++;
      if (!typeAhead.current || !isTypeAheadKey(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      typeAhead.current.keys.push(e.key);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  /**
   * The move of `ticket` is over, the focus on `control` (null: nowhere to go): the keys kept are pressed on it, or typed
   * in it when it is a box (the search of a long list)
   */
  const endMove = useCallback((ticket: number, control: Element | null) => {
    const move = typeAhead.current;
    if (!move || move.ticket !== ticket) return;
    typeAhead.current = null;
    if (!control || !move.keys.length) return;
    if (isTyping(control)) {
      if (control instanceof HTMLInputElement) typeInto(control, move.keys.join(""));
      return;
    }
    // a key pressed there may start the next move, which keeps those after it in turn
    for (const key of move.keys) control.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }, []);

  // A single choice answered from the keyboard: on at once to the next question needed that is answered with keys, on
  // this step or the next one that needs one, else to the footer's step button (Submit once nothing is left), for Enter
  // to go on (see advanceTarget); never into a text. Not if the user moved the focus meanwhile. The server's answer may
  // then show a question above the one the focus moved to (a subdivision of the land use): the focus goes there, if
  // nothing was typed since. Each answer, and each change of step by the user, makes the move of an answer before it stale.
  // The number keys typed ahead are pressed on the question the focus moved to; when that is a long list, whose search
  // they would go into, they wait for the server's answer, and go to the question it showed above, if it did.
  const answeredByKey = useCallback((name: string) => {
    const from = document.activeElement;
    const fromTab = store.getState().tab;
    const ticket = ++advance.current;
    typeAhead.current = { ticket, keys: typeAhead.current?.keys ?? [] };
    window.setTimeout(() => endMove(ticket, document.activeElement), TYPE_AHEAD_WAIT);
    // once the answer is rendered
    afterRender(() => {
      if (!mayAdvance(document.hasFocus(), document.activeElement, from, document.body, ticket !== advance.current)) {
        endMove(ticket, null);
        return;
      }
      const target = advanceTarget(stepsNow(), fromTab, name);
      focusTarget(target, (landed) => {
        const saving = store.getState().saveState === "unsaved" || store.getState().saveState === "saving";
        const holding = saving && landed != null && isTyping(landed);
        if (!holding) endMove(ticket, landed);
        const typed = keys.current;
        void within(store.whenSaved(), ADVANCE_WAIT).then(() => afterRender(() => {
          const here = ticket === advance.current && document.hasFocus() && document.activeElement === landed;
          if (!here || (!holding && keys.current !== typed)) {
            endMove(ticket, here ? landed : null);
            return;
          }
          const again = advanceTarget(stepsNow(), fromTab, name);
          if (again.tab !== target.tab || again.name !== target.name) focusTarget(again, (control) => endMove(ticket, control));
          else endMove(ticket, landed);
        }));
      });
    });
  }, [store, stepsNow, focusTarget, endMove]);

  // Ctrl+Enter submits, before the focused chip or button sees it (see submitOnKey)
  useEffect(() => {
    const onSubmitKey = (e: KeyboardEvent) => { submitOnKey(e, () => void store.submit()); };
    window.addEventListener("keydown", onSubmitKey, true);
    return () => window.removeEventListener("keydown", onSubmitKey, true);
  }, [store]);


  // Alt+Left/Right change tab; "/", "N", "Esc" and Alt+1... go to the plots map, whose keys they are (see panelKey)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowRight" && next >= 0) { e.preventDefault(); goTo(next); }
      else if (e.altKey && e.key === "ArrowLeft" && back >= 0) { e.preventDefault(); goTo(back); }
      // as on the plots map: Esc leaves the box typed in, a second one closes the form
      else if (escapeBlurs(e)) (e.target as HTMLElement).blur();
      else {
        const key = panelKey(e);
        if (key) { e.preventDefault(); store.passKey(key); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, next, back, goTo]);

  const visibleTabs = model.tabs.map((tb, i) => ({ tb, i })).filter(({ tb, i }) => i === state.tab || isTabVisible(tb, state.infos));
  const stepsDone = visibleTabs.filter(({ i }) => !errorTabs.has(i)).length;
  // nothing left on any step, as the server said: before its first answer, nothing is known to be left
  const ready = known && errorTabs.size === 0;
  const stepsText = t("entry.stepsDone", { done: stepsDone, total: visibleTabs.length });

  return (
    <Stack sx={{ height: "100vh", bgcolor: "background.default" }} data-testid="entry-form">
      {visibleTabs.length > 1 && (
        <Box sx={{ px: 1, pt: 1, [NARROW]: { px: 0.5, pt: 0.5 } }}>
          {/* The steps share the row; each says whether anything is left to answer on it */}
          <Tabs value={state.tab} onChange={(_, v: number) => goTo(v)} sx={{ "& .MuiTab-root": { flex: "1 1 auto" } }}>
            {visibleTabs.map(({ tb, i }) => (
              <Tab key={tb.id} value={i} data-testid={`entry-tab-${i}`} data-done={!errorTabs.has(i) || undefined}
                label={<StepLabel label={tb.label} done={!errorTabs.has(i)} left={left[i] ?? 0} failed={state.attempted && errorTabs.has(i)} />} />
            ))}
          </Tabs>
          <Tooltip title={stepsText}>
            <LinearProgress variant="determinate" value={(100 * stepsDone) / visibleTabs.length} color="success"
              aria-label={stepsText} data-testid="entry-steps-done"
              sx={{ mt: 0.75, height: 3, borderRadius: 2, bgcolor: "balloon.tab" }} />
          </Tooltip>
        </Box>
      )}

      {/* Over the questions, never scrolled away: a plot submitted already, which the first change takes back, and then
          the call to submit it again */}
      {state.unsubmitted ? (
        <Alert severity="warning" data-testid="entry-unsubmitted" sx={BANNER_SX}
          action={
            <Button color="inherit" variant="outlined" size="small" endIcon={state.submitting ? <CircularProgress size={14} color="inherit" /> : <SendIcon />}
              disabled={state.submitting} onClick={() => void store.submit()} data-testid="entry-resubmit" sx={{ whiteSpace: "nowrap" }}>
              {t("entry.resubmit")}
            </Button>
          }>
          {t("entry.unsubmitted")}
        </Alert>
      ) : state.alreadyFilled && (
        <Alert severity="info" onClose={store.dismissAlreadyFilled} data-testid="entry-already-filled" sx={BANNER_SX}>{t("entry.alreadyFilled")}</Alert>
      )}

      {/* the balloon's grey panel around the questions, edge to edge in a narrow form */}
      <Box ref={content} sx={{ flex: 1, overflowY: "auto", mx: 1, mt: 1, px: 2, pt: 1.5, pb: 2,
        bgcolor: "balloon.panel", borderRadius: 1.5, [NARROW]: { mx: 0, mt: 0.75, px: 1.25, pt: 1.25, pb: 1.5, borderRadius: 0 } }}>
        <Stack spacing={1.5}>
          {state.serverDown && (
            <Alert severity="warning" icon={<CloudOffOutlinedIcon />} data-testid="entry-server-down"
              action={<Button color="inherit" size="small" onClick={store.retry}>{t("entry.retry")}</Button>}>{t("entry.serverDown")}</Alert>
          )}
          {state.saveError != null && state.saveState === "error" && (
            <Alert severity="error" data-testid="entry-save-failed"
              action={<Button color="inherit" size="small" onClick={store.retry}>{t("entry.retry")}</Button>}>
              {state.saveError ? t("entry.saveFailed", { message: state.saveError }) : t("entry.saveFailedNoReason")}
            </Alert>
          )}
          {state.submitErrors && state.submitErrors.length > 0 && <ErrorSummary store={store} state={state} model={model} onGo={goToField} />}
          {model.unsupported.length > 0 && state.tab === firstStep && (
            <Alert severity="warning" variant="outlined">{t("entry.unsupportedSome", { names: model.unsupported.map((u) => u.name).join(", ") })}</Alert>
          )}
          {info.length > 0 && state.tab === firstStep && <HeaderInfo items={info} store={store} />}
          <AnsweredByKey.Provider value={answeredByKey}>
            <TabContent store={store} state={state} items={tab.items} />
          </AnsweredByKey.Provider>
        </Stack>
      </Box>

      <LiveRegion state={state} />

      {/* Back and Next only where there is a step to go to; Submit takes Next's place on the last step, and goes next
          to it on the others once nothing is left to answer on any */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1, py: 1, minHeight: 56,
        [NARROW]: { px: 0.75, py: 0.75, minHeight: 52 } }}>
        {/* the balloon's footer: the Collect Earth logo, then the step buttons */}
        <Box component="img" src={logo} alt="Open Foris Collect Earth" sx={{ height: 34, mr: 0.5, px: 0.75, py: "2px", bgcolor: "#fff", borderRadius: 1, [NARROW]: { display: "none" } }} />
        <Box sx={{ width: 40, flex: "none" }}>
          {back >= 0 && (
            <Tooltip title={`${t("entry.back")} (Alt+←)`}>
              <IconButton onClick={() => goTo(back)} aria-label={t("entry.back")} data-testid="entry-back"
                sx={{ border: 1, borderColor: "divider" }}><ChevronLeftIcon /></IconButton>
            </Tooltip>
          )}
        </Box>
        {/* a query of its width: too narrow for the words (Submit and Next both shown in a narrow panel), only the icon */}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", containerType: "inline-size" }}>
          <SaveStatus state={state.saveState} retrying={state.retrying} />
        </Box>
        <Stack direction="row" spacing={1} sx={{ flex: "none", justifyContent: "flex-end", alignItems: "center" }}>
          {(next < 0 || ready) && <SubmitButton store={store} state={state} />}
          {next >= 0 && (
            <Tooltip title="Alt+→" describeChild>
              <Button variant={ready ? "outlined" : "contained"} disableElevation endIcon={<ChevronRightIcon />}
                onClick={() => goTo(next)} data-testid="entry-next" data-step-button sx={STEP_BUTTON_SX}>
                {t("entry.next")}
              </Button>
            </Tooltip>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
}

/** Nothing has the focus, in the plots map around the form or in the form: neither the plot search nor a question. */
function focusIsFree(): boolean {
  try {
    const page = window.parent.document;
    if (!mayTakeFocus(page.activeElement, window.frameElement, page.body)) return false;
    return window.parent === window || mayTakeFocus(document.activeElement, null, document.body);
  } catch {
    // the plots map cannot be read: the form takes the focus as if it could
    return true;
  }
}

/**
 * What a Submit found unfinished, grouped by step, kept up to date as the questions are answered, until nothing is left
 * and the plot can be submitted again. A click goes to the question. What is answered stays listed, ticked off, so the
 * list keeps its height and the questions under it never move as they are answered.
 */
function ErrorSummary({ store, state, model, onGo }: { store: FormStore; state: FormState; model: FormModel;
  onGo: (tab: number, name: string) => void }) {
  const t = useT();
  const errors = errorList(model, state.infos);
  const lines = summaryLines(state.submitErrors ?? [], errors);
  const tabs = [...new Set(lines.map((l) => l.error.tab))].sort((a, b) => a - b);
  // the lines still to see to: those the questions shown since add are counted by their steps, not here
  const count = lines.filter((l) => !l.fixed).length;
  return (
    <Alert severity={errors.length ? "error" : "success"} data-testid={errors.length ? "entry-errors" : "entry-errors-fixed"}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {!errors.length ? t("entry.errorsFixed")
          : !count ? t("entry.errorsElsewhere")
            : state.incomplete
              ? count === 1 ? t("entry.incompleteOne") : t("entry.incompleteMany", { count })
              : count === 1 ? t("entry.errorsOne") : t("entry.errorsMany", { count })}
      </Typography>
      {tabs.map((tab) => (
        <Box key={tab} sx={{ "& + &": { mt: 0.5 } }}>
          {tabs.length > 1 && <Typography variant="caption" component="div" sx={{ fontWeight: 600, opacity: 0.85 }}>{model.tabs[tab].label}</Typography>}
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {lines.filter((l) => l.error.tab === tab).map(({ error: e, fixed }) => {
              const text = fixed ? "" : errorText(t, e.field, store.value(e.field.name), e.message).trim();
              return (
                <Box component="li" key={e.field.name} data-error-of={fixed ? undefined : e.field.name} data-fixed={fixed || undefined}
                  sx={fixed ? { listStyle: "none", ml: -2.5, opacity: 0.7 } : undefined}>
                  {fixed && <CheckIcon titleAccess={t("entry.answered")} sx={{ fontSize: 15, mr: 0.5, verticalAlign: "-2px" }} />}
                  <Link component="button" type="button" variant="body2" onClick={() => onGo(e.tab, e.field.name)}
                    sx={{ textAlign: "left", verticalAlign: "baseline", ...(fixed && { textDecoration: "line-through", color: "inherit" }) }}>
                    {e.context ? `${e.context} – ${e.field.label}` : e.field.label}
                  </Link>
                  {text ? `: ${text}` : ""}
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Alert>
  );
}

/** Read by a screen reader, not shown */
const VISUALLY_HIDDEN = {
  position: "absolute", width: 1, height: 1, p: 0, m: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
} as const;

/** The banner pinned over the questions */
const BANNER_SX = { mx: 1, mt: 1, alignItems: "center", [NARROW]: { mx: 0.5, mt: 0.5 } } as const;

/** Next and Submit: the one button of the footer that moves the work on, big enough to hit without looking */
const STEP_BUTTON_SX = { minWidth: 128, height: 40 } as const;

const SAVE_LABEL: Record<SaveState, MessageKey> = {
  idle: "entry.save.idle", unsaved: "entry.save.unsaved", saving: "entry.save.saving", saved: "entry.save.saved", error: "entry.save.error",
};

/** The label of the save state, as the footer shows it and a screen reader hears it */
function saveLabel(t: Translate, state: SaveState, retrying: boolean): string {
  // a failed save that is tried again by itself says so; the reason of the server is in the banner above the questions
  return state === "error" && retrying ? t("entry.save.retrying") : t(SAVE_LABEL[state]);
}

/**
 * The save state: an icon and its words, only the icon when the room left between the step buttons is too narrow for
 * the words (a container query on its box, in rem, so it follows the scale of the UI), with the words in its tooltip.
 */
function SaveStatus({ state, retrying }: { state: SaveState; retrying: boolean }) {
  const t = useT();
  const label = saveLabel(t, state, retrying);
  const icon = state === "saving" ? <CircularProgress size={12} sx={{ ml: "6px !important" }} />
    : state === "saved" ? <CloudDoneOutlinedIcon /> : state === "error" ? <CloudOffOutlinedIcon /> : <EditOutlinedIcon />;
  // about the width of the words at the chip's size, with its icon and padding
  const wide = `${(label.length * 0.45 + 2.75).toFixed(2)}rem`;
  return (
    <Tooltip title={label}>
      <Chip size="small" variant="outlined" icon={icon} label={label} aria-label={label} data-testid="entry-save-state" data-state={state}
        color={state === "error" ? "error" : state === "saved" ? "success" : "default"}
        sx={{ maxWidth: "100%", border: 0, [`@container (max-width: ${wide})`]: {
          "& .MuiChip-label": { display: "none" }, "& .MuiChip-icon": { mx: "4px !important" } } }} />
    </Tooltip>
  );
}

/**
 * Said to a screen reader, politely, not shown: the save done or failed, and the errors a Submit found.
 * Saving and changes not saved yet are left out, which every answer would say twice.
 */
function LiveRegion({ state }: { state: FormState }) {
  const t = useT();
  const save = state.saveState === "saved" || state.saveState === "error" ? saveLabel(t, state.saveState, state.retrying) : "";
  const reason = state.saveState === "error" && state.saveError ? state.saveError : "";
  const errors = state.submitErrors?.length
    ? state.submitErrors.length === 1 ? t("entry.errorsOne") : t("entry.errorsMany", { count: state.submitErrors.length }) : "";
  const text = [save, reason, errors].filter(Boolean).join(". ");
  return <Box role="status" aria-live="polite" aria-atomic sx={VISUALLY_HIDDEN} data-testid="entry-live">{text}</Box>;
}

function SubmitButton({ store, state }: { store: FormStore; state: FormState }) {
  const t = useT();
  if (state.submitted && !state.submitting) {
    return (
      <Tooltip title={t("entry.submittedHint")}>
        <Chip color="success" icon={<CheckCircleIcon />} label={t("entry.submitted")} data-testid="entry-submitted" />
      </Tooltip>
    );
  }
  return (
    <Tooltip title="Ctrl+Enter">
      <span>
        <Button variant="contained" disableElevation endIcon={state.submitting ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
          disabled={state.submitting} onClick={() => void store.submit()} data-testid="entry-submit" data-step-button sx={STEP_BUTTON_SX}>
          {state.submitting ? t("entry.submitting") : t("entry.submit")}
        </Button>
      </span>
    </Tooltip>
  );
}

/** How many rows of plot data show until the user asks for all of them. */
const HEADER_ROWS = 2;
const HEADER_OPEN_KEY = "collectEarthFormPlotDataOpen";

/**
 * Plot file data the survey puts in the balloon header (country, region, ...): a compact list of labels and values,
 * the first rows only until the user asks for all of them, which is remembered.
 */
function HeaderInfo({ items, store }: { items: InfoItem[]; store: FormStore }) {
  const t = useT();
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(HEADER_OPEN_KEY) === "true"; } catch { return false; }
  });
  const shown = items.map((i) => ({ ...i, value: store.value(i.name) || store.plotValue(i.name) })).filter((i) => i.value);
  if (!shown.length) return null;
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem(HEADER_OPEN_KEY, String(!open)); } catch { /* not remembered */ }
  };
  const rows = open ? shown : shown.slice(0, HEADER_ROWS);
  return (
    <Box data-testid="entry-header" aria-label={t("entry.plotData")} sx={{ bgcolor: "balloon.capsule", borderRadius: 1.5, px: 1.25, py: 0.75 }}>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)",
        columnGap: 1.25, rowGap: 0.25, fontSize: "0.8125rem", lineHeight: 1.45 }}>
        {rows.map((i) => (
          <Box key={i.name} sx={{ display: "contents" }}>
            <Box component="dt" title={i.label}
              sx={{ color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 190 }}>{i.label}</Box>
            <Box component="dd" sx={{ m: 0, fontWeight: 600, overflowWrap: "anywhere" }}>{i.value}</Box>
          </Box>
        ))}
      </Box>
      {shown.length > HEADER_ROWS && (
        <Link component="button" type="button" variant="caption" onClick={toggle} data-testid="entry-header-toggle"
          sx={{ mt: 0.25, fontWeight: 600 }}>
          {open ? t("entry.showLess") : t("entry.showAll", { count: shown.length })}
        </Link>
      )}
    </Box>
  );
}

/**
 * A step's label, with a check once nothing is left to answer on it, else how many answers it still needs: discreet,
 * in red once Submit found it unfinished (a red dot when what is left is a value to correct, not an answer to give).
 */
function StepLabel({ label, done, left, failed }: { label: string; done: boolean; left: number; failed: boolean }) {
  const t = useT();
  const leftText = left === 1 ? t("entry.leftOne") : t("entry.leftMany", { count: left });
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      {done && (
        <Tooltip title={t("entry.stepDone")}>
          <CheckCircleIcon data-testid="entry-step-done" titleAccess={t("entry.stepDone")}
            sx={{ fontSize: 15, color: "success.main", ".Mui-selected &": { color: "inherit" } }} />
        </Tooltip>
      )}
      <span>{label}</span>
      {/* the number for the eyes, the words for a screen reader, which reads them in the tab's name */}
      {!done && (left > 0 || failed) && (
        <Tooltip title={failed ? `${left > 0 ? `${leftText}. ` : ""}${t("entry.tabErrors")}` : leftText}>
          <Box component="span" data-testid="entry-step-left" data-failed={failed || undefined}
            sx={{ minWidth: left > 0 ? 18 : 8, height: left > 0 ? 18 : 8, px: left > 0 ? 0.5 : 0, borderRadius: 9, fontSize: 11,
              fontWeight: 700, lineHeight: "18px", textAlign: "center", ...(failed ? { bgcolor: "error.main", color: "error.contrastText" }
                : { border: 1, borderColor: "currentColor", lineHeight: "16px", opacity: 0.75 }) }}>
            <span aria-hidden>{left > 0 ? left : ""}</span>
            <Box component="span" sx={VISUALLY_HIDDEN}>{left > 0 ? leftText : t("entry.tabErrors")}</Box>
          </Box>
        </Tooltip>
      )}
    </Stack>
  );
}

function TabContent({ store, state, items }: { store: FormStore; state: FormState; items: Item[] }) {
  const t = useT();
  const shown = items.filter((item) => item.kind !== "info");
  const anyVisible = shown.some((item) => item.kind === "multiple" || itemFields(item).some((f) => isVisible(state.infos, f.name)));
  if (!anyVisible) {
    return <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>{t("entry.empty")}</Typography>;
  }
  return (
    <Stack spacing={2.25} sx={{ pt: 0.5 }}>
      {shown.map((item, index) => {
        switch (item.kind) {
          case "field": return <BoundField key={item.name} store={store} state={state} field={item} />;
          case "group": return <Group key={index} store={store} state={state} item={item} />;
          case "table": return <EntityTable key={index} store={store} state={state} item={item} />;
          case "multiple": return <MultipleEntities key={index} store={store} state={state} item={item} />;
          default: return null;
        }
      })}
    </Stack>
  );
}

function BoundField({ store, state, field, dense }: { store: FormStore; state: FormState; field: Field; dense?: boolean }) {
  const byName = store.fieldsByName();
  const parent = field.code?.parent ? byName[field.code.parent] : undefined;
  const items = field.code ? availableItems(field, state.infos, state.pending, byName) : NO_ITEMS;
  return (
    <FieldView field={field} value={store.value(field.name)} info={state.infos[field.name]} items={items}
      parentLabel={parent?.label} onChange={store.setValue} dense={dense} quiet={!state.attempted && !store.value(field.name)}
      required={store.isRequired(field.name)} />
  );
}
const NO_ITEMS: never[] = [];

function SectionTitle({ label, description }: { label: string; description?: string }) {
  return (
    <Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{label}</Typography>
      {description && <Typography variant="body2" color="text.secondary">{description}</Typography>}
    </Box>
  );
}

function Group({ store, state, item }: { store: FormStore; state: FormState; item: GroupItem }) {
  if (!item.fields.some((f) => isVisible(state.infos, f.name))) return null;
  return (
    <Card variant="outlined">
      <CardContent sx={{ "&:last-child": { pb: 2 } }}>
        <Stack spacing={2}>
          <SectionTitle label={item.label} description={item.description} />
          {item.fields.map((f) => <BoundField key={f.name} store={store} state={state} field={f} />)}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Enumerated entity: one row per code list item, as in the balloon. */
function EntityTable({ store, state, item }: { store: FormStore; state: FormState; item: TableItem }) {
  const t = useT();
  // A column whose cells are all calculated says so once, in its header, not on every row
  const calculated = item.columns.map((_, c) => item.rows.every((r) => r.fields[c]?.calculated));
  // In a narrow form the row labels wrap, down to their longest word, to leave the answers room to be read
  // A cell shows no label: its control is named after its row and column, or every row would read the same
  const cellFields = useMemo(() => new Map(item.rows.flatMap((r) =>
    r.fields.map((f): [string, Field] => [f.name, { ...f, label: `${r.label} – ${f.label}` }]))), [item]);
  const rows = item.rows.filter((r) => r.fields.some((f) => isVisible(state.infos, f.name)));
  if (!rows.length) return null;
  return (
    <Box>
      <SectionTitle label={item.label} description={item.description} />
      <Box sx={{ overflowX: "auto", mt: 1, border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
        <Table size="small" sx={{ "& td, & th": { borderColor: "divider", py: 0.75 }, "& tr:last-child > *": { borderBottom: 0 },
          [NARROW]: { "& td, & th": { px: 1 } } }}>
          <TableHead>
            <TableRow>
              <TableCell />
              {item.columns.map((c, i) => (
                <TableCell key={i} sx={{ fontWeight: 600, whiteSpace: "nowrap", [NARROW]: { whiteSpace: "normal" } }} title={c.description}>
                  {c.label}
                  {calculated[i] && <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 400 }}>{t("entry.calculated")}</Typography>}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.code} data-row={row.code}>
                <TableCell component="th" scope="row" sx={{ fontWeight: 500, [NARROW]: { width: "1%" } }} title={row.description}>{row.label}</TableCell>
                {row.fields.map((f) => (
                  <TableCell key={f.name} sx={{ minWidth: f.calculated ? 0 : 140, [NARROW]: { minWidth: 0 } }}>
                    <BoundField store={store} state={state} field={cellFields.get(f.name) ?? f} dense />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}

/** Entities the operator adds and deletes (the balloon's "+" and "x" on a multiple entity form). */
function MultipleEntities({ store, state, item }: { store: FormStore; state: FormState; item: MultipleItem }) {
  const t = useT();
  const count = entityCount(item, state.infos);
  const busy = state.entityBusy === item.entity;
  const failure = state.entityFailure?.entity === item.entity ? state.entityFailure : null;
  // the one added is to be filled in: the focus goes to its first question, once the server made it and it is rendered
  const add = async () => {
    await store.addEntity(item.entity);
    const added = entityCount(item, store.getState().infos);
    if (added <= count) return;
    afterRender(() => {
      const first = item.fields.find((f) => !f.readOnly) ?? item.fields[0];
      if (!first) return;
      const name = indexedField(first, added).name;
      document.querySelector(`[data-field="${CSS.escape(name)}"]`)?.querySelector<HTMLElement>(CONTROL)?.focus();
    });
  };
  return (
    <Stack spacing={1.5} data-testid={`entry-multiple-${item.entity}`}>
      <SectionTitle label={item.label} description={item.description} />
      {count === 0 && <Typography variant="body2" color="text.secondary">{t("entry.noEntities")}</Typography>}
      {Array.from({ length: count }, (_, k) => k + 1).map((index) => (
        <Card key={index} variant="outlined">
          <CardContent sx={{ "&:last-child": { pb: 2 } }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" color="text.secondary">{t("entry.entity", { label: item.label, index })}</Typography>
              {item.fields.map((f) => {
                const field = indexedField(f, index);
                return <BoundField key={field.name} store={store} state={state} field={field} />;
              })}
            </Stack>
          </CardContent>
        </Card>
      ))}
      {failure && (
        <Alert severity="error" data-testid="entry-entity-failed"
          action={<Button color="inherit" size="small" onClick={() => void (failure.action === "add" ? store.addEntity(item.entity) : store.deleteEntity(item.entity))}>{t("entry.retry")}</Button>}>
          {t(failure.action === "add" ? "entry.addFailed" : "entry.deleteFailed", { label: item.label })}{failure.message ? `: ${failure.message}` : ""}
        </Alert>
      )}
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={busy} onClick={() => void add()} data-testid="entry-add">{t("entry.add")}</Button>
        {count > 0 && (
          <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} disabled={busy} onClick={() => void store.deleteEntity(item.entity)}>{t("entry.deleteLast")}</Button>
        )}
      </Stack>
    </Stack>
  );
}
