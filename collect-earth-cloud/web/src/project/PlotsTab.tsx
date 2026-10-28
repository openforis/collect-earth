import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
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
import { useEffect, useMemo, useState } from "react";
import {
  listAssignments,
  listCsvFiles,
  listMembers,
  saveAssignments,
  uploadCsvFile,
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
import type { ProjectTab } from "../router";
import { useLoad } from "../useLoad";
import { fromPairs, hasChanges, pairKey, toPairs } from "../assignmentGrid";

interface UploadState {
  name: string;
  progress: number;
}

async function loadPlots(projectId: string) {
  const [files, members, assignments] = await Promise.all([listCsvFiles(projectId), listMembers(projectId), listAssignments(projectId)]);
  return { files, members, assignments };
}

function AssignmentGrid({
  projectId,
  files,
  members,
  assignments,
  onGo,
}: {
  projectId: string;
  files: CsvFile[];
  members: Member[];
  assignments: Assignment[];
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
  const people = useMemo(() => [...members].sort((a, b) => Number(a.role === "admin") - Number(b.role === "admin") || a.username.localeCompare(b.username)), [members]);
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
      await saveAssignments(projectId, fromPairs(pairs, files, members));
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
                {people.map((person) => {
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
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
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

  const uploadFiles = async (files: File[]) => {
    setMessages([]);
    setError(null);
    const csv = files.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    setWarnings(files.filter((f) => !csv.includes(f)).map((f) => t("plots.wrongType", { name: f.name })));
    const done: string[] = [];
    try {
      for (const file of csv) {
        setUpload({ name: file.name, progress: 0 });
        const meta = await uploadCsvFile(projectId, file, (progress) => setUpload({ name: file.name, progress }));
        done.push(t("plots.uploaded", { name: file.name, count: formatNumber(meta?.plotCount ?? 0, language) }));
        setMessages([...done]);
      }
    } catch (err) {
      setError(err);
    } finally {
      setUpload(null);
      if (done.length > 0) state.reload();
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
                </TableRow>
              </TableHead>
              <TableBody>
                {state.data.files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell sx={{ wordBreak: "break-word" }}>{file.filename}</TableCell>
                    <TableCell align="right">{formatNumber(file.plotCount, language)}</TableCell>
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
            <AssignmentGrid projectId={projectId} files={state.data.files} members={state.data.members} assignments={state.data.assignments} onGo={onGo} />
          </Paper>
        </>
      )}
    </Stack>
  );
}
