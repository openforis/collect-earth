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
import { type MessageKey, useT } from "../i18n";
import { escapeBlurs, mayAdvance, mayTakeFocus, panelKey, submitOnKey } from "../shortcuts";
import logo from "./collect-earth-logo.png";
import { AnsweredByKey, FieldView, errorText } from "./fields";
import {
  type Field, type FormModel, type GroupItem, type InfoItem, type Item, type MultipleItem, type TableItem,
  availableItems, entityCount, errorList, indexedField, isTabVisible, isVisible, itemFields, neededByTab, nextUnanswered,
  questionToFocus, summaryLines, tabsWithErrors,
} from "./model";
import type { FormState, FormStore, SaveState } from "./store";

/** A narrow form, e.g. the plots map window narrowed next to Google Earth Web: every pixel goes to the questions. */
const NARROW = "@media (max-width: 480px)";
/** What answers a question from the keyboard, inside its box ([data-field]) */
const CONTROL = "input:not([disabled]), textarea, [role=radio], [role=checkbox], button";
/** The longest an answer from the keyboard waits for its save before the focus moves on (see answeredByKey) */
const ADVANCE_WAIT = 3000;

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
  const goTo = useCallback((index: number) => {
    store.setTab(index);
    content.current?.scrollTo({ top: 0 });
  }, [store]);
  /** To a question, on its tab: in view, and ready to be answered from the keyboard */
  const goToField = useCallback((index: number, name: string) => {
    if (index !== store.getState().tab) goTo(index);
    // once the tab is rendered
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const box = content.current?.querySelector<HTMLElement>(`[data-field="${CSS.escape(name)}"]`);
      if (!box) return;
      box.scrollIntoView({ block: "center", behavior: "smooth" });
      box.querySelector<HTMLElement>(CONTROL)?.focus({ preventScroll: true });
    }));
  }, [store, goTo]);

  // Errors after a submit: to the first one, on the tab the submit moved to (not those listed on opening the plot)
  useEffect(() => {
    if (!state.submitErrors?.length || store.getState().incomplete) return;
    const first = state.submitErrors.find((e) => e.tab === store.getState().tab) ?? state.submitErrors[0];
    goToField(first.tab, first.field.name);
  }, [state.submitErrors, store, goToField]);

  // Once, when the plot opens (a plot has a page of its own), and once the server said which questions are shown: the
  // first one not answered yet takes the focus, to be answered from the keyboard, and the keys of the plots map work.
  // None when all are answered, and none when the user put the focus elsewhere meanwhile (see focusIsFree).
  const opened = useRef(false);
  const known = Object.keys(state.infos).length > 0;
  useEffect(() => {
    if (opened.current || !known) return;
    opened.current = true;
    // once the questions are rendered
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const control = questionToFocus(questionsShown(content.current), (name) => store.value(name));
      if (control && focusIsFree()) control.focus();
    }));
  }, [known, store]);

  // A single choice answered from the keyboard: on to the next question below it still to answer, else to the footer's
  // step button (Next step or Submit), for Enter to go on. Once the server answered the save, with the questions the
  // answer shows (a subdivision of the land use), and rendered them; not if the user moved the focus meanwhile.
  // Each answer, and each change of step, makes the move of an answer before it stale.
  const advance = useRef(0);
  useEffect(() => { advance.current++; }, [state.tab]);
  const answeredByKey = useCallback((name: string) => {
    const from = document.activeElement;
    const ticket = ++advance.current;
    let timer = 0;
    const waited = new Promise<void>((resolve) => { timer = window.setTimeout(resolve, ADVANCE_WAIT); });
    void Promise.race([store.whenSaved(), waited]).then(() => {
      window.clearTimeout(timer);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!mayAdvance(document.hasFocus(), document.activeElement, from, document.body, ticket !== advance.current)) return;
        const control = nextUnanswered(questionsShown(content.current), name, (n) => store.value(n));
        (control ?? document.querySelector<HTMLElement>("[data-step-button]"))?.focus();
      }));
    });
  }, [store]);

  // Ctrl+Enter submits, before the focused chip or button sees it (see submitOnKey)
  useEffect(() => {
    const onSubmitKey = (e: KeyboardEvent) => { submitOnKey(e, () => void store.submit()); };
    window.addEventListener("keydown", onSubmitKey, true);
    return () => window.removeEventListener("keydown", onSubmitKey, true);
  }, [store]);

  // Alt+Left/Right change tab; "/", "N" and "Esc" go to the plots map, whose keys they are (see panelKey)
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
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
          <SaveStatus state={state.saveState} />
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

/** The questions shown, in their order, each with the control that answers it from the keyboard (null: none) */
function questionsShown(content: HTMLElement | null): { name: string; control: HTMLElement | null }[] {
  const boxes = [...(content?.querySelectorAll<HTMLElement>("[data-field]") ?? [])];
  return boxes.map((box) => ({ name: box.dataset.field ?? "", control: box.querySelector<HTMLElement>(CONTROL) }));
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

function SaveStatus({ state }: { state: SaveState }) {
  const t = useT();
  const icon = state === "saving" ? <CircularProgress size={12} sx={{ ml: "6px !important" }} />
    : state === "saved" ? <CloudDoneOutlinedIcon /> : state === "error" ? <CloudOffOutlinedIcon /> : <EditOutlinedIcon />;
  return (
    <Chip size="small" variant="outlined" icon={icon} label={t(SAVE_LABEL[state])} data-testid="entry-save-state" data-state={state}
      color={state === "error" ? "error" : state === "saved" ? "success" : "default"} sx={{ maxWidth: "100%", border: 0 }} />
  );
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
        <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={busy} onClick={() => void store.addEntity(item.entity)}>{t("entry.add")}</Button>
        {count > 0 && (
          <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} disabled={busy} onClick={() => void store.deleteEntity(item.entity)}>{t("entry.deleteLast")}</Button>
        )}
      </Stack>
    </Stack>
  );
}
