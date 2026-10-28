import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Alert from "@mui/material/Alert";
import Badge from "@mui/material/Badge";
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
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import SendIcon from "@mui/icons-material/Send";
import { type MessageKey, useT } from "../i18n";
import logo from "./collect-earth-logo.png";
import { FieldView, errorText } from "./fields";
import {
  type Field, type FormModel, type GroupItem, type InfoItem, type Item, type MultipleItem, type TableItem,
  availableItems, entityCount, errorList, indexedField, isTabVisible, isVisible, itemFields, tabsWithErrors,
} from "./model";
import type { FormState, FormStore, SaveState } from "./store";

/** A narrow form, e.g. the plots map window narrowed next to Google Earth Web: every pixel goes to the questions. */
const NARROW = "@media (max-width: 480px)";

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
      box.querySelector<HTMLElement>("input:not([disabled]), textarea, [role=radio], [role=checkbox], button")?.focus({ preventScroll: true });
    }));
  }, [store, goTo]);

  // Errors after a submit: to the first one, on the tab the submit moved to (not those listed on opening the plot)
  useEffect(() => {
    if (!state.submitErrors?.length || store.getState().incomplete) return;
    const first = state.submitErrors.find((e) => e.tab === store.getState().tab) ?? state.submitErrors[0];
    goToField(first.tab, first.field.name);
  }, [state.submitErrors, store, goToField]);

  // Ctrl+Enter submits; Alt+Left/Right change tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void store.submit(); }
      else if (e.altKey && e.key === "ArrowRight" && next >= 0) { e.preventDefault(); goTo(next); }
      else if (e.altKey && e.key === "ArrowLeft" && back >= 0) { e.preventDefault(); goTo(back); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, next, back, goTo]);

  const visibleTabs = model.tabs.map((tb, i) => ({ tb, i })).filter(({ tb, i }) => i === state.tab || isTabVisible(tb, state.infos));
  const stepsDone = visibleTabs.filter(({ i }) => !errorTabs.has(i)).length;
  const stepsText = t("entry.stepsDone", { done: stepsDone, total: visibleTabs.length });

  return (
    <Stack sx={{ height: "100vh", bgcolor: "background.default" }} data-testid="entry-form">
      {visibleTabs.length > 1 && (
        <Box sx={{ px: 1, pt: 1, [NARROW]: { px: 0.5, pt: 0.5 } }}>
          {/* The steps share the row; each says whether anything is left to answer on it */}
          <Tabs value={state.tab} onChange={(_, v: number) => goTo(v)} sx={{ "& .MuiTab-root": { flex: "1 1 auto" } }}>
            {visibleTabs.map(({ tb, i }) => (
              <Tab key={tb.id} value={i} data-testid={`entry-tab-${i}`} data-done={!errorTabs.has(i) || undefined}
                label={<StepLabel label={tb.label} done={!errorTabs.has(i)} failed={state.attempted && errorTabs.has(i)} />} />
            ))}
          </Tabs>
          <Tooltip title={stepsText}>
            <LinearProgress variant="determinate" value={(100 * stepsDone) / visibleTabs.length} color="success"
              aria-label={stepsText} data-testid="entry-steps-done"
              sx={{ mt: 0.75, height: 3, borderRadius: 2, bgcolor: "balloon.tab" }} />
          </Tooltip>
        </Box>
      )}

      {/* the balloon's grey panel around the questions, edge to edge in a narrow form */}
      <Box ref={content} sx={{ flex: 1, overflowY: "auto", mx: 1, mt: 1, px: 2, pt: 1.5, pb: 2,
        bgcolor: "balloon.panel", borderRadius: 1.5, [NARROW]: { mx: 0, mt: 0.75, px: 1.25, pt: 1.25, pb: 1.5, borderRadius: 0 } }}>
        <Stack spacing={1.5}>
          {state.serverDown && (
            <Alert severity="warning" icon={<CloudOffOutlinedIcon />} data-testid="entry-server-down"
              action={<Button color="inherit" size="small" onClick={store.retry}>{t("entry.retry")}</Button>}>{t("entry.serverDown")}</Alert>
          )}
          {state.alreadyFilled && (
            <Alert severity="info" onClose={store.dismissAlreadyFilled} data-testid="entry-already-filled">{t("entry.alreadyFilled")}</Alert>
          )}
          {state.submitErrors && state.submitErrors.length > 0 && <ErrorSummary store={store} state={state} model={model} onGo={goToField} />}
          {model.unsupported.length > 0 && state.tab === firstStep && (
            <Alert severity="warning" variant="outlined">{t("entry.unsupportedSome", { names: model.unsupported.map((u) => u.name).join(", ") })}</Alert>
          )}
          {info.length > 0 && state.tab === firstStep && <HeaderInfo items={info} store={store} />}
          <TabContent store={store} state={state} items={tab.items} />
        </Stack>
      </Box>

      {/* Back and Next only where there is a step to go to; Submit takes Next's place on the last step */}
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
        <Box sx={{ flex: "none", display: "flex", justifyContent: "flex-end" }}>
          {next >= 0 ? (
            <Tooltip title="Alt+→" describeChild>
              <Button variant="contained" disableElevation endIcon={<ChevronRightIcon />} onClick={() => goTo(next)} data-testid="entry-next"
                sx={STEP_BUTTON_SX}>
                {t("entry.next")}
              </Button>
            </Tooltip>
          ) : <SubmitButton store={store} state={state} />}
        </Box>
      </Stack>
    </Stack>
  );
}

/**
 * What a Submit found unfinished, grouped by step, kept up to date as the questions are answered, until nothing is left
 * and the plot can be submitted again. A click goes to the question.
 */
function ErrorSummary({ store, state, model, onGo }: { store: FormStore; state: FormState; model: FormModel;
  onGo: (tab: number, name: string) => void }) {
  const t = useT();
  const errors = errorList(model, state.infos);
  if (!errors.length) {
    return <Alert severity="success" data-testid="entry-errors-fixed">{t("entry.errorsFixed")}</Alert>;
  }
  const tabs = [...new Set(errors.map((e) => e.tab))];
  return (
    <Alert severity="error" data-testid="entry-errors">
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {state.incomplete
          ? errors.length === 1 ? t("entry.incompleteOne") : t("entry.incompleteMany", { count: errors.length })
          : errors.length === 1 ? t("entry.errorsOne") : t("entry.errorsMany", { count: errors.length })}
      </Typography>
      {tabs.map((tab) => (
        <Box key={tab} sx={{ "& + &": { mt: 0.5 } }}>
          {tabs.length > 1 && <Typography variant="caption" component="div" sx={{ fontWeight: 600, opacity: 0.85 }}>{model.tabs[tab].label}</Typography>}
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {errors.filter((e) => e.tab === tab).map((e) => {
              const text = errorText(t, e.field, store.value(e.field.name), e.message).trim();
              return (
                <li key={e.field.name} data-error-of={e.field.name}>
                  <Link component="button" type="button" variant="body2" onClick={() => onGo(e.tab, e.field.name)}
                    sx={{ textAlign: "left", verticalAlign: "baseline" }}>
                    {e.context ? `${e.context} – ${e.field.label}` : e.field.label}
                  </Link>
                  {text ? `: ${text}` : ""}
                </li>
              );
            })}
          </Box>
        </Box>
      ))}
    </Alert>
  );
}

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
          disabled={state.submitting} onClick={() => void store.submit()} data-testid="entry-submit" sx={STEP_BUTTON_SX}>
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

/** A step's label, with a check once nothing is left to answer on it, or a red dot once Submit found it unfinished. */
function StepLabel({ label, done, failed }: { label: string; done: boolean; failed: boolean }) {
  const t = useT();
  if (failed) {
    return (
      <Tooltip title={t("entry.tabErrors")} describeChild>
        <Badge color="error" variant="dot" sx={{ "& .MuiBadge-badge": { right: -8, top: 2 } }}>{label}</Badge>
      </Tooltip>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      {done && (
        <Tooltip title={t("entry.stepDone")}>
          <CheckCircleIcon data-testid="entry-step-done"
            sx={{ fontSize: 15, color: "success.main", ".Mui-selected &": { color: "inherit" } }} />
        </Tooltip>
      )}
      <span>{label}</span>
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
      parentLabel={parent?.label} onChange={store.setValue} dense={dense} quiet={!state.attempted && !store.value(field.name)} />
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
