import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import ListSubheader from "@mui/material/ListSubheader";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import EventNote from "@mui/icons-material/EventNote";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, getActivity, type ActivityPage, type ExportKind, type LogItem, type LogKind } from "../api";
import { useApp, useLocalMode } from "../appContext";
import { COORDINATOR_LOG_KINDS, dayAfterMs, dayStartMs, LOG_KIND_LABELS, logSentence, RECORD_LOG_KINDS } from "../activityView";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
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

/** One row of the log: when, and what happened, with a link to the plot's page. */
function LogRow({ projectId, item, page }: { projectId: string; item: LogItem; page: ActivityPage }) {
  const t = useT();
  const { language } = useApp();
  const local = useLocalMode();
  const sentence = logSentence(t, item, page, language, { local });
  const plot = item.type === "record" ? item.plot : item.action.startsWith("decision.") && typeof item.details.plot === "string" ? item.details.plot : null;
  return (
    <Box component="li" sx={{ py: 1, borderBottom: 1, borderColor: "divider", display: "flex", gap: 2, flexWrap: { xs: "wrap", sm: "nowrap" } }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: { sm: 170 }, flexShrink: 0 }}>
        {formatDate(item.at, language)}
      </Typography>
      <Box sx={{ minWidth: 0, wordBreak: "break-word" }}>
        <Typography variant="body2" component="span">
          {sentence}
        </Typography>
        {plot !== null && (
          <>
            {" · "}
            <Link variant="body2" aria-label={t("activity.openPlotLabel", { plot })} {...linkProps(pathFor({ name: "plot", projectId, plot }))}>
              {t("activity.openPlot")}
            </Link>
          </>
        )}
      </Box>
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
        <TextField type="date" label={t("activity.from")} value={filters.from} onChange={(e) => set({ from: e.target.value })} size="small" fullWidth={false} sx={{ width: { xs: "100%", sm: 180 } }} slotProps={{ inputLabel: { shrink: true } }} />
        <TextField
          type="date"
          label={t("activity.to")}
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
          size="small"
          fullWidth={false}
          sx={{ width: { xs: "100%", sm: 180 } }}
          error={badRange}
          helperText={badRange ? t("activity.badRange") : undefined}
          slotProps={{ inputLabel: { shrink: true } }}
        />
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
          {page.items.map((item) => (
            <LogRow key={item.id} projectId={projectId} item={item} page={page} />
          ))}
        </Box>
      )}
      {page?.next && (
        <Box sx={{ mt: 2 }}>
          <Button variant="outlined" disabled={loading} onClick={() => void load(filters, page.next)}>
            {t("activity.more")}
          </Button>
        </Box>
      )}
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        {t(local ? "activity.timesNoteLocal" : "activity.timesNote")}
      </Typography>
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

function Downloads({ projectId }: { projectId: string }) {
  const t = useT();
  // The local mode (one person): the daily activity only (src/localMode.ts, activityDownloads).
  const local = useLocalMode();
  const kinds = activityDownloads(local);
  const download = useDownload(projectId);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<{ kind: ExportKind; error: unknown } | null>(null);
  const run = async (kind: ExportKind) => {
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
    <Section title={t("activity.downloadsTitle")} id="activity-downloads">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("activity.downloadsHelp")}
      </Typography>
      <Stack spacing={2}>
        {DOWNLOADS.filter((d) => kinds.includes(d.kind)).map((d) => (
          <Box key={d.kind}>
            <Button variant="outlined" startIcon={<Download />} disabled={busy !== null} onClick={() => void run(d.kind)}>
              {t(d.label)}
            </Button>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t(local && d.kind === "daily" ? "activity.download.dailyHelpLocal" : d.help)}
            </Typography>
            {error?.kind === d.kind &&
              (error.error instanceof ApiError && error.error.code === "no_figures" ? (
                <Alert severity="info" sx={{ mt: 1 }} action={<Button {...linkProps(pathFor({ name: "project", projectId, tab: "quality" }))}>{t("activity.openQuality")}</Button>}>
                  {t("activity.noFigures")}
                </Alert>
              ) : (
                <Box sx={{ mt: 1 }}>
                  <ErrorAlert error={error.error} onRetry={() => void run(d.kind)} />
                </Box>
              ))}
          </Box>
        ))}
      </Stack>
    </Section>
  );
}

/** The Activity tab (coordinators): the log, the weekly summary and the downloads. */
export function ActivityTab({ projectId }: { projectId: string }) {
  const t = useT();
  const local = useLocalMode();
  return (
    <Stack spacing={3}>
      <Section title={t("activity.weeklyTitle")} id="activity-weekly">
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t(local ? "activity.weeklyHelpLocal" : "activity.weeklyHelp")}
        </Typography>
        <Button variant="contained" startIcon={<EventNote />} {...linkProps(pathFor({ name: "weekly", projectId, week: null }))}>
          {t("activity.weeklyOpen")}
        </Button>
      </Section>
      <ActivityLog projectId={projectId} />
      <Downloads projectId={projectId} />
    </Stack>
  );
}
