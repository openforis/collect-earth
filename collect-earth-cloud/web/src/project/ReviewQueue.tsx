import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import OpenInNew from "@mui/icons-material/OpenInNew";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import {
  ApiError,
  bulkDecisions,
  deleteQualityDecision,
  FLAG_KINDS,
  getPlotPlaces,
  getReviewQueue,
  NO_QUEUE_FILTER,
  setQualityDecision,
  type BulkResult,
  type BulkRule,
  type DecisionKind,
  type PlotOutline,
  type PlotPlace,
  type QualityDecision,
  type QueueFilter,
  type QueueItem,
  type QueueKind,
  type QueueSection,
  type ReviewQueueData,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { FLAG_KIND_KEYS, flagText } from "../flagsView";
import { formatDate, formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { googleEarthUrl } from "../qualityView";
import { earthMapUrl, nextUndecided, queueKeyAction, stepIndex } from "../reviewQueueView";
import { CheckAnswers } from "./QualityDifferences";

/** The select value for "everyone" / "every plot" (an empty value would leave the field looking blank). */
const ALL = "__all__";

const DECISIONS: { kind: DecisionKind; key: string; label: MessageKey }[] = [
  { kind: "first", key: "1", label: "quality.decision.first" },
  { kind: "check", key: "2", label: "quality.decision.check" },
  { kind: "recheck", key: "3", label: "quality.decision.recheck" },
];
const DECISION_LABEL: Record<DecisionKind, MessageKey> = {
  first: "quality.decision.first",
  check: "quality.decision.check",
  recheck: "quality.decision.recheck",
};
const SECTION_LABEL: Record<QueueSection, MessageKey> = {
  difference: "queue.section.difference",
  flag: "queue.section.flag",
  resubmitted: "queue.section.resubmitted",
};
const BULK_RULES: BulkRule[] = ["first_by_reviewer", "check_by_reviewer"];
const BULK_LABEL: Record<BulkRule, MessageKey> = { first_by_reviewer: "queue.bulk.first_by_reviewer", check_by_reviewer: "queue.bulk.check_by_reviewer" };
const BULK_CONFIRM: Record<BulkRule, MessageKey> = { first_by_reviewer: "queue.bulkConfirm.first_by_reviewer", check_by_reviewer: "queue.bulkConfirm.check_by_reviewer" };

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

/** The two bulk rules (coordinators): a dry run gives the count, a dialog asks before deciding. */
function Bulk({ projectId, onDone }: { projectId: string; onDone: (count: number) => void }) {
  const t = useT();
  const { language } = useApp();
  const [asking, setAsking] = useState<BulkRule | null>(null);
  const [dry, setDry] = useState<{ rule: BulkRule; result: BulkResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ask = async (rule: BulkRule) => {
    if (asking !== null || busy) return;
    setAsking(rule);
    setError(null);
    try {
      setDry({ rule, result: await bulkDecisions(projectId, rule, true) });
    } catch (err) {
      setError(err);
    } finally {
      setAsking(null);
    }
  };
  const apply = async () => {
    if (!dry) return;
    setBusy(true);
    setError(null);
    try {
      const done = await bulkDecisions(projectId, dry.rule, false);
      setDry(null);
      onDone(done.count);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const count = dry?.result.count ?? 0;
  const more = dry ? count - dry.result.plots.length : 0;
  return (
    <Box>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        {t("queue.bulkTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t("queue.bulkExplain")}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {BULK_RULES.map((rule) => (
          // Not disabled while asking (the button keeps the keyboard focus, and the dialog gives it back on closing).
          <Button key={rule} variant="outlined" size="small" onClick={() => void ask(rule)} aria-disabled={asking !== null || busy}>
            {t(BULK_LABEL[rule])}
          </Button>
        ))}
      </Stack>
      {error !== null && dry === null && <ErrorAlert error={error} />}
      {dry && (
        <Dialog open onClose={() => !busy && setDry(null)} fullWidth maxWidth="sm" aria-labelledby="bulk-title" aria-describedby="bulk-text">
          <DialogTitle id="bulk-title">{count === 0 ? t(BULK_LABEL[dry.rule]) : t("queue.bulkConfirmTitle", { n: formatNumber(count, language) })}</DialogTitle>
          <DialogContent>
            <Stack spacing={1.5}>
              <Typography id="bulk-text">{count === 0 ? t("queue.bulkNone") : t(BULK_CONFIRM[dry.rule], { decision: t(DECISION_LABEL[dry.result.decision]) })}</Typography>
              <Typography variant="body2">{t("queue.bulkRoles")}</Typography>
              {count > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                  {t("queue.bulkPlots", { plots: dry.result.plots.join(", ") })}
                  {more > 0 ? ` ${t("queue.bulkMore", { n: formatNumber(more, language) })}` : ""}
                </Typography>
              )}
              {error !== null && <ErrorAlert error={error} />}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDry(null)} disabled={busy}>
              {count === 0 ? t("common.close") : t("common.cancel")}
            </Button>
            {count > 0 && (
              <Button variant="contained" onClick={() => void apply()} disabled={busy}>
                {t("queue.bulkDo", { n: formatNumber(count, language) })}
              </Button>
            )}
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

/** One plot of the queue: what is known of it, its links, and the decision. */
function QueueCard({
  item,
  position,
  total,
  decision,
  place,
  outline,
  labels,
  data,
  busy,
  comment,
  onComment,
  commentRef,
  cardRef,
  onDecide,
  onUndo,
  onMove,
  canMoveBack,
  canMoveOn,
}: {
  item: QueueItem;
  position: number;
  total: number;
  decision: QualityDecision | null;
  place: PlotPlace | null | undefined;
  outline: PlotOutline;
  labels: (key: string) => string;
  data: ReviewQueueData;
  busy: boolean;
  comment: string;
  onComment: (text: string) => void;
  commentRef: RefObject<HTMLTextAreaElement | null>;
  cardRef: RefObject<HTMLElement | null>;
  onDecide: (kind: DecisionKind) => void;
  onUndo: () => void;
  onMove: (step: 1 | -1) => void;
  canMoveBack: boolean;
  canMoveOn: boolean;
}) {
  const t = useT();
  const { language } = useApp();
  const headingId = useId();
  const noCheck = item.differences.length === 0;
  return (
    <Paper
      variant="outlined"
      component="article"
      ref={cardRef}
      tabIndex={0}
      aria-labelledby={headingId}
      data-plot={item.plot}
      sx={{ p: { xs: 1.5, sm: 2 }, outline: "none", "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="h3" id={headingId} sx={{ wordBreak: "break-word" }}>
            {t("quality.plot", { plot: item.plot })}
            <Box component="span" sx={{ color: "text.secondary", fontWeight: 400, ml: 1 }}>
              {` (${t("queue.position", { n: formatNumber(position, language), total: formatNumber(total, language) })})`}
            </Box>
          </Typography>
          <Chip size="small" variant="outlined" label={t(SECTION_LABEL[item.section])} />
        </Stack>
        {place && (
          <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
            <Link href={googleEarthUrl(place.lat, place.lon)} target="_blank" rel="noopener noreferrer" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              {t("quality.googleEarth")}
              <OpenInNew fontSize="small" titleAccess={t("common.newTab")} />
            </Link>
            <Link
              href={earthMapUrl(place.name, place.lat, place.lon, outline)}
              target="_blank"
              rel="noopener noreferrer"
              title={outline.kind === "place" ? t("queue.earthMapPlaceTitle") : undefined}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
            >
              {t(outline.kind === "place" ? "queue.earthMapPlace" : "queue.earthMap")}
              <OpenInNew fontSize="small" titleAccess={t("common.newTab")} />
            </Link>
          </Stack>
        )}
        {item.differences.map((d) =>
          d.fields.length > 0 && !d.changed ? (
            <CheckAnswers key={`${d.check.operator}\u0000${d.check.recordKey}`} difference={d} label={labels} options={data.options} />
          ) : (
            <Alert key={`${d.check.operator}\u0000${d.check.recordKey}`} severity="info">
              {t("queue.answersChanged", { first: d.first.operator, check: d.check.operator })}
            </Alert>
          ),
        )}
        {item.flags.length > 0 && (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {t("queue.flagsHeading")}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {item.flags.map((f, i) => (
                <Box component="li" key={`${f.kind} ${f.operator} ${i}`} sx={{ wordBreak: "break-word" }}>
                  <Typography variant="body2" component="span" color="text.secondary">
                    {t(FLAG_KIND_KEYS[f.kind])} · {f.operator}
                    {f.at !== null ? ` · ${formatDate(f.at, language)}` : ""}
                    {": "}
                  </Typography>
                  <Typography variant="body2" component="span">
                    {flagText(t, f, language)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
        {item.resubmitted.map((r) => (
          <Typography key={r.operator} variant="body2">
            {t("queue.resubmittedBy", { name: r.operator, time: formatDate(r.at, language), decided: formatDate(r.decidedAt, language) })}
          </Typography>
        ))}
        {decision?.decision === "recheck" && item.waiting !== null && (item.resubmitted.length > 0 || item.waiting.length === 0) && (
          <Typography variant="body2">
            {item.waiting.length > 0 ? t("queue.waitingFor", { names: item.waiting.join(", ") }) : t("queue.allSubmittedAgain")}
          </Typography>
        )}
        {decision?.decision === "recheck" && item.left.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t("queue.leftProject", { names: item.left.join(", ") })}
          </Typography>
        )}
        {decision && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Chip color="primary" variant="outlined" label={t("quality.decided", { decision: t(DECISION_LABEL[decision.decision]) })} />
            {(decision.decidedBy || decision.decidedAt !== null) && (
              <Typography variant="body2" color="text.secondary">
                {decision.decidedBy ? t("quality.decidedBy", { name: decision.decidedBy, time: formatDate(decision.decidedAt, language) }) : formatDate(decision.decidedAt, language)}
              </Typography>
            )}
            {decision.byAssessor && (
              <Typography variant="body2" color="text.secondary">
                {t("quality.byAssessor")}
              </Typography>
            )}
            <Button size="small" onClick={onUndo} aria-disabled={busy} aria-describedby={headingId}>
              {t("quality.undo")}
            </Button>
          </Stack>
        )}
        {decision?.comment && <Typography sx={{ wordBreak: "break-word" }}>{decision.comment}</Typography>}
        {noCheck && (
          <Typography variant="body2" color="text.secondary">
            {t("queue.noCheck")}
          </Typography>
        )}
        <TextField
          label={t("quality.comment")}
          helperText={t("quality.commentSeen")}
          value={comment}
          onChange={(e) => onComment(e.target.value)}
          size="small"
          multiline
          inputRef={commentRef}
          slotProps={{ htmlInput: { maxLength: 2000 } }}
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          {DECISIONS.map((d) => (
            <Button
              key={d.kind}
              variant={decision?.decision === d.kind ? "contained" : "outlined"}
              onClick={() => onDecide(d.kind)}
              disabled={busy || (d.kind === "check" && noCheck)}
              aria-describedby={headingId}
              aria-keyshortcuts={d.key}
            >
              <Box component="span" aria-hidden sx={{ fontWeight: 700, mr: 1 }}>
                {d.key}
              </Box>
              {t(d.label)}
            </Button>
          ))}
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={() => onMove(-1)} disabled={!canMoveBack} aria-keyshortcuts="K">
            {t("queue.previous")}
          </Button>
          <Button size="small" onClick={() => onMove(1)} disabled={!canMoveOn} aria-keyshortcuts="J">
            {t("queue.next")}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

/**
 * The review queue (Task 7; coordinators and reviewers, never collectors): one plot at a
 * time, the differences without a decision first, then the plots worth a look, then those
 * submitted again after "both need another look". Keys 1/2/3 decide, J/K move, C goes to
 * the comment (never while typing). Coordinators also decide many at once.
 */
export function ReviewQueue({
  projectId,
  canBulk,
  onDecision,
  onBulk,
}: {
  projectId: string;
  canBulk: boolean;
  /** A decision was made (or undone, with null) here. */
  onDecision?: (plot: string, decision: QualityDecision | null) => void;
  /** Bulk decisions were made. */
  onBulk?: () => void;
}) {
  const t = useT();
  const { language } = useApp();
  const [filter, setFilter] = useState<QueueFilter>(NO_QUEUE_FILTER);
  const [data, setData] = useState<ReviewQueueData | null>(null);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [index, setIndex] = useState(0);
  /** Decisions made or undone here (null: undone), by plot. */
  const [local, setLocal] = useState<Map<string, QualityDecision | null>>(new Map());
  const [decidedHere, setDecidedHere] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [announce, setAnnouncement] = useState("");
  const announceTimer = useRef<number | undefined>(undefined);
  /** Says a text to screen readers; the region is emptied first, so the same text twice is said twice. */
  const setAnnounce = useCallback((text: string) => {
    setAnnouncement("");
    window.clearTimeout(announceTimer.current);
    announceTimer.current = window.setTimeout(() => setAnnouncement(text), 60);
  }, []);
  useEffect(() => () => window.clearTimeout(announceTimer.current), []);
  /** What the last bulk decision did (shown, and announced by the alert's status role). */
  const [bulkDone, setBulkDone] = useState<string | null>(null);
  const [places, setPlaces] = useState<Map<string, PlotPlace | null>>(new Map());
  /** The outline Collect Earth draws around each plot (the same for every plot of the survey). */
  const [outline, setOutline] = useState<PlotOutline>({ kind: "place" });
  const [unsupportedSrs, setUnsupportedSrs] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const latest = useRef(0);
  const focusCard = useRef(false);
  // "Load more" and Undo go away once they have done their work: the card takes the focus then.
  const focusAfterMore = useRef(false);

  const load = useCallback(
    (after: string | null) => {
      const call = ++latest.current;
      setLoading(true);
      setLoadError(null);
      getReviewQueue(projectId, filter, after).then(
        (answer) => {
          if (call !== latest.current) return;
          setData(answer);
          setItems((prev) => {
            if (after === null) return answer.items;
            const known = new Set(prev.map((i) => i.plot));
            return [...prev, ...answer.items.filter((i) => !known.has(i.plot))];
          });
          if (after === null) {
            setIndex(0);
            setLocal(new Map());
            setDecidedHere(new Set());
            setComment("");
          }
          setLoading(false);
        },
        (err: unknown) => {
          if (call !== latest.current) return;
          setLoadError(err);
          setLoading(false);
        },
      );
    },
    [projectId, filter],
  );
  useEffect(() => load(null), [load]);

  const current = items[Math.min(index, Math.max(0, items.length - 1))] as QueueItem | undefined;
  const decisionOf = (item: QueueItem): QualityDecision | null => (local.has(item.plot) ? local.get(item.plot)! : item.decision);

  // Where the plot shown and the next few are, for the map links.
  const wanted = unsupportedSrs === null ? items.slice(index, index + 10).map((i) => i.plot).filter((plot) => !places.has(plot)) : [];
  const wantedKey = wanted.join("\u0000");
  useEffect(() => {
    if (!wantedKey) return;
    let cancelled = false;
    const asked = wantedKey.split("\u0000");
    getPlotPlaces(projectId, asked).then(
      (answer) => {
        if (cancelled) return;
        if (answer.unsupportedSrs !== null) {
          setUnsupportedSrs(answer.unsupportedSrs);
          return;
        }
        const found = new Map(answer.places.map((place) => [place.plot, place]));
        setOutline(answer.outline);
        setPlaces((old) => new Map([...old, ...asked.map((plot) => [plot, found.get(plot) ?? null] as const)]));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, wantedKey]);

  // After moving with a key or a decision, the new plot's card takes the focus (keys keep working).
  useEffect(() => {
    if (focusCard.current) {
      focusCard.current = false;
      cardRef.current?.focus({ preventScroll: false });
    }
  }, [index, current?.plot]);

  useEffect(() => {
    if (focusAfterMore.current && !loading) {
      focusAfterMore.current = false;
      cardRef.current?.focus({ preventScroll: false });
    }
  }, [items.length, loading]);

  const goTo = (next: number, withFocus: boolean) => {
    if (next !== index) setComment("");
    focusCard.current = withFocus;
    setIndex(next);
  };

  const decide = async (kind: DecisionKind) => {
    if (!current || busy) return;
    if (kind === "check" && current.differences.length === 0) {
      setAnnounce(t("queue.checkNotApplicable", { plot: current.plot }));
      return;
    }
    const plot = current.plot;
    setBusy(true);
    setError(null);
    try {
      const saved = await setQualityDecision(projectId, plot, kind, comment);
      setLocal((m) => new Map(m).set(plot, saved));
      const done = new Set(decidedHere).add(plot);
      setDecidedHere(done);
      onDecision?.(plot, saved);
      const next = nextUndecided(
        items.map((i) => i.plot),
        done,
        index,
      );
      const nextItem = items[next];
      setAnnounce(
        `${t("queue.decidedAnnounce", { plot, decision: t(DECISION_LABEL[kind]) })}${nextItem && next !== index ? ` ${t("queue.nowAnnounce", { plot: nextItem.plot, n: next + 1, total: items.length })}` : ""}`,
      );
      goTo(next, true);
      setComment("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!current || busy) return;
    const plot = current.plot;
    setBusy(true);
    setError(null);
    try {
      await deleteQualityDecision(projectId, plot);
      setLocal((m) => new Map(m).set(plot, null));
      setDecidedHere((s) => {
        const n = new Set(s);
        n.delete(plot);
        return n;
      });
      onDecision?.(plot, null);
      setAnnounce(t("queue.undoneAnnounce", { plot }));
      window.setTimeout(() => cardRef.current?.focus({ preventScroll: true }), 0);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const move = (step: 1 | -1, withFocus: boolean) => {
    const next = stepIndex(index, items.length, step);
    if (next === index) return;
    const item = items[next];
    setAnnounce(t("queue.nowAnnounce", { plot: item.plot, n: next + 1, total: items.length }));
    goTo(next, withFocus);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!current) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const action = queueKeyAction({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      repeat: e.repeat,
      composing: e.nativeEvent.isComposing,
      // React sends a portal's keys (the bulk dialog's) up its tree: only those pressed in the section count.
      inside: e.target instanceof Node && e.currentTarget.contains(e.target),
      target: target && { tagName: target.tagName, type: (target as HTMLInputElement).type, isContentEditable: target.isContentEditable, getAttribute: (n) => target.getAttribute(n) },
    });
    if (action === null) return;
    // Only the queue's own fields: Escape in a menu or dialog elsewhere is theirs.
    if (action === "leave") {
      if (target !== commentRef.current) return;
      e.preventDefault();
      cardRef.current?.focus();
      return;
    }
    e.preventDefault();
    if (action === "next") move(1, true);
    else if (action === "previous") move(-1, true);
    else if (action === "comment") commentRef.current?.focus();
    else void decide(action);
  };

  const busyFigures = loadError instanceof ApiError && loadError.code === "busy";
  const filtered = filter.person !== null || filter.kind !== null;
  const people = data ? [...new Set([...data.people, ...(filter.person ? [filter.person] : [])])].sort() : [];
  const labels = (key: string) => data?.labels[key] ?? key;
  const kinds: QueueKind[] = ["difference", ...FLAG_KINDS, "resubmitted"];
  const kindLabel = (k: QueueKind): string => (k === "difference" ? t("queue.kind.difference") : k === "resubmitted" ? t("queue.kind.resubmitted") : t(FLAG_KIND_KEYS[k]));
  const left = items.filter((i) => !decidedHere.has(i.plot)).length;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="queue-title" onKeyDown={onKeyDown}>
      <Stack spacing={2}>
        <Typography variant="h2" id="queue-title">
          {t("queue.title")}
        </Typography>
        <Typography color="text.secondary">{t("queue.explain")}</Typography>
        <Box component="p" id="queue-keys" sx={{ m: 0, p: 1.5, bgcolor: "action.hover", borderRadius: 1, typography: "body2" }}>
          {t("queue.keys")}
        </Box>
        {/* What was decided, said to screen readers (the page moves on by itself). */}
        <Box role="status" aria-live="polite" sx={{ position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: 0, border: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
          {announce}
        </Box>
        {!data && loading && <Loading />}
        {busyFigures && (
          <Alert severity="info" role="status" action={<Button color="inherit" size="small" onClick={() => load(null)}>{t("common.retry")}</Button>}>
            {t("quality.busy")}
          </Alert>
        )}
        {loadError !== null && !busyFigures && <ErrorAlert error={loadError} onRetry={() => load(null)} />}
        {data && (
          <Stack spacing={2} sx={{ opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }} aria-busy={loading}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
              <SelectField label={t("answers.filterPerson")} value={filter.person ?? ALL} onChange={(v) => setFilter({ ...filter, person: v === ALL ? null : v })}>
                <MenuItem value={ALL}>{t("answers.everyone")}</MenuItem>
                {people.map((p) => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </SelectField>
              <SelectField label={t("queue.filterKind")} value={filter.kind ?? ALL} onChange={(v) => setFilter({ ...filter, kind: v === ALL ? null : (v as QueueKind) })}>
                <MenuItem value={ALL}>{t("queue.allKinds")}</MenuItem>
                {kinds.map((k) => (
                  <MenuItem key={k} value={k}>
                    {kindLabel(k)}
                  </MenuItem>
                ))}
              </SelectField>
              {filtered && (
                <Button size="small" onClick={() => setFilter(NO_QUEUE_FILTER)} sx={{ alignSelf: { sm: "center" } }}>
                  {t("answers.clear")}
                </Button>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {t(filtered ? "queue.countFiltered" : "queue.count", {
                n: formatNumber(data.total, language),
                differences: formatNumber(data.counts.difference, language),
                flags: formatNumber(data.counts.flag, language),
                resubmitted: formatNumber(data.counts.resubmitted, language),
              })}
              {decidedHere.size > 0 && ` ${t("queue.decidedHere", { n: formatNumber(decidedHere.size, language), left: formatNumber(left, language) })}`}
              {data.computedAt !== null && ` ${t(data.stale ? "answers.asOfStale" : "answers.asOf", { time: formatDate(data.computedAt, language) })}`}
            </Typography>
            {data.stale && (
              <Box>
                <Button size="small" variant="outlined" onClick={() => load(null)}>
                  {t("queue.refresh")}
                </Button>
              </Box>
            )}
            {data.excludedOwn > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("queue.ownLeftOut", { n: formatNumber(data.excludedOwn, language) })}
              </Typography>
            )}
            {data.flagsCapped && (
              <Typography variant="body2" color="text.secondary">
                {t("queue.flagsCapped")}
              </Typography>
            )}
            {unsupportedSrs !== null && <Alert severity="info">{t("quality.placesUnsupported", { srs: unsupportedSrs })}</Alert>}
            {canBulk && (
              <Bulk
                projectId={projectId}
                onDone={(count) => {
                  setBulkDone(t("queue.bulkDone", { n: formatNumber(count, language) }));
                  load(null);
                  onBulk?.();
                }}
              />
            )}
            {bulkDone !== null && <Alert severity="success">{bulkDone}</Alert>}
            {items.length === 0 ? (
              <Alert severity="success">{t(filtered ? "queue.noneFiltered" : "queue.none")}</Alert>
            ) : (
              current && (
                <QueueCard
                  item={current}
                  position={Math.min(index, items.length - 1) + 1}
                  total={data.total}
                  decision={decisionOf(current)}
                  place={places.get(current.plot)}
                  outline={outline}
                  labels={labels}
                  data={data}
                  busy={busy}
                  comment={comment}
                  onComment={setComment}
                  commentRef={commentRef}
                  cardRef={cardRef}
                  onDecide={(kind) => void decide(kind)}
                  onUndo={() => void undo()}
                  onMove={(step) => move(step, false)}
                  canMoveBack={index > 0}
                  canMoveOn={index < items.length - 1}
                />
              )
            )}
            {error !== null && <ErrorAlert error={error} />}
            {items.length > 0 && data.next !== null && index >= items.length - 1 && (
              <Box>
                <Button
                  variant="outlined"
                  size="small"
                  aria-disabled={loading}
                  onClick={() => {
                    if (loading || data.next === null) return;
                    focusAfterMore.current = true;
                    load(data.next);
                  }}
                >
                  {t("queue.loadMore", { loaded: formatNumber(items.length, language), total: formatNumber(data.total, language) })}
                </Button>
              </Box>
            )}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
