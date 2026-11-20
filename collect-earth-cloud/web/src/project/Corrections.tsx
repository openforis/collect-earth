import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import WarningAmber from "@mui/icons-material/WarningAmberOutlined";
import { useEffect, useId, useRef, useState } from "react";
import { assignCorrections, getCorrections, type AssignCorrectionsAnswer, type AssignmentPreview, type CorrectionsAnswer } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FoldingCard } from "../components/FoldingCard";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { linkProps, pathFor } from "../router";

/** A person plots can be assigned to */
export interface Assignee {
  userId: string;
  username: string;
  role: string;
}

/** Whom to assign the plots to correct: one or several people of the project (shared evenly) */
export function PeoplePicker({ people, value, onChange }: { people: readonly Assignee[]; value: readonly string[]; onChange: (ids: string[]) => void }) {
  const t = useT();
  return (
    <Autocomplete
      multiple
      size="small"
      options={[...people]}
      value={people.filter((p) => value.includes(p.userId))}
      onChange={(_, picked) => onChange(picked.map((p) => p.userId))}
      getOptionLabel={(p) => p.username}
      isOptionEqualToValue={(a, b) => a.userId === b.userId}
      renderInput={(params) => <TextField {...params} label={t("corrections.people")} helperText={t("corrections.peopleHelp")} />}
    />
  );
}

/** Who gets how many plots, and the plots someone would correct of their own (a warning, never a refusal) */
export function AssignmentPreviewView({ preview }: { preview: AssignmentPreview }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  return (
    <Stack spacing={1} role="status">
      <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
        {preview.people.map((p) => (
          <li key={p.userId}>
            <Typography variant="body2">
              {p.plots === 1
                ? t(p.own > 0 ? "corrections.previewOwnOne" : "corrections.previewOne", { name: p.username })
                : p.own > 0
                  ? t("corrections.previewOwn", { name: p.username, n: n(p.plots), own: n(p.own) })
                  : t("corrections.preview", { name: p.username, n: n(p.plots) })}
            </Typography>
          </li>
        ))}
      </Box>
      {preview.ownCount > 0 && (
        <Alert severity="warning">
          <Typography variant="body2">{t("corrections.ownWarning", { n: n(preview.ownCount) })}</Typography>
          <Typography variant="body2">{preview.own.map((o) => t("corrections.ownLine", { plot: o.plot, name: o.username })).join(" · ")}</Typography>
        </Alert>
      )}
    </Stack>
  );
}

/**
 * The plots decided "Correct it in Collect Earth" (coordinators, docs/plans/2026-11-20-review-at-scale.md B2): who
 * corrects each, which are corrected, and assigning them (again) to people, shared evenly, or to nobody.
 */
export function CorrectionsPanel({ projectId, refresh }: { projectId: string; refresh: number }) {
  const t = useT();
  const { language } = useApp();
  const [data, setData] = useState<CorrectionsAnswer | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const latest = useRef(0);
  const load = () => {
    const call = ++latest.current;
    getCorrections(projectId).then(
      (answer) => call === latest.current && (setData(answer), setError(null)),
      (err: unknown) => call === latest.current && setError(err),
    );
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [projectId, refresh]);
  const n = (v: number) => formatNumber(v, language);
  const lines = data?.lines ?? [];
  const all = lines.length > 0 && lines.every((l) => picked.has(l.plot));
  const title = data ? t("corrections.titleCount", { n: n(lines.length) }) : t("corrections.title");

  return (
    <FoldingCard title={title}>
      <Stack spacing={2}>
        <Explain text={t("corrections.explain.short")} more={t("corrections.explain")} />
        {!data && !error && <Loading />}
        {error !== null && <ErrorAlert error={error} onRetry={load} />}
        {done !== null && (
          <Alert severity="success" onClose={() => setDone(null)}>
            {done}
          </Alert>
        )}
        {data && lines.length === 0 && <Typography variant="body2">{t("corrections.none")}</Typography>}
        {data && lines.length > 0 && (
          <>
            <Typography variant="body2" color="text.secondary">
              {t("corrections.counts", { unassigned: n(data.counts.unassigned), assigned: n(data.counts.assigned), corrected: n(data.counts.corrected) })}
            </Typography>
            {picked.size > 0 && (
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {t("reviewList.picked", { n: n(picked.size) })}
                </Typography>
                <Button size="small" variant="contained" onClick={() => setAssigning(true)}>
                  {t("corrections.assign", { n: n(picked.size) })}
                </Button>
              </Stack>
            )}
            <TableContainer sx={{ maxHeight: 480 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={all}
                        indeterminate={picked.size > 0 && !all}
                        onChange={() => setPicked(all ? new Set() : new Set(lines.map((l) => l.plot)))}
                        slotProps={{ input: { "aria-label": t("corrections.selectAll") } }}
                      />
                    </TableCell>
                    <TableCell>{t("reviewList.col.plot")}</TableCell>
                    <TableCell>{t("corrections.col.assignedTo")}</TableCell>
                    <TableCell>{t("corrections.col.state")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.plot} hover selected={picked.has(l.plot)}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={picked.has(l.plot)}
                          onChange={() => setPicked((s) => { const next = new Set(s); if (next.has(l.plot)) next.delete(l.plot); else next.add(l.plot); return next; })}
                          slotProps={{ input: { "aria-label": t("reviewList.selectLine", { plot: l.plot }) } }}
                        />
                      </TableCell>
                      <TableCell>
                        <Link variant="body2" {...linkProps(pathFor({ name: "plot", projectId, plot: l.plot }))}>
                          {l.plot}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {l.assignedTo ? l.assignedTo.username : t("corrections.nobody")}
                        {l.own && (
                          <Typography component="span" variant="body2" color="warning.main" sx={{ ml: 1, display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <WarningAmber fontSize="inherit" aria-hidden />
                            {t("corrections.ownMark")}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {l.correctedAt !== null ? t("corrections.state.corrected", { name: l.correctedBy ?? "—", time: formatDate(l.correctedAt, language) }) : t("corrections.state.waiting")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </Stack>
      {assigning && data && (
        <AssignDialog
          projectId={projectId}
          plots={[...picked]}
          people={data.people}
          onClose={() => setAssigning(false)}
          onDone={(answer) => {
            setAssigning(false);
            setPicked(new Set());
            setDone(t("corrections.assignDone", { n: n(answer.count) }));
            load();
          }}
        />
      )}
    </FoldingCard>
  );
}

/** Assigning plots to correct (again): the people, a count first with their own plots said, then do it */
function AssignDialog({
  projectId,
  plots,
  people,
  onClose,
  onDone,
}: {
  projectId: string;
  plots: string[];
  people: readonly Assignee[];
  onClose: () => void;
  onDone: (answer: AssignCorrectionsAnswer) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const [chosen, setChosen] = useState<string[]>([]);
  const [dry, setDry] = useState<AssignCorrectionsAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const titleId = useId();
  const latest = useRef(0);
  const n = (v: number) => formatNumber(v, language);
  useEffect(() => {
    const call = ++latest.current;
    setDry(null);
    assignCorrections(projectId, plots, chosen, true).then(
      (answer) => call === latest.current && setDry(answer),
      (err: unknown) => call === latest.current && setError(err),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chosen.join("\u0000")]);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await assignCorrections(projectId, plots, chosen, false));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{t("corrections.assignTitle", { n: n(plots.length) })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <PeoplePicker people={people} value={chosen} onChange={setChosen} />
          {!dry && !error && <Loading />}
          {dry && dry.people.length > 0 && <AssignmentPreviewView preview={dry} />}
          {dry && dry.skippedCount > 0 && <Typography variant="body2">{t("corrections.skippedNotToCorrect", { n: n(dry.skippedCount) })}</Typography>}
          {error !== null && <ErrorAlert error={error} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </Button>
        <Button variant="contained" onClick={() => void go()} disabled={busy || !dry || dry.count === 0}>
          {chosen.length === 0 ? t("corrections.unassignDo", { n: n(dry?.count ?? 0) }) : t("corrections.assignDo", { n: n(dry?.count ?? 0) })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
