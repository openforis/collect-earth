import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import Pagination from "@mui/material/Pagination";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import OpenInNew from "@mui/icons-material/OpenInNew";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  deleteQualityDecision,
  getPlotPlaces,
  setQualityDecision,
  type DecisionKind,
  type Difference,
  type PlotPlace,
  type QualityData,
  type QualityDecision,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { formatDate, formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { googleEarthUrl, groupDifferences, labelMap } from "../qualityView";

/** Plots per page: each shows its differing answers, so a page stays short on a phone. */
export const DIFFERENCES_PAGE = 10;
/** The most differences the server lists (MAX_DIFFERENCES). */
const MAX_LISTED = 500;

const DECISIONS: { kind: DecisionKind; label: MessageKey }[] = [
  { kind: "first", label: "quality.decision.first" },
  { kind: "check", label: "quality.decision.check" },
  { kind: "recheck", label: "quality.decision.recheck" },
];
const DECISION_LABEL: Record<DecisionKind, MessageKey> = {
  first: "quality.decision.first",
  check: "quality.decision.check",
  recheck: "quality.decision.recheck",
};

function CheckAnswers({ difference, label }: { difference: Difference; label: (key: string) => string }) {
  const t = useT();
  const blank = (value: string) => value || t("quality.blank");
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1, wordBreak: "break-word" }}>
        {t("quality.firstBy", { name: difference.first.operator })} · {t("quality.checkBy", { name: difference.check.operator })}
      </Typography>
      <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
        {/* The same columns in every plot's table, so the list reads as one. */}
        <Table size="small" sx={{ tableLayout: "fixed", "& th, & td": { overflowWrap: "break-word", px: { xs: 1, sm: 2 } } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "38%" }}>{t("quality.question")}</TableCell>
              <TableCell sx={{ width: "31%" }}>{t("quality.firstShort")}</TableCell>
              <TableCell sx={{ width: "31%" }}>{t("quality.checkAnswer")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {difference.fields.map((field) => (
              <TableRow key={field.key} sx={{ verticalAlign: "top" }}>
                <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", minWidth: 120 }}>
                  {label(field.key)}
                </TableCell>
                <TableCell sx={{ wordBreak: "break-word" }}>{blank(field.first)}</TableCell>
                <TableCell sx={{ wordBreak: "break-word" }}>{blank(field.check)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function PlotDifferences({
  projectId,
  plot,
  checks,
  place,
  decision,
  label,
  onDecision,
}: {
  projectId: string;
  plot: string;
  checks: Difference[];
  place: PlotPlace | undefined;
  decision: QualityDecision | undefined;
  label: (key: string) => string;
  onDecision: (plot: string, decision: QualityDecision | null) => void;
}) {
  const t = useT();
  const { language } = useApp();
  // The decision buttons say which plot they decide: "First is right", for "Plot 12".
  const headingId = useId();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const decide = (kind: DecisionKind) =>
    run(async () => {
      onDecision(plot, await setQualityDecision(projectId, plot, kind, comment));
      setComment("");
    });
  const undo = () =>
    run(async () => {
      await deleteQualityDecision(projectId, plot);
      onDecision(plot, null);
    });

  return (
    <Paper variant="outlined" component="article" sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="h3" id={headingId} sx={{ wordBreak: "break-word" }}>
            {t("quality.plot", { plot })}
          </Typography>
          {place && (
            <Link
              href={googleEarthUrl(place.lat, place.lon)}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
            >
              {t("quality.googleEarth")}
              <OpenInNew fontSize="small" aria-hidden />
            </Link>
          )}
        </Stack>
        {checks.map((d) => (
          <CheckAnswers key={d.check.recordKey + "\u0000" + d.check.operator} difference={d} label={label} />
        ))}
        {decision ? (
          <Stack spacing={1}>
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Chip color="primary" variant="outlined" label={t("quality.decided", { decision: t(DECISION_LABEL[decision.decision]) })} />
              <Button size="small" onClick={() => void undo()} disabled={busy} aria-describedby={headingId}>
                {t("quality.undo")}
              </Button>
            </Stack>
            {decision.comment && <Typography sx={{ wordBreak: "break-word" }}>{decision.comment}</Typography>}
            {(decision.decidedBy || decision.decidedAt !== null) && (
              <Typography variant="body2" color="text.secondary">
                {decision.decidedBy
                  ? t("quality.decidedBy", { name: decision.decidedBy, time: formatDate(decision.decidedAt, language) })
                  : formatDate(decision.decidedAt, language)}
              </Typography>
            )}
          </Stack>
        ) : (
          <Stack spacing={1.5}>
            <TextField
              label={t("quality.comment")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              size="small"
              multiline
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              {DECISIONS.map((d) => (
                <Button key={d.kind} variant="outlined" onClick={() => void decide(d.kind)} disabled={busy} aria-describedby={headingId}>
                  {t(d.label)}
                </Button>
              ))}
            </Stack>
          </Stack>
        )}
        <ErrorAlert error={error} />
      </Stack>
    </Paper>
  );
}

/** Section 6: each plot whose check differs, with both answers, a Google Earth link and the decision. */
export function QualityDifferences({
  projectId,
  data,
  onDecision,
}: {
  projectId: string;
  data: QualityData;
  /** A plot's decision was made (or undone, with null). */
  onDecision: (plot: string, decision: QualityDecision | null) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const label = labelMap(data.questions);
  const decisions = useMemo(() => new Map(data.decisions.map((d) => [d.plot, d])), [data.decisions]);
  const groups = useMemo(() => groupDifferences(data.differences), [data.differences]);
  const [hideDecided, setHideDecided] = useState(false);
  const [page, setPage] = useState(1);
  // Where each plot asked about is, kept while the tab is open: null for a plot with no place.
  const [places, setPlaces] = useState<Map<string, PlotPlace | null>>(new Map());
  // The survey's coordinate system when it is not latitude and longitude: no links then.
  const [unsupportedSrs, setUnsupportedSrs] = useState<string | null>(null);
  const top = useRef<HTMLElement | null>(null);

  const listed = hideDecided ? groups.filter((g) => !decisions.has(g.plot)) : groups;
  const pages = Math.max(1, Math.ceil(listed.length / DIFFERENCES_PAGE));
  const current = Math.min(page, pages);
  const shown = listed.slice((current - 1) * DIFFERENCES_PAGE, current * DIFFERENCES_PAGE);
  const missing = unsupportedSrs === null ? shown.map((g) => g.plot).filter((plot) => !places.has(plot)) : [];
  const missingKey = missing.join("\u0000");

  // Where the plots of this page are, for their Google Earth links (no link when that fails).
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    const asked = missingKey.split("\u0000");
    getPlotPlaces(projectId, asked).then(
      (answer) => {
        if (cancelled) return;
        if (answer.unsupportedSrs !== null) {
          setUnsupportedSrs(answer.unsupportedSrs);
          return;
        }
        const found = new Map(answer.places.map((place) => [place.plot, place]));
        setPlaces((old) => new Map([...old, ...asked.map((plot) => [plot, found.get(plot) ?? null] as const)]));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, missingKey]);

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, scrollMarginTop: 72 }} component="section" ref={top}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("quality.differencesTitle")}</Typography>
        <Typography color="text.secondary">{t("quality.differencesExplain")}</Typography>
        {groups.length === 0 ? (
          <Alert severity="info">{t("quality.noDifferences")}</Alert>
        ) : (
          <>
            <FormControlLabel
              control={<Switch checked={hideDecided} onChange={(e) => (setHideDecided(e.target.checked), setPage(1))} />}
              label={t("quality.hideDecided")}
            />
            {unsupportedSrs !== null && <Alert severity="info">{t("quality.placesUnsupported", { srs: unsupportedSrs })}</Alert>}
            {listed.length === 0 && <Alert severity="success">{t("quality.allDecided")}</Alert>}
            {shown.map((g) => (
              <PlotDifferences
                key={g.plot}
                projectId={projectId}
                plot={g.plot}
                checks={g.checks}
                place={places.get(g.plot) ?? undefined}
                decision={decisions.get(g.plot)}
                label={label}
                onDecision={onDecision}
              />
            ))}
            {pages > 1 && (
              <Pagination
                count={pages}
                page={current}
                onChange={(_, value) => {
                  setPage(value);
                  // The new page starts at the top of the section, not at the pager.
                  top.current?.scrollIntoView?.({ block: "start" });
                }}
                siblingCount={0}
                aria-label={t("quality.differencesTitle")}
                getItemAriaLabel={(type, number) =>
                  type === "page" ? t("quality.pageLabel", { page: number ?? 0 }) : type === "next" ? t("quality.nextPage") : t("quality.previousPage")
                }
              />
            )}
            {data.differences.length >= MAX_LISTED && (
              <Typography variant="body2" color="text.secondary">
                {t("quality.differencesMore", { count: formatNumber(data.differences.length, language) })}
              </Typography>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
