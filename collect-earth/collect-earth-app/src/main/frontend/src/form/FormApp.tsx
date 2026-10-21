import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import Alert from "@mui/material/Alert";
import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
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
import { FieldView } from "./fields";
import {
  type Field, type FormModel, type GroupItem, type InfoItem, type Item, type MultipleItem, type TableItem,
  availableItems, entityCount, indexedField, isTabVisible, isVisible, itemFields, tabsWithErrors,
} from "./model";
import type { FormState, FormStore, SaveState } from "./store";

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

  // Errors after a submit: bring the first one into view on its tab
  useEffect(() => {
    if (!state.submitErrors?.length) return;
    const first = state.submitErrors.find((e) => e.tab === state.tab) ?? state.submitErrors[0];
    requestAnimationFrame(() => {
      content.current?.querySelector(`[data-field="${CSS.escape(first.field.name)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [state.submitErrors, state.tab]);

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

  return (
    <Stack sx={{ height: "100vh", bgcolor: "background.default" }} data-testid="entry-form">
      {visibleTabs.length > 1 && (
        <Tabs value={state.tab} onChange={(_, v: number) => goTo(v)} sx={{ px: 1, pt: 1, pb: 0.75 }}>
          {visibleTabs.map(({ tb, i }) => (
            <Tab key={tb.id} value={i} data-testid={`entry-tab-${i}`} label={
              errorTabs.has(i)
                ? <Tooltip title={t("entry.tabErrors")} describeChild><Badge color="error" variant="dot" sx={{ "& .MuiBadge-badge": { right: -8, top: 2, boxShadow: "0 0 0 1.5px #fff" } }}>{tb.label}</Badge></Tooltip>
                : tb.label} />
          ))}
        </Tabs>
      )}

      {/* the balloon's grey panel around the questions */}
      <Box ref={content} sx={{ flex: 1, overflowY: "auto", mx: 1, mt: visibleTabs.length > 1 ? 0 : 1, px: 2, pt: 1.5, pb: 2,
        bgcolor: "balloon.panel", borderRadius: 1.5 }}>
        <Stack spacing={1.5}>
          {state.serverDown && (
            <Alert severity="warning" icon={<CloudOffOutlinedIcon />} data-testid="entry-server-down"
              action={<Button color="inherit" size="small" onClick={store.retry}>{t("entry.retry")}</Button>}>{t("entry.serverDown")}</Alert>
          )}
          {state.alreadyFilled && (
            <Alert severity="info" onClose={store.dismissAlreadyFilled} data-testid="entry-already-filled">{t("entry.alreadyFilled")}</Alert>
          )}
          {state.submitErrors && state.submitErrors.length > 0 && (
            <Alert severity="error" data-testid="entry-errors">
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{t("entry.errors")}</Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {state.submitErrors.map((e) => (
                  <li key={e.field.name}>
                    <Link component="button" type="button" variant="body2" onClick={() => goTo(e.tab)} sx={{ textAlign: "left", verticalAlign: "baseline" }}>
                      {e.field.label}
                    </Link>
                    {e.message ? `: ${e.message}` : ""}
                  </li>
                ))}
              </Box>
            </Alert>
          )}
          {model.unsupported.length > 0 && state.tab === firstStep && (
            <Alert severity="warning" variant="outlined">{t("entry.unsupportedSome", { names: model.unsupported.map((u) => u.name).join(", ") })}</Alert>
          )}
          {info.length > 0 && state.tab === firstStep && <HeaderInfo items={info} store={store} />}
          <TabContent store={store} state={state} items={tab.items} />
        </Stack>
      </Box>

      {/* Back and Next only where there is a step to go to; Submit takes Next's place on the last step */}
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 1, py: 1, minHeight: 52 }}>
        {/* the balloon's footer: the Collect Earth logo, then the step buttons */}
        <Box component="img" src={logo} alt="Open Foris Collect Earth" sx={{ height: 34, mr: 0.5, px: 0.75, py: "2px", bgcolor: "#fff", borderRadius: 1, "@media (max-width: 460px)": { display: "none" } }} />
        <Box sx={{ minWidth: 88 }}>
          {back >= 0 && (
            <Button size="small" variant="outlined" startIcon={<ChevronLeftIcon />} onClick={() => goTo(back)} data-testid="entry-back">{t("entry.back")}</Button>
          )}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
          <SaveStatus state={state.saveState} />
        </Box>
        <Box sx={{ minWidth: 88, display: "flex", justifyContent: "flex-end" }}>
          {next >= 0 ? (
            <Tooltip title="Alt+→" describeChild>
              <Button variant="contained" disableElevation endIcon={<ChevronRightIcon />} onClick={() => goTo(next)} data-testid="entry-next">
                {t("entry.next")}
              </Button>
            </Tooltip>
          ) : <SubmitButton store={store} state={state} />}
        </Box>
      </Stack>
    </Stack>
  );
}

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
          disabled={state.submitting} onClick={() => void store.submit()} data-testid="entry-submit">
          {state.submitting ? t("entry.submitting") : t("entry.submit")}
        </Button>
      </span>
    </Tooltip>
  );
}

/** Plot file data the survey puts in the balloon header (country, region, ...). */
function HeaderInfo({ items, store }: { items: InfoItem[]; store: FormStore }) {
  const shown = items.map((i) => ({ ...i, value: store.value(i.name) || store.plotValue(i.name) })).filter((i) => i.value);
  if (!shown.length) return null;
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }} data-testid="entry-header">
      {shown.map((i) => (
        <Chip key={i.name} size="small" sx={{ bgcolor: "balloon.capsule", fontWeight: 600 }}
          label={<><Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>{i.label}:</Box> {i.value}</>} />
      ))}
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
      parentLabel={parent?.label} onChange={store.setValue} dense={dense} />
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
  // A cell shows no label: its control is named after its row and column, or every row would read the same
  const cellFields = useMemo(() => new Map(item.rows.flatMap((r) =>
    r.fields.map((f): [string, Field] => [f.name, { ...f, label: `${r.label} – ${f.label}` }]))), [item]);
  const rows = item.rows.filter((r) => r.fields.some((f) => isVisible(state.infos, f.name)));
  if (!rows.length) return null;
  return (
    <Box>
      <SectionTitle label={item.label} description={item.description} />
      <Box sx={{ overflowX: "auto", mt: 1, border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
        <Table size="small" sx={{ "& td, & th": { borderColor: "divider" } }}>
          <TableHead>
            <TableRow>
              <TableCell />
              {item.columns.map((c, i) => (
                <TableCell key={i} sx={{ fontWeight: 600, whiteSpace: "nowrap" }} title={c.description}>{c.label}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.code} data-row={row.code}>
                <TableCell component="th" scope="row" sx={{ fontWeight: 500 }} title={row.description}>{row.label}</TableCell>
                {row.fields.map((f) => (
                  <TableCell key={f.name} sx={{ minWidth: 140 }}>
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
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={busy} onClick={() => void store.addEntity(item.entity)}>{t("entry.add")}</Button>
        {count > 0 && (
          <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} disabled={busy} onClick={() => void store.deleteEntity(item.entity)}>{t("entry.deleteLast")}</Button>
        )}
      </Stack>
    </Stack>
  );
}
