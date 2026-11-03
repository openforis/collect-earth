import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ArrowForward from "@mui/icons-material/ArrowForward";
import CallSplit from "@mui/icons-material/CallSplit";
import { useEffect, useMemo, useState } from "react";
import {
  listAssignments,
  listCsvFiles,
  listMembers,
  replaceImpactOf,
  saveAssignments,
  uploadCsvFile,
  type ReplaceImpact,
  type Assignment,
  type CsvFile,
  type Member,
} from "../api";
import { useApp } from "../appContext";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { linkProps, pathFor, type ProjectTab } from "../router";
import { useLoad } from "../useLoad";
import { fromPairs, hasChanges, pairKey, toPairs } from "../assignmentGrid";
import { sortPeople } from "../division";

interface UploadState {
  name: string;
  progress: number;
}

/** A same-name upload waiting for the coordinator to say yes or no. */
interface PendingReplace {
  name: string;
  impact: ReplaceImpact;
  answer: (replace: boolean) => void;
}

/** For each divided file (its plots shared out between people): how many people have plots. */
type Divided = Map<string, number>;

function dividedOf(files: CsvFile[]): Divided {
  return new Map(files.filter((file) => file.divided).map((file) => [file.id, file.dividedPeople ?? 0]));
}

async function loadPlots(projectId: string) {
  const [files, members, assignments] = await Promise.all([listCsvFiles(projectId), listMembers(projectId), listAssignments(projectId)]);
  return { files, members, assignments, divided: dividedOf(files) };
}

const filePath = (projectId: string, fileId: string) => pathFor({ name: "plotFile", projectId, fileId });

function DividedChip({ projectId, fileId, count }: { projectId: string; fileId: string; count: number }) {
  const t = useT();
  const label = count === 0 ? t("plots.dividedNone") : count === 1 ? t("plots.dividedOne") : t("plots.dividedChip", { count });
  return <Chip icon={<CallSplit />} label={label} clickable component="a" color="primary" variant="outlined" {...linkProps(filePath(projectId, fileId))} />;
}

function AssignmentGrid({
  projectId,
  files,
  members,
  assignments,
  divided,
  onGo,
}: {
  projectId: string;
  files: CsvFile[];
  members: Member[];
  assignments: Assignment[];
  divided: Divided;
  onGo: (tab: ProjectTab) => void;
}) {
  const t = useT();
  // What the server holds: from the loaded assignments, then whatever was last saved.
  const [saved, setSaved] = useState<Set<string>>(() => toPairs(assignments));
  const [pairs, setPairs] = useState<Set<string>>(saved);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const loaded = toPairs(assignments);
    setSaved(loaded);
    setPairs(loaded);
  }, [assignments]);

  // Coordinators normally do not collect: show collectors and reviewers first.
  const people = useMemo(() => sortPeople(members), [members]);
  const changed = useMemo(() => hasChanges(pairs, saved), [pairs, saved]);

  if (members.length <= 1) {
    return (
      <EmptyState
        title={t("plots.gridNeedsPeople")}
        action={
          <Button variant="contained" endIcon={<ArrowForward />} onClick={() => onGo("people")}>
            {t("step.invite.action")}
          </Button>
        }
      />
    );
  }

  const toggle = (key: string) => {
    setDone(false);
    setPairs((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      // Divided files have their own page; the server ignores them here anyway.
      await saveAssignments(projectId, fromPairs(pairs, files.filter((f) => !divided.has(f.id)), members));
      setSaved(new Set(pairs));
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 520 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 140 }}>{t("plots.file")}</TableCell>
              {people.map((person) => (
                <TableCell key={person.userId} align="center" sx={{ minWidth: 90, wordBreak: "break-word" }}>
                  {person.username}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {files.map((file) => (
              <TableRow key={file.id} hover>
                <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                  {file.filename}
                </TableCell>
                {divided.has(file.id) ? (
                  <TableCell colSpan={people.length}>
                    <DividedChip projectId={projectId} fileId={file.id} count={divided.get(file.id) ?? 0} />
                  </TableCell>
                ) : (
                  people.map((person) => {
                    const key = pairKey(file.id, person.userId);
                    return (
                      <TableCell key={person.userId} align="center" padding="checkbox">
                        <Checkbox
                          checked={pairs.has(key)}
                          onChange={() => toggle(key)}
                          slotProps={{ input: { "aria-label": t("plots.assignLabel", { file: file.filename, person: person.username }) } }}
                        />
                      </TableCell>
                    );
                  })
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {divided.size > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("plots.gridDividedHelp")}
        </Typography>
      )}
      {changed && <Alert severity="warning">{t("plots.unsaved")}</Alert>}
      {done && !changed && (
        <Alert severity="success" role="status">
          {t("plots.assignSaved")}
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Box>
        <Button variant="contained" onClick={save} disabled={busy || !changed}>
          {t("plots.saveAssign")}
        </Button>
      </Box>
    </Stack>
  );
}

export function PlotsTab({ projectId, onGo }: { projectId: string; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  const { language } = useApp();
  const state = useLoad(() => loadPlots(projectId), [projectId]);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);

  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);

  const askReplace = (name: string, impact: ReplaceImpact) =>
    new Promise<boolean>((resolve) => {
      setPendingReplace({
        name,
        impact,
        answer: (replace) => {
          setPendingReplace(null);
          resolve(replace);
        },
      });
    });

  const uploadFiles = async (files: File[]) => {
    setMessages([]);
    setError(null);
    const csv = files.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    const notes: string[] = files.filter((f) => !csv.includes(f)).map((f) => t("plots.wrongType", { name: f.name }));
    setWarnings([...notes]);
    const warn = (text: string) => {
      notes.push(text);
      setWarnings([...notes]);
    };
    const done: string[] = [];
    let changed = false;
    try {
      for (const file of csv) {
        if (file.size === 0) {
          warn(t("plots.emptyFile", { name: file.name }));
          continue;
        }
        const send = (confirm: boolean) =>
          uploadCsvFile(projectId, file, (progress) => setUpload({ name: file.name, progress }), confirm);
        setUpload({ name: file.name, progress: 0 });
        let meta;
        try {
          meta = await send(false);
        } catch (err) {
          const impact = replaceImpactOf(err);
          if (!impact) throw err;
          setUpload(null);
          if (!(await askReplace(file.name, impact))) {
            warn(t("plots.replaceSkipped", { name: file.name }));
            continue;
          }
          setUpload({ name: file.name, progress: 0 });
          meta = await send(true);
        }
        changed = true;
        const count = meta?.plotCount ?? 0;
        done.push(count === 1 ? t("plots.uploadedOne", { name: file.name }) : t("plots.uploaded", { name: file.name, count: formatNumber(count, language) }));
        setMessages([...done]);
        const w = meta?.warnings;
        if (w && w.duplicateIds > 0) {
          warn(t("plots.warnDuplicates", { name: file.name, count: formatNumber(w.duplicateIds, language), examples: w.duplicateExamples.join(", ") }));
        }
        if (w && w.badCoordinates > 0) {
          warn(t("plots.warnCoordinates", { name: file.name, count: formatNumber(w.badCoordinates, language), examples: w.badCoordinateExamples.join(", ") }));
        }
      }
    } catch (err) {
      setError(err);
    } finally {
      setUpload(null);
      if (changed) state.reload();
    }
  };

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("plots.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("plots.explain")}
        </Typography>
        <Stack spacing={2}>
          <FileDrop label={t("plots.drop")} buttonLabel={t("plots.choose")} accept=".csv,text/csv" multiple disabled={upload !== null} onFiles={uploadFiles} />
          <Typography variant="body2" color="text.secondary">
            {t("plots.replaceHint")}
          </Typography>
          {upload && (
            <div role="status">
              <Typography sx={{ mb: 1 }}>{t("plots.uploading", { name: upload.name, pct: Math.round(upload.progress * 100) })}</Typography>
              <LinearProgress variant="determinate" value={upload.progress * 100} aria-hidden />
            </div>
          )}
          {messages.map((m) => (
            <Alert key={m} severity="success" role="status">
              {m}
            </Alert>
          ))}
          {warnings.map((w) => (
            <Alert key={w} severity="warning" role="alert">
              {w}
            </Alert>
          ))}
          <ErrorAlert error={error} />
        </Stack>
      </Paper>
      <Dialog open={pendingReplace !== null} onClose={() => pendingReplace?.answer(false)}>
        {pendingReplace && (
          <>
            <DialogTitle>{t("plots.replaceTitle", { name: pendingReplace.name })}</DialogTitle>
            <DialogContent>
              <DialogContentText>{t("plots.replaceText", { removed: formatNumber(pendingReplace.impact.removedPlots, language) })}</DialogContentText>
              <Box component="ul" sx={{ my: 1, color: "text.secondary" }}>
                {pendingReplace.impact.heldRemoved > 0 && <li>{t("plots.replaceHeld", { count: formatNumber(pendingReplace.impact.heldRemoved, language) })}</li>}
                {pendingReplace.impact.submittedRemoved > 0 && (
                  <li>{t("plots.replaceSubmitted", { count: formatNumber(pendingReplace.impact.submittedRemoved, language) })}</li>
                )}
              </Box>
              <DialogContentText>
                {t("plots.replaceKept", { kept: formatNumber(pendingReplace.impact.keptPlots, language), added: formatNumber(pendingReplace.impact.newPlots, language) })}
              </DialogContentText>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => pendingReplace.answer(false)} autoFocus>
                {t("common.cancel")}
              </Button>
              <Button variant="contained" color="error" onClick={() => pendingReplace.answer(true)}>
                {t("plots.replaceConfirm")}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {state.loading && !state.data ? (
        <Loading />
      ) : state.error || !state.data ? (
        <ErrorAlert error={state.error} onRetry={state.reload} />
      ) : state.data.files.length === 0 ? (
        <Paper variant="outlined">
          <EmptyState title={t("plots.none")} />
        </Paper>
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="h2" gutterBottom>
              {t("plots.listTitle")}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("plots.file")}</TableCell>
                  <TableCell align="right">{t("plots.count")}</TableCell>
                  <TableCell align="right">{t("plots.divideHeader")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {state.data.files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell sx={{ wordBreak: "break-word" }}>{file.filename}</TableCell>
                    <TableCell align="right">{formatNumber(file.plotCount, language)}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        startIcon={<CallSplit />}
                        aria-label={t("plots.divideLabel", { file: file.filename })}
                        sx={{ whiteSpace: "nowrap" }}
                        {...linkProps(filePath(projectId, file.id))}
                      >
                        {t("plots.divide")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="h2" gutterBottom>
              {t("plots.gridTitle")}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t("plots.gridHelp")}
            </Typography>
            <AssignmentGrid
              projectId={projectId}
              files={state.data.files}
              members={state.data.members}
              assignments={state.data.assignments}
              divided={state.data.divided}
              onGo={onGo}
            />
          </Paper>
        </>
      )}
    </Stack>
  );
}
