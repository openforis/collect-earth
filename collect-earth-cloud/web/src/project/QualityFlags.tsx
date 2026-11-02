import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ApiError,
  FLAG_KINDS,
  getFlags,
  MAX_FAST_SECONDS,
  MIN_FAST_SECONDS,
  NO_FLAGS_FILTER,
  saveFastSeconds,
  type FlagKind,
  type FlagsData,
  type FlagsFilter,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { FLAG_KIND_KEYS, flagText, parseSeconds, PROBLEM_KINDS } from "../flagsView";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

/** The select value for "everyone" / "all kinds" (an empty value would leave the field looking blank). */
const ALL = "__all__";

/** Flags shown before "Show all". */
const FLAGS_SHOWN = 20;

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto", maxHeight: 420 } as const;

function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 220 } }}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select labelId={id} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </FormControl>
  );
}

/** The "very fast" threshold: coordinators change it, reviewers read it. */
function Threshold({ projectId, data, canEdit, onSaved }: { projectId: string; data: FlagsData; canEdit: boolean; onSaved: () => void }) {
  const t = useT();
  const [text, setText] = useState(String(data.fastSeconds));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => setText(String(data.fastSeconds)), [data.fastSeconds]);
  if (!canEdit) {
    return (
      <Typography variant="body2" color="text.secondary">
        {data.fastSeconds === 1 ? t("flags.fastReadOnlyOne") : t("flags.fastReadOnly", { n: data.fastSeconds })}
      </Typography>
    );
  }
  const value = parseSeconds(text, MIN_FAST_SECONDS, MAX_FAST_SECONDS);
  const range = { min: MIN_FAST_SECONDS, max: MAX_FAST_SECONDS };
  const save = async () => {
    if (value === null) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await saveFastSeconds(projectId, value);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Stack spacing={1}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
        <TextField
          size="small"
          label={t("flags.fastLabel")}
          value={text}
          onChange={(e) => (setText(e.target.value), setSaved(false))}
          error={value === null}
          helperText={value === null ? t("flags.fastInvalid", range) : t("flags.fastHelp", range)}
          slotProps={{ htmlInput: { inputMode: "numeric" } }}
          sx={{ maxWidth: { sm: 320 } }}
        />
        <Button variant="outlined" onClick={() => void save()} disabled={saving || value === null || value === data.fastSeconds} sx={{ mt: { sm: 0.25 } }}>
          {t("flags.fastSave")}
        </Button>
      </Stack>
      {saved && (
        <Typography variant="body2" role="status">
          {t("flags.fastSaved")}
        </Typography>
      )}
      {error !== null && <ErrorAlert error={error} />}
    </Stack>
  );
}

function PeopleCounts({ data, onPerson }: { data: FlagsData; onPerson: (username: string) => void }) {
  const t = useT();
  const { language } = useApp();
  const kinds = FLAG_KINDS.filter((k) => data.people.some((p) => p.counts[k] > 0));
  if (data.people.length === 0) return null;
  return (
    <Box>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {t("flags.byPerson")}
      </Typography>
      <TableContainer sx={tableFrame}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("flags.personColumn")}</TableCell>
              {kinds.map((k) => (
                <TableCell key={k} align="right">
                  {t(FLAG_KIND_KEYS[k])}
                </TableCell>
              ))}
              <TableCell align="right">{t("flags.totalColumn")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.people.map((p) => (
              <TableRow key={p.username}>
                <TableCell>
                  <Button size="small" sx={{ minWidth: 0, p: 0, textTransform: "none" }} onClick={() => onPerson(p.username)} aria-label={t("flags.showPerson", { person: p.username })}>
                    {p.username}
                  </Button>
                </TableCell>
                {kinds.map((k) => (
                  <TableCell key={k} align="right">
                    {formatNumber(p.counts[k], language)}
                  </TableCell>
                ))}
                <TableCell align="right">{formatNumber(p.total, language)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

/**
 * The Quality tab's "Plots worth a look" (Task 5; coordinators and reviewers, never
 * collectors, never My work): plots found from how they were collected, without any
 * check. A reason to open the plot, never a verdict: nothing is blocked or changed.
 */
export function QualityFlags({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const t = useT();
  const { language } = useApp();
  const [filter, setFilter] = useState<FlagsFilter>(NO_FLAGS_FILTER);
  const [all, setAll] = useState(false);
  const key = JSON.stringify(filter);
  const flags = useLoad(() => getFlags(projectId, filter), [projectId, key]);
  const { data, error, loading, reload } = flags;
  const busy = error instanceof ApiError && error.code === "busy";
  // Newer figures are being worked out (or the server is busy): ask again in a while.
  useEffect(() => {
    if (loading || !(data?.stale || busy)) return;
    const id = window.setTimeout(reload, busy ? 15_000 : 20_000);
    return () => window.clearTimeout(id);
  }, [loading, data?.stale, busy, reload]);

  const filtered = filter.person !== null || filter.kind !== null;
  const people = data ? [...new Set([...data.people.map((p) => p.username), ...(filter.person ? [filter.person] : [])])].sort() : [];
  const shown = data ? (all ? data.flags : data.flags.slice(0, FLAGS_SHOWN)) : [];
  const problems = data ? PROBLEM_KINDS.reduce((sum, k) => sum + data.counts[k], 0) : 0;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="flags-title">
      <Stack spacing={2}>
        <Typography variant="h2" id="flags-title">
          {t("flags.title")}
        </Typography>
        <Typography color="text.secondary">{t("flags.explain")}</Typography>
        {!data && loading && <Loading />}
        {busy && (
          <Alert severity="info" role="status" action={<Button color="inherit" size="small" onClick={reload}>{t("common.retry")}</Button>}>
            {t("quality.busy")}
          </Alert>
        )}
        {error !== null && !busy && <ErrorAlert error={error} onRetry={reload} />}
        {data && (
          <Box sx={{ opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }} aria-busy={loading}>
            <Stack spacing={2}>
              <Threshold projectId={projectId} data={data} canEdit={canEdit} onSaved={reload} />
              <Typography variant="body2" color="text.secondary">
                {t(data.requiredQuestions > 0 ? "flags.requiredNote" : "flags.requiredNone")}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                <SelectField label={t("answers.filterPerson")} value={filter.person ?? ALL} onChange={(v) => (setFilter({ ...filter, person: v === ALL ? null : v }), setAll(false))}>
                  <MenuItem value={ALL}>{t("answers.everyone")}</MenuItem>
                  {people.map((p) => (
                    <MenuItem key={p} value={p}>
                      {p}
                    </MenuItem>
                  ))}
                </SelectField>
                <SelectField label={t("flags.filterKind")} value={filter.kind ?? ALL} onChange={(v) => (setFilter({ ...filter, kind: v === ALL ? null : (v as FlagKind) }), setAll(false))}>
                  <MenuItem value={ALL}>{t("flags.allKinds")}</MenuItem>
                  {FLAG_KINDS.map((k) => (
                    <MenuItem key={k} value={k}>
                      {t(FLAG_KIND_KEYS[k])}
                      {data.counts[k] > 0 ? ` (${formatNumber(data.counts[k], language)})` : ""}
                    </MenuItem>
                  ))}
                </SelectField>
                {filtered && (
                  <Button size="small" onClick={() => (setFilter(NO_FLAGS_FILTER), setAll(false))} sx={{ alignSelf: { sm: "center" } }}>
                    {t("answers.clear")}
                  </Button>
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {/* Only the count is announced, when it changes: the time after it changes at each reload. */}
                <span aria-live="polite">
                  {t(filtered ? "flags.countFiltered" : "flags.count", { n: formatNumber(data.total, language), plots: formatNumber(data.plots, language) })}
                </span>
                {data.computedAt !== null && ` ${t(data.stale ? "answers.asOfStale" : "answers.asOf", { time: formatDate(data.computedAt, language) })}`}
              </Typography>
              {problems > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t(canEdit ? "flags.problemsNote" : "flags.problemsNoteReviewer")}
                </Typography>
              )}
              {data.flags.length === 0 ? (
                <Typography>{t(filtered ? "flags.noneFiltered" : "flags.none")}</Typography>
              ) : (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t("flags.order")}
                  </Typography>
                  <Stack component="ul" spacing={0.75} sx={{ m: 0, pl: 2.5 }}>
                    {shown.map((f, i) => (
                      <Box component="li" key={`${f.kind} ${f.plot} ${f.operator} ${i}`} sx={{ wordBreak: "break-word" }}>
                        <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>
                          {t("flags.plot", { plot: f.plot })}
                        </Typography>
                        <Typography variant="body2" component="span" color="text.secondary">
                          {" · "}
                          {f.operator}
                          {f.at !== null ? ` · ${formatDate(f.at, language)}` : ""}
                          {" · "}
                          {t(FLAG_KIND_KEYS[f.kind])}
                        </Typography>
                        <Typography variant="body2">{flagText(t, f, language)}</Typography>
                      </Box>
                    ))}
                  </Stack>
                  {data.flags.length > FLAGS_SHOWN && (
                    <Button size="small" onClick={() => setAll(!all)} sx={{ mt: 0.5 }}>
                      {all
                        ? t("flags.showFewer")
                        : data.total > data.flags.length
                          ? t("flags.showListed", { n: formatNumber(data.flags.length, language), total: formatNumber(data.total, language) })
                          : t("flags.showAll", { n: formatNumber(data.total, language) })}
                    </Button>
                  )}
                  {all && data.total > data.flags.length && (
                    <Typography variant="body2" color="text.secondary">
                      {t("flags.capped", { n: formatNumber(data.flags.length, language), total: formatNumber(data.total, language) })}
                    </Typography>
                  )}
                </Box>
              )}
              <PeopleCounts data={data} onPerson={(username) => (setFilter({ ...filter, person: username }), setAll(false))} />
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
