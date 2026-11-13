import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
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
import Edit from "@mui/icons-material/EditOutlined";
import { useMemo, useState } from "react";
import {
  listAssignments,
  listCsvFiles,
  listMembers,
  replaceImpactOf,
  saveAssignments,
  uploadCsvFile,
  type ReplaceImpact,
  type ListedCsvFile,
  type Member,
} from "../api";
import { useApp } from "../appContext";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { MoreInfo } from "../components/Explain";
import { FileDrop } from "../components/FileDrop";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { linkProps, pathFor, type ProjectTab } from "../router";
import { useLoad } from "../useLoad";
import { fromPairs, pairKey } from "../assignmentGrid";
import { sortPeople } from "../division";
import { PlotDesign } from "./PlotDesign";

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

function dividedOf(files: ListedCsvFile[]): Divided {
  return new Map(files.filter((file) => file.divided).map((file) => [file.id, file.dividedPeople]));
}

async function loadPlots(projectId: string) {
  const [files, members, assignments] = await Promise.all([listCsvFiles(projectId), listMembers(projectId), listAssignments(projectId)]);
  return { files, members, assignments, divided: dividedOf(files) };
}

const VISUALLY_HIDDEN = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

const filePath = (projectId: string, fileId: string) => pathFor({ name: "plotFile", projectId, fileId });

function DividedChip({ projectId, fileId, count }: { projectId: string; fileId: string; count: number }) {
  const t = useT();
  const label = count === 0 ? t("plots.dividedNone") : count === 1 ? t("plots.dividedOne") : t("plots.dividedChip", { count });
  return <Chip icon={<CallSplit />} label={label} clickable component="a" color="primary" variant="outlined" {...linkProps(filePath(projectId, fileId))} />;
}

/** Only the coordinator in the project: plots can go to them alone; the way to invite people. */
export function OnlyYou({ onGo }: { onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  return (
    <Alert
      severity="info"
      action={
        <Button color="inherit" size="small" endIcon={<ArrowForward />} onClick={() => onGo("people")}>
          {t("step.invite.action")}
        </Button>
      }
    >
      {t("plots.onlyYou")}
    </Alert>
  );
}

/** Who collects one plot file: the people ticked get the whole file in Collect Earth. Saved at once. */
function WhoCollectsDialog({
  file,
  people,
  ticked,
  onClose,
  onSave,
  onGo,
}: {
  file: ListedCsvFile;
  people: Member[];
  ticked: ReadonlySet<string>;
  onClose: () => void;
  onSave: (userIds: Set<string>) => Promise<void>;
  onGo: (tab: ProjectTab) => void;
}) {
  const t = useT();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(ticked));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const changed = chosen.size !== ticked.size || [...chosen].some((id) => !ticked.has(id));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(chosen);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" aria-labelledby="who-collects-title">
      <DialogTitle id="who-collects-title" sx={{ wordBreak: "break-word" }}>{t("plots.whoTitle", { file: file.filename })}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <DialogContentText variant="body2">{t("plots.whoHelp")}</DialogContentText>
          {people.length <= 1 && <OnlyYou onGo={(tab) => { onClose(); onGo(tab); }} />}
          <FormGroup>
            {people.map((person) => (
              <FormControlLabel
                key={person.userId}
                control={
                  <Checkbox
                    checked={chosen.has(person.userId)}
                    onChange={() => {
                      const next = new Set(chosen);
                      if (next.has(person.userId)) next.delete(person.userId);
                      else next.add(person.userId);
                      setChosen(next);
                    }}
                  />
                }
                label={person.username}
                sx={{ wordBreak: "break-word" }}
              />
            ))}
          </FormGroup>
          <ErrorAlert error={error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !changed}>{t("plots.saveAssign")}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function PlotsTab({ projectId, onGo }: { projectId: string; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  const { language } = useApp();
  const state = useLoad(["project", projectId, "loadPlots"], () => loadPlots(projectId));
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);

  const [pendingReplace, setPendingReplace] = useState<PendingReplace | null>(null);
  const [editing, setEditing] = useState<ListedCsvFile | null>(null);
  const [savedNote, setSavedNote] = useState(false);

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

  /** Uploads the files; whether any went in. */
  const uploadFiles = async (files: File[]): Promise<boolean> => {
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
        const given = meta?.assignment;
        if (given) {
          done.push(t("plots.assignedFromFile", { name: file.name, count: formatNumber(given.assigned, language), checks: formatNumber(given.checks, language) }));
          if (given.unknown.length > 0) warn(t("plots.unknownNames", { name: file.name, names: given.unknown.join(", ") }));
          if (given.notAssigned > 0) warn(t("plots.notAssignedFromFile", { name: file.name, count: formatNumber(given.notAssigned, language) }));
        }
        setMessages([...done]);
        const w = meta?.warnings;
        if (w && (w.badIds ?? 0) > 0) {
          warn(t("plots.warnIds", { name: file.name, count: formatNumber(w.badIds ?? 0, language), examples: (w.badIdExamples ?? []).join(", ") }));
        }
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
    return changed;
  };

  const data = state.data;
  // Coordinators normally do not collect: collectors and reviewers first.
  const people = useMemo(() => (data ? sortPeople(data.members) : []), [data]);
  const holders = useMemo(() => {
    const byFile = new Map<string, Set<string>>();
    for (const a of data?.assignments ?? []) {
      if (!byFile.has(a.csvFileId)) byFile.set(a.csvFileId, new Set());
      byFile.get(a.csvFileId)!.add(a.userId);
    }
    return byFile;
  }, [data]);
  const nameOf = (userId: string) => data?.members.find((m) => m.userId === userId)?.username ?? "?";

  /** Saves who collects one file, the other files' people as they are. */
  const saveHolders = async (fileId: string, userIds: Set<string>) => {
    if (!data) return;
    const pairs = new Set<string>();
    for (const a of data.assignments) if (a.csvFileId !== fileId) pairs.add(pairKey(a.csvFileId, a.userId));
    for (const id of userIds) pairs.add(pairKey(fileId, id));
    await saveAssignments(projectId, fromPairs(pairs, data.files.filter((f) => !data.divided.has(f.id)), data.members));
    setEditing(null);
    setSavedNote(true);
    state.reload();
  };

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="plot-files-title">
        <Typography variant="h2" id="plot-files-title" gutterBottom>
          {t("plots.title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("plots.explain")}
        </Typography>
        <Stack spacing={1.5}>
          <FileDrop label={t("plots.drop")} buttonLabel={t("plots.choose")} accept=".csv,text/csv" multiple disabled={upload !== null} onFiles={uploadFiles} />
          <Typography variant="body2" color="text.secondary">
            {t("plots.replaceHint")} {t("plots.userColumnHint.short")}
            <MoreInfo text={t("plots.userColumnHint")} />
          </Typography>
          {upload && (
            <div role="status">
              <Typography variant="body2" sx={{ mb: 0.5 }}>{t("plots.uploading", { name: upload.name, pct: Math.round(upload.progress * 100) })}</Typography>
              <LinearProgress variant="determinate" value={upload.progress * 100} aria-hidden />
            </div>
          )}
          {messages.length > 0 && (
            <Alert severity="success" role="status" onClose={() => setMessages([])}>
              {messages.map((m) => <div key={m}>{m}</div>)}
            </Alert>
          )}
          {warnings.length > 0 && (
            <Alert severity="warning" role="alert" onClose={() => setWarnings([])}>
              {warnings.map((w) => <div key={w}>{w}</div>)}
            </Alert>
          )}
          <ErrorAlert error={error} />
        </Stack>

        <Box sx={{ mt: 3 }}>
          {state.loading && !data ? (
            <Loading />
          ) : state.error || !data ? (
            <ErrorAlert error={state.error} onRetry={state.reload} />
          ) : data.files.length === 0 ? (
            <EmptyState title={t("plots.none")} />
          ) : (
            <Stack spacing={1.5}>
              {savedNote && (
                <Alert severity="success" role="status" onClose={() => setSavedNote(false)}>
                  {t("plots.assignSaved.short")}
                  <MoreInfo text={t("plots.assignSaved")} />
                </Alert>
              )}
              <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("plots.file")}</TableCell>
                      <TableCell align="right">{t("plots.count")}</TableCell>
                      <TableCell>{t("plots.whoCollects")}</TableCell>
                      <TableCell align="right"><Box component="span" sx={VISUALLY_HIDDEN}>{t("plots.divide")}</Box></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.files.map((file) => {
                      const divided = data.divided.has(file.id);
                      const ids = [...(holders.get(file.id) ?? [])].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
                      return (
                        <TableRow key={file.id} hover>
                          <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", fontWeight: 500 }}>{file.filename}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>{formatNumber(file.plotCount, language)}</TableCell>
                          <TableCell>
                            {divided ? (
                              <DividedChip projectId={projectId} fileId={file.id} count={data.divided.get(file.id) ?? 0} />
                            ) : (
                              <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", alignItems: "center" }}>
                                {ids.length === 0 ? (
                                  <Typography variant="body2" color="text.secondary">{t("plots.nobody")}</Typography>
                                ) : (
                                  ids.map((id) => <Chip key={id} size="small" label={nameOf(id)} />)
                                )}
                                <Button size="small" startIcon={<Edit fontSize="small" />} onClick={() => setEditing(file)}
                                  aria-label={t("plots.changeLabel", { file: file.filename })}>
                                  {t("plots.change")}
                                </Button>
                              </Stack>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {!divided && (
                              <Button size="small" startIcon={<CallSplit />} aria-label={t("plots.divideLabel", { file: file.filename })} sx={{ whiteSpace: "nowrap" }}
                                {...linkProps(filePath(projectId, file.id))}>
                                {t("plots.divide")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              {editing && (
                <WhoCollectsDialog
                  file={editing}
                  people={people}
                  ticked={holders.get(editing.id) ?? new Set()}
                  onClose={() => setEditing(null)}
                  onSave={(ids) => saveHolders(editing.id, ids)}
                  onGo={onGo}
                />
              )}
            </Stack>
          )}
        </Box>
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

      {/* Designing plots is what a project without plot files needs first: open and above then, folded below once there are some */}
      {data && data.files.length === 0 && <PlotDesign key="open" projectId={projectId} busy={upload !== null} onFile={(file) => uploadFiles([file])} defaultOpen />}
      {data && data.files.length > 0 && <PlotDesign key="folded" projectId={projectId} busy={upload !== null} onFile={(file) => uploadFiles([file])} defaultOpen={false} />}
    </Stack>
  );
}
