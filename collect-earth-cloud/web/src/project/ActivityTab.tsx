import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import ListSubheader from "@mui/material/ListSubheader";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import EventNote from "@mui/icons-material/EventNote";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, getActivity, type ActivityPage, type ExportKind, type LogItem, type LogKind } from "../api";
import { useApp, useLocalMode } from "../appContext";
import { COORDINATOR_LOG_KINDS, dayAfterMs, dayStartMs, LOG_KIND_LABELS, logSentenceParts, RECORD_LOG_KINDS } from "../activityView";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain, MoreInfo } from "../components/Explain";
import { Loading } from "../components/Loading";
import { formatDate, formatDay, formatNumber } from "../format";
import { useT } from "../i18n";
import { activityDownloads, otherLogKinds } from "../localMode";
import { linkProps, pathFor } from "../router";
import { useDownload } from "./useDownload";

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" id={id} gutterBottom>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

interface Filters {
  person: string;
  kind: LogKind;
  /** Calendar days (YYYY-MM-DD) in the browser's time zone, or "". */
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { person: "", kind: "all", from: "", to: "" };

const timeOf = (at: number, language: string) => {
  try {
    return new Intl.DateTimeFormat(language, { timeStyle: "short" }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(at);
  }
};
/** The day a row is listed under, in the person's time zone. */
const dayKey = (at: number) => new Date(at).toDateString();
/** Rows shown at first, and added by each "Show more" before the next page is asked for. */
const SHOWN_STEP = 20;

/** One row of the log: when, and what happened, with a link to the plot's page. */
function LogRow({ projectId, item, page }: { projectId: string; item: LogItem; page: ActivityPage }) {
  const t = useT();
  const { language } = useApp();
  const local = useLocalMode();
  const parts = logSentenceParts(t, item, page, language, { local });
  const plot = item.type === "record" ? item.plot : item.action.startsWith("decision.") && typeof item.details.plot === "string" ? item.details.plot : null;
  const link = (text: string) =>
    plot !== null && (
      <Link variant="body2" aria-label={t("activity.openPlotLabel", { plot: text })} {...linkProps(pathFor({ name: "plot", projectId, plot }))}>
        {text}
      </Link>
    );
  return (
    // The time in a column of its own width, the sentence beside it: rows do not wrap under the time on a phone.
    <Box component="li" sx={{ py: 1, borderBottom: 1, borderColor: "divider", display: "flex", gap: { xs: 1.5, sm: 2 } }}>
      <Typography variant="body2" color="text.secondary" sx={{ width: { xs: 64, sm: 80 }, flexShrink: 0, fontVariantNumeric: "tabular-nums" }} title={formatDate(item.at, language)}>
        {timeOf(item.at, language)}
      </Typography>
      <Typography variant="body2" sx={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
        {/* The plot named in the sentence is the link to its page (or, when the sentence names none, a link after it). */}
        {plot !== null && parts.plot !== null ? (
          <>
            {parts.before}
            {link(parts.plot)}
            {parts.after}
          </>
        ) : (
          <>
            {parts.before}
            {plot !== null && (
              <>
                {" · "}
                <Link variant="body2" aria-label={t("activity.openPlotLabel", { plot })} {...linkProps(pathFor({ name: "plot", projectId, plot }))}>
                  {t("activity.openPlot")}
                </Link>
              </>
            )}
          </>
        )}
      </Typography>
    </Box>
  );
}

/** The log: filters, then the rows newest first, a page at a time. */
function ActivityLog({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  // The local mode (one person): no person filter, and no kinds about other people or decisions.
  const local = useLocalMode();
  const otherKinds = otherLogKinds(local, COORDINATOR_LOG_KINDS);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [shown, setShown] = useState(SHOWN_STEP);
  const latest = useRef(0);

  const load = async (f: Filters, cursor: string | null) => {
    const call = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getActivity(projectId, {
        person: f.person || null,
        kind: f.kind,
        from: f.from ? dayStartMs(f.from) : null,
        to: f.to ? dayAfterMs(f.to) : null,
        cursor,
      });
      if (call !== latest.current) return;
      setPage((prev) =>
        cursor && prev
          ? { ...next, items: [...prev.items, ...next.items], people: { ...prev.people, ...next.people }, files: { ...prev.files, ...next.files } }
          : next,
      );
      setAnnounce(cursor ? t("activity.loadedMore", { n: formatNumber(next.items.length, language) }) : "");
    } catch (err) {
      if (call === latest.current) setError(err);
    } finally {
      if (call === latest.current) setLoading(false);
    }
  };

  useEffect(() => {
    setShown(SHOWN_STEP);
    void load(filters, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, filters]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const badRange = filters.from !== "" && filters.to !== "" && filters.to < filters.from;
  const persons = page?.persons ?? [];
  const filtered = filters.person !== "" || filters.kind !== "all" || filters.from !== "" || filters.to !== "";

  return (
    <Section title={t("activity.logTitle")} id="activity-log">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(local ? "activity.logHelpLocal" : "activity.logHelp")}
        {!local && <MoreInfo text={t("activity.logHelp.more")} />}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} useFlexGap sx={{ mb: 2, flexWrap: "wrap" }}>
        {!local && (
          <TextField select label={t("activity.person")} value={filters.person} onChange={(e) => set({ person: e.target.value })} fullWidth={false} sx={{ width: { xs: "100%", sm: 200 } }} size="small" slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
            <MenuItem value="">{t("activity.everyone")}</MenuItem>
            {persons.map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField select label={t("activity.kind")} value={filters.kind} onChange={(e) => set({ kind: e.target.value as LogKind })} fullWidth={false} sx={{ width: { xs: "100%", sm: 260 } }} size="small">
          <MenuItem value="all">{t(LOG_KIND_LABELS.all)}</MenuItem>
          <ListSubheader>{t("activity.kindGroupRecords")}</ListSubheader>
          {RECORD_LOG_KINDS.map((k) => (
            <MenuItem key={k} value={k}>
              {t(LOG_KIND_LABELS[k])}
            </MenuItem>
          ))}
          <ListSubheader>{t(local ? "activity.kindGroupLocal" : "activity.kindGroupCoordinators")}</ListSubheader>
          {otherKinds.map((k) => (
            <MenuItem key={k} value={k}>
              {t(LOG_KIND_LABELS[k])}
            </MenuItem>
          ))}
        </TextField>
        {/* From and To side by side, also on a phone. */}
        <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start" }}>
        <TextField type="date" label={t("activity.from")} value={filters.from} onChange={(e) => set({ from: e.target.value })} size="small" fullWidth={false} sx={{ flex: { xs: 1, sm: "none" }, minWidth: 0, width: { sm: 180 } }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField
          type="date"
          label={t("activity.to")}
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
          size="small"
          fullWidth={false}
          sx={{ flex: { xs: 1, sm: "none" }, minWidth: 0, width: { sm: 180 } }}
          error={badRange}
          helperText={badRange ? t("activity.badRange") : undefined}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        </Stack>
        {filtered && (
          <Button onClick={() => setFilters(NO_FILTERS)} sx={{ alignSelf: { sm: "center" } }}>
            {t("activity.clear")}
          </Button>
        )}
      </Stack>
      {error !== null && <ErrorAlert error={error} onRetry={() => void load(filters, null)} />}
      {page === null && loading && <Loading />}
      {page !== null && page.items.length === 0 && !loading && <Typography>{t(filtered ? "activity.noneFiltered" : "activity.none")}</Typography>}
      {page !== null && page.items.length > 0 && (
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }} aria-label={t("activity.logTitle")}>
          {page.items.slice(0, shown).map((item, i, list) => (
            <Fragment key={item.id}>
              {(i === 0 || dayKey(list[i - 1].at) !== dayKey(item.at)) && (
                <Box component="li" aria-hidden sx={{ pt: i === 0 ? 0 : 2, pb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{formatDay(item.at, language)}</Typography>
                </Box>
              )}
              <LogRow projectId={projectId} item={item} page={page} />
            </Fragment>
          ))}
        </Box>
      )}
      {page !== null && (shown < page.items.length || page.next) && (
        <Box sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            disabled={loading}
            onClick={() => {
              // what is loaded first, then the next page
              if (shown < page.items.length) setShown(shown + SHOWN_STEP);
              else {
                setShown(shown + SHOWN_STEP);
                void load(filters, page.next);
              }
            }}
          >
            {t("activity.more")}
          </Button>
        </Box>
      )}
      {local ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t("activity.timesNoteLocal")}
        </Typography>
      ) : (
        <Explain variant="body2" sx={{ mt: 2 }} text={t("activity.timesNote.short")} more={t("activity.timesNote")} />
      )}
      <Box role="status" aria-live="polite" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {announce}
      </Box>
    </Section>
  );
}

const DOWNLOADS: { kind: ExportKind; label: "activity.download.people" | "activity.download.daily" | "activity.download.decisions" | "activity.download.differences"; help: "activity.download.peopleHelp" | "activity.download.dailyHelp" | "activity.download.decisionsHelp" | "activity.download.differencesHelp" }[] = [
  { kind: "people", label: "activity.download.people", help: "activity.download.peopleHelp" },
  { kind: "daily", label: "activity.download.daily", help: "activity.download.dailyHelp" },
  { kind: "decisions", label: "activity.download.decisions", help: "activity.download.decisionsHelp" },
  { kind: "differences", label: "activity.download.differences", help: "activity.download.differencesHelp" },
];

/** The weekly summary and the downloads, in one row above the log: the downloads in a menu, each with what it holds. */
function Actions({ projectId }: { projectId: string }) {
  const t = useT();
  // The local mode (one person): the daily activity only (src/localMode.ts, activityDownloads).
  const local = useLocalMode();
  const kinds = activityDownloads(local);
  const download = useDownload(projectId);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<{ kind: ExportKind; error: unknown } | null>(null);
  const run = async (kind: ExportKind) => {
    setMenu(null);
    setBusy(kind);
    setError(null);
    try {
      await download(kind);
    } catch (err) {
      setError({ kind, error: err });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="outlined" startIcon={<Download />} endIcon={<ExpandMore />} disabled={busy !== null} aria-haspopup="menu" onClick={(e) => setMenu(e.currentTarget)}>
          {t("activity.downloadsTitle")}
        </Button>
        <Button variant="outlined" startIcon={<EventNote />} {...linkProps(pathFor({ name: "weekly", projectId, week: null }))}>
          {t("activity.weeklyOpen")}
        </Button>
        <Typography variant="body2" color="text.secondary" sx={{ flexBasis: { xs: "100%", md: "auto" } }}>
          {t(local ? "activity.weeklyHelpLocal" : "activity.weeklyHelp")}
        </Typography>
      </Stack>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        {DOWNLOADS.filter((d) => kinds.includes(d.kind)).map((d) => (
          <MenuItem key={d.kind} onClick={() => void run(d.kind)} sx={{ whiteSpace: "normal", maxWidth: 440, alignItems: "flex-start", py: 1 }}>
            <ListItemText
              primary={t(d.label)}
              secondary={t(local && d.kind === "daily" ? "activity.download.dailyHelpLocal" : d.help)}
            />
          </MenuItem>
        ))}
      </Menu>
      {error &&
        (error.error instanceof ApiError && error.error.code === "no_figures" ? (
          <Alert severity="info" action={<Button {...linkProps(pathFor({ name: "project", projectId, tab: "quality", view: "figures" }))}>{t("activity.openQuality")}</Button>}>
            {t("activity.noFigures.short")}
            <MoreInfo text={t("activity.noFigures")} />
          </Alert>
        ) : (
          <ErrorAlert error={error.error} onRetry={() => void run(error.kind)} />
        ))}
    </Stack>
  );
}

/** The Activity tab (coordinators): the log, the weekly summary and the downloads. */
export function ActivityTab({ projectId }: { projectId: string }) {
  return (
    <Stack spacing={3}>
      <Actions projectId={projectId} />
      <ActivityLog projectId={projectId} />
    </Stack>
  );
}
