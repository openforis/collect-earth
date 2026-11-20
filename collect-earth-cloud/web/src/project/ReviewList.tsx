import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
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
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  applyDecisions,
  FLAG_KINDS,
  getReviewList,
  type ApplyDecisionsAnswer,
  type DecisionKind,
  type QueueKind,
  type ReviewListAnswer,
  type ReviewListLine,
  type ReviewListQuery,
  type ReviewListSort,
  type ReviewListState,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { FLAG_KIND_KEYS } from "../flagsView";
import { formatDate, formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor } from "../router";
import { applyTarget, cardSequence, isPicked, kindsText, NO_SELECTION, pageCount, pageOf, pageState, pickedCount, skippedText, toggle, togglePage, type Selection } from "../reviewListView";

const ALL = "__all__";
const PAGE_SIZES = [50, 100, 200] as const;
const STATES: { value: ReviewListState; label: MessageKey }[] = [
  { value: "waiting", label: "reviewList.state.waiting" },
  { value: "decided", label: "reviewList.state.decided" },
  { value: "all", label: "reviewList.state.all" },
];
const SORTS: { value: ReviewListSort; label: MessageKey }[] = [
  { value: "queue", label: "reviewList.sort.queue" },
  { value: "plot", label: "reviewList.sort.plot" },
  { value: "person", label: "reviewList.sort.person" },
  { value: "kind", label: "reviewList.sort.kind" },
];
const DECISIONS: { kind: DecisionKind; label: MessageKey }[] = [
  { kind: "first", label: "quality.decision.first" },
  { kind: "check", label: "quality.decision.check" },
  { kind: "recheck", label: "quality.decision.recheck" },
];
const DECISION_LABEL = new Map(DECISIONS.map((d) => [d.kind, d.label]));

function Field({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: 180 } }}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select labelId={id} label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </FormControl>
  );
}

/**
 * The review queue as a list (docs/plans/2026-11-20-review-at-scale.md, A1-A2): one line per plot, searched, sorted and
 * paged, plots picked one by one, a page at a time or all that match, and one decision for them. A plot still waiting
 * opens in the one-at-a-time view with the page's other waiting plots after it; a decided one on its own page. The
 * query and the selection are the queue's (kept while the card is shown).
 */
export function ReviewList({
  projectId,
  query,
  onQuery,
  selection,
  onSelection,
  onOpen,
  onApplied,
}: {
  projectId: string;
  query: ReviewListQuery;
  onQuery: (q: ReviewListQuery) => void;
  selection: Selection;
  onSelection: (s: Selection) => void;
  /** Open these plots (still waiting) one at a time, the first shown first */
  onOpen: (plots: string[]) => void;
  /** A decision was made for many plots */
  onApplied: () => void;
}) {
  const t = useT();
  const { language } = useApp();
  const [data, setData] = useState<ReviewListAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState(query.q);
  const [deciding, setDeciding] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const latest = useRef(0);

  // The search is asked for once typing stops
  useEffect(() => {
    if (search === query.q) return;
    const timer = window.setTimeout(() => onQuery({ ...query, q: search, offset: 0 }), 300);
    return () => window.clearTimeout(timer);
  }, [search, query, onQuery]);

  const load = () => {
    const call = ++latest.current;
    setLoading(true);
    setError(null);
    getReviewList(projectId, query).then(
      (answer) => {
        if (call !== latest.current) return;
        setData(answer);
        setLoading(false);
      },
      (err: unknown) => {
        if (call !== latest.current) return;
        setError(err);
        setLoading(false);
      },
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [projectId, query]);

  const set = (change: Partial<ReviewListQuery>) => {
    // Other filters, other plots: the selection is left (a plot picked may no longer be shown)
    onSelection(NO_SELECTION);
    onQuery({ ...query, offset: 0, ...change });
  };
  const lines = data?.lines ?? [];
  const page = lines.map((l) => l.plot);
  const total = data?.total ?? 0;
  const picked = pickedCount(selection, total);
  const state = pageState(selection, page);
  const people = data ? [...new Set([...data.people, ...(query.person ? [query.person] : [])])].sort() : [];
  const kinds: QueueKind[] = ["difference", ...FLAG_KINDS, "resubmitted"];
  const kindLabel = (k: QueueKind): string => (k === "difference" ? t("queue.kind.difference") : k === "resubmitted" ? t("queue.kind.resubmitted") : t(FLAG_KIND_KEYS[k]));
  const busyFigures = error instanceof ApiError && error.code === "busy";

  const decisionText = (line: ReviewListLine): string => {
    const d = line.decision;
    if (!d) return t("reviewList.undecided");
    const label = DECISION_LABEL.get(d.decision);
    return t("reviewList.decidedBy", { decision: label ? t(label) : d.decision, name: d.decidedBy ?? "—", time: formatDate(d.decidedAt, language) });
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <TextField size="small" label={t("reviewList.search")} value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: { xs: "100%", sm: 180 } }} />
        <Field label={t("reviewList.state")} value={query.state} onChange={(v) => set({ state: v as ReviewListState })}>
          {STATES.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {t(s.label)}
            </MenuItem>
          ))}
        </Field>
        <Field label={t("queue.filterKind")} value={query.kind ?? ALL} onChange={(v) => set({ kind: v === ALL ? null : (v as QueueKind) })}>
          <MenuItem value={ALL}>{t("queue.allKinds")}</MenuItem>
          {kinds.map((k) => (
            <MenuItem key={k} value={k}>
              {kindLabel(k)}
            </MenuItem>
          ))}
        </Field>
        {/* A reviewer's list names nobody to filter by (the server sends no names) */}
        {people.length > 0 && (
          <Field label={t("answers.filterPerson")} value={query.person ?? ALL} onChange={(v) => set({ person: v === ALL ? null : v })}>
            <MenuItem value={ALL}>{t("answers.everyone")}</MenuItem>
            {people.map((p) => (
              <MenuItem key={p} value={p}>
                {p}
              </MenuItem>
            ))}
          </Field>
        )}
        <Field label={t("reviewList.sort")} value={query.sort} onChange={(v) => set({ sort: v as ReviewListSort })}>
          {SORTS.map((s) => (
            <MenuItem key={s.value} value={s.value}>
              {t(s.label)}
            </MenuItem>
          ))}
        </Field>
        <FormControlLabel control={<Checkbox size="small" checked={query.descending} onChange={(e) => set({ descending: e.target.checked })} />} label={t("reviewList.descending")} />
      </Stack>

      {done !== null && (
        <Alert severity="success" onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
      {!data && loading && <Loading />}
      {busyFigures && (
        <Alert severity="info" role="status" action={<Button color="inherit" size="small" onClick={load}>{t("common.retry")}</Button>}>
          {t("quality.busy")}
        </Alert>
      )}
      {error !== null && !busyFigures && <ErrorAlert error={error} onRetry={load} />}

      {data && (
        <Stack spacing={1.5} sx={{ opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }} aria-busy={loading}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ alignItems: { sm: "center" }, flexWrap: "wrap" }}>
            <Typography variant="body2" color="text.secondary">
              {total === 1 ? t("reviewList.totalOne") : t("reviewList.total", { n: formatNumber(total, language) })}
              {` ${t(data.stale ? "answers.asOfStale" : "answers.asOf", { time: formatDate(data.computedAt, language) })}`}
            </Typography>
            {picked > 0 && (
              <>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {selection.allMatching ? t("reviewList.pickedAll", { n: formatNumber(total, language) }) : t("reviewList.picked", { n: formatNumber(picked, language) })}
                </Typography>
                {!selection.allMatching && state === "all" && total > page.length && (
                  <Button size="small" onClick={() => onSelection({ plots: new Set(), allMatching: true })}>
                    {t("reviewList.selectAll", { n: formatNumber(total, language) })}
                  </Button>
                )}
                <Button size="small" onClick={() => onSelection(NO_SELECTION)}>
                  {t("reviewList.clear")}
                </Button>
                <Button size="small" variant="contained" onClick={() => setDeciding(true)}>
                  {t("reviewList.decide", { n: formatNumber(picked, language) })}
                </Button>
              </>
            )}
          </Stack>

          {lines.length === 0 ? (
            <Alert severity="success">{t("reviewList.none")}</Alert>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={state === "all"}
                        indeterminate={state === "some"}
                        onChange={() => onSelection(togglePage(selection.allMatching ? NO_SELECTION : selection, page))}
                        slotProps={{ input: { "aria-label": t("reviewList.selectPage") } }}
                      />
                    </TableCell>
                    <TableCell>{t("reviewList.col.plot")}</TableCell>
                    <TableCell>{t("reviewList.col.why")}</TableCell>
                    <TableCell>{t("reviewList.col.people")}</TableCell>
                    <TableCell align="right">{t("reviewList.col.checks")}</TableCell>
                    <TableCell>{t("reviewList.col.decision")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.plot} hover selected={isPicked(selection, line.plot)}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={isPicked(selection, line.plot)}
                          onChange={() => onSelection(selection.allMatching ? { plots: new Set(page.filter((p) => p !== line.plot)), allMatching: false } : toggle(selection, line.plot))}
                          slotProps={{ input: { "aria-label": t("reviewList.selectLine", { plot: line.plot }) } }}
                        />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {line.section !== null ? (
                          <Link component="button" type="button" variant="body2" onClick={() => onOpen(cardSequence(lines, line.plot))} aria-label={t("reviewList.open", { plot: line.plot })}>
                            {line.plot}
                          </Link>
                        ) : (
                          <Link variant="body2" {...linkProps(pathFor({ name: "plot", projectId, plot: line.plot }))} aria-label={t("reviewList.open", { plot: line.plot })}>
                            {line.plot}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>{kindsText(t, line)}</TableCell>
                      <TableCell>{line.people.join(", ")}</TableCell>
                      <TableCell align="right">{formatNumber(line.checks, language)}</TableCell>
                      <TableCell>{decisionText(line)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between" }}>
            {pageCount(total, query.limit) > 1 ? (
              <Pagination
                count={pageCount(total, query.limit)}
                page={pageOf(query.offset, query.limit)}
                onChange={(_, p) => onQuery({ ...query, offset: (p - 1) * query.limit })}
                getItemAriaLabel={(type, p) => (type === "page" ? t("reviewList.page", { page: String(p) }) : t(`accounts.pageNav.${type}` as MessageKey))}
              />
            ) : (
              <Box />
            )}
            <Field label={t("reviewList.perPage")} value={String(query.limit)} onChange={(v) => set({ limit: Number(v) })}>
              {PAGE_SIZES.map((n) => (
                <MenuItem key={n} value={String(n)}>
                  {n}
                </MenuItem>
              ))}
            </Field>
          </Stack>
        </Stack>
      )}

      {deciding && (
        <ApplyDialog
          projectId={projectId}
          count={picked}
          target={applyTarget(selection, query)}
          onClose={() => setDeciding(false)}
          onDone={(answer) => {
            setDeciding(false);
            setDone(t("reviewList.done", { n: formatNumber(answer.count, language) }));
            onSelection(NO_SELECTION);
            load();
            onApplied();
          }}
        />
      )}
    </Stack>
  );
}

/** One decision for the plots picked: the decision and a comment, a count first (and those that cannot take it), then do it. */
function ApplyDialog({
  projectId,
  count,
  target,
  onClose,
  onDone,
}: {
  projectId: string;
  count: number;
  target: ReturnType<typeof applyTarget>;
  onClose: () => void;
  onDone: (answer: ApplyDecisionsAnswer) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const [decision, setDecision] = useState<DecisionKind>("first");
  const [comment, setComment] = useState("");
  const [dry, setDry] = useState<ApplyDecisionsAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const titleId = useId();
  const latest = useRef(0);

  // A count for the decision chosen (a "check is right" skips the plots without a check)
  useEffect(() => {
    const call = ++latest.current;
    setDry(null);
    setError(null);
    applyDecisions(projectId, target, decision, "", true).then(
      (answer) => call === latest.current && setDry(answer),
      (err: unknown) => call === latest.current && setError(err),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, decision]);

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await applyDecisions(projectId, target, decision, comment, false));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{count === 1 ? t("reviewList.dialogTitleOne") : t("reviewList.dialogTitle", { n: formatNumber(count, language) })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Field label={t("reviewList.decision")} value={decision} onChange={(v) => setDecision(v as DecisionKind)}>
            {DECISIONS.map((d) => (
              <MenuItem key={d.kind} value={d.kind}>
                {t(d.label)}
              </MenuItem>
            ))}
          </Field>
          <TextField label={t("reviewList.comment")} value={comment} onChange={(e) => setComment(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 2000 } }} />
          <Typography variant="body2" color="text.secondary">
            {t("reviewList.replaceNote")}
          </Typography>
          {!dry && !error && <Loading />}
          {dry && (
            <Stack spacing={1} role="status">
              <Typography variant="body2">{t("reviewList.willDecide", { n: formatNumber(dry.count, language) })}</Typography>
              {dry.skippedCount > 0 && (
                <Alert severity="warning">
                  <Typography variant="body2">{t("reviewList.skippedCount", { n: formatNumber(dry.skippedCount, language) })}</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {dry.skipped.map((s) => (
                      <li key={s.plot}>
                        <Typography variant="body2">{skippedText(t, s)}</Typography>
                      </li>
                    ))}
                  </Box>
                  {dry.skippedCount > dry.skipped.length && <Typography variant="body2">{t("reviewList.skippedMore", { n: formatNumber(dry.skippedCount - dry.skipped.length, language) })}</Typography>}
                </Alert>
              )}
            </Stack>
          )}
          {error !== null && <ErrorAlert error={error} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="contained" onClick={() => void go()} disabled={busy || !dry || dry.count === 0}>
          {dry?.count === 1 ? t("reviewList.doOne") : t("reviewList.do", { n: formatNumber(dry?.count ?? 0, language) })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
