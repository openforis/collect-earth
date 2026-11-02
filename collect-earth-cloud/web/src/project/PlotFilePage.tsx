import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Select from "@mui/material/Select";
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
import ArrowBack from "@mui/icons-material/ArrowBack";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { useMemo, useState, type ReactNode } from "react";
import {
  ApiError,
  getCsvColumns,
  getDistribution,
  listCsvFiles,
  listMembers,
  moveUnfinished,
  saveDistribution,
  type CsvColumns,
  type Distribution,
  type DistributionState,
  type Member,
  type PersonShare,
} from "../api";
import { useApp } from "../appContext";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import {
  collectors,
  columnLabel,
  columnUsable,
  formProblem,
  giveInTurn,
  initialForm,
  MAX_OVERLAP_PERCENT,
  nearbyNote,
  MIN_OVERLAP_PERCENT,
  sortPeople,
  toRequest,
  withSeed,
  type DivisionForm,
  type DivisionMode,
} from "../division";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { linkProps, pathFor, type ProjectTab } from "../router";
import { useLoad } from "../useLoad";

// One plot file's page: divide its plots between people, see who has how many, and
// move someone's unfinished plots to another person.

async function loadFile(projectId: string, fileId: string) {
  const [files, members, current, columns] = await Promise.all([
    listCsvFiles(projectId),
    listMembers(projectId),
    getDistribution(projectId, fileId),
    getCsvColumns(projectId, fileId),
  ]);
  return { file: files.find((f) => f.id === fileId) ?? null, members, current, columns };
}

const holders = (state: DistributionState) => state.people.filter((p) => p.plots > 0).map((p) => p.userId);

/** Person → plots (copies) table, for the preview. */
function SharesTable({ people }: { people: PersonShare[] }) {
  const t = useT();
  const { language } = useApp();
  return (
    <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t("divide.person")}</TableCell>
            <TableCell align="right">{t("divide.plots")}</TableCell>
            <TableCell align="right">{t("divide.copies")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {people.map((person) => (
            <TableRow key={person.userId}>
              <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                {person.username}
              </TableCell>
              <TableCell align="right">{formatNumber(person.plots, language)}</TableCell>
              <TableCell align="right">{formatNumber(person.overlap, language)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** The value → people table for dividing by a column. */
function GroupsTable({
  form,
  columns,
  people,
  onChange,
}: {
  form: DivisionForm;
  columns: CsvColumns;
  people: Member[];
  onChange: (groups: Record<string, string[]>) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const column = columns.columns.find((c) => c.index === form.column);
  if (!column || !columnUsable(column)) return null;
  const values = column.values ?? [];
  const names = new Map(people.map((p) => [p.userId, p.username]));
  const valueText = (value: string) => (value.trim() === "" ? t("divide.emptyValue") : value);

  return (
    <Stack spacing={2}>
      <Box>
        <Button variant="outlined" onClick={() => onChange(giveInTurn(values.map((v) => v.value), collectors(people).map((p) => p.userId)))}>
          {t("divide.inTurn")}
        </Button>
        <FormHelperText>{t("divide.inTurnHelp")}</FormHelperText>
      </Box>
      <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 520 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t("divide.value")}</TableCell>
              <TableCell align="right">{t("divide.plots")}</TableCell>
              <TableCell sx={{ minWidth: 180 }}>{t("divide.valuePeople")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {values.map(({ value, count }) => {
              const chosen = form.groups[value] ?? [];
              return (
                <TableRow key={value}>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", fontStyle: value.trim() === "" ? "italic" : undefined }}>
                    {valueText(value)}
                  </TableCell>
                  <TableCell align="right">{formatNumber(count, language)}</TableCell>
                  <TableCell>
                    <Select
                      multiple
                      displayEmpty
                      fullWidth
                      size="small"
                      value={chosen}
                      onChange={(e) => {
                        const next = typeof e.target.value === "string" ? e.target.value.split(",") : e.target.value;
                        onChange({ ...form.groups, [value]: next });
                      }}
                      renderValue={(selected) =>
                        selected.length === 0 ? (
                          <Typography component="span" color="text.secondary">
                            {t("divide.nobody")}
                          </Typography>
                        ) : (
                          selected.map((id) => names.get(id) ?? id).join(", ")
                        )
                      }
                      slotProps={{ input: { "aria-label": t("divide.valuePeopleLabel", { value: valueText(value) }) } }}
                    >
                      {people.map((person) => (
                        <MenuItem key={person.userId} value={person.userId}>
                          <Checkbox checked={chosen.includes(person.userId)} size="small" sx={{ py: 0 }} />
                          <ListItemText primary={person.username} secondary={t(`role.${person.role}`)} />
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="body2" color="text.secondary">
        {t("divide.unassignedHint")}
      </Typography>
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="h3" gutterBottom>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function DivideForm({
  projectId,
  fileId,
  members,
  columns,
  current,
  onApplied,
}: {
  projectId: string;
  fileId: string;
  members: Member[];
  columns: CsvColumns;
  current: DistributionState;
  onApplied: (state: DistributionState) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const people = useMemo(() => sortPeople(members), [members]);
  const [form, setForm] = useState<DivisionForm>(() => initialForm(current.distribution, holders(current), members));
  // The last preview, for the request it was made for (any change to the form drops it).
  const [preview, setPreview] = useState<DistributionState | null>(null);
  const [problemShown, setProblemShown] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const problem = formProblem(form, columns);
  const change = (next: Partial<DivisionForm>) => {
    setForm((f) => ({ ...f, ...next }));
    setPreview(null);
    setNotice(null);
    setError(null);
    setProblemShown(false);
  };
  const togglePerson = (userId: string) =>
    change({ people: form.people.includes(userId) ? form.people.filter((id) => id !== userId) : [...form.people, userId] });

  const run = async (dryRun: boolean) => {
    setNotice(null);
    setError(null);
    if (problem) {
      setProblemShown(true);
      return;
    }
    setBusy(true);
    try {
      const request: Distribution = dryRun ? toRequest(form, columns) : withSeed(toRequest(form, columns), preview?.distribution ?? null);
      const result = await saveDistribution(projectId, fileId, request, dryRun);
      if (dryRun) {
        setPreview(result);
      } else {
        setPreview(null);
        setNotice(form.mode === "whole" ? t("divide.appliedWhole") : t("divide.applied"));
        onApplied(result);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const modes: { id: DivisionMode; label: string; help: string }[] = [
    { id: "whole", label: t("divide.modeWhole"), help: t("divide.modeWholeHelp") },
    { id: "even", label: t("divide.modeEven"), help: t("divide.modeEvenHelp") },
    { id: "column", label: t("divide.modeColumn"), help: t("divide.modeColumnHelp") },
  ];
  const percentBad = problemShown && problem === "divide.problemPercent";
  const nearbyText = nearbyNote(columns.nearby, t, (n) => formatNumber(n, language));

  return (
    <Stack spacing={3}>
      <FormControl>
        <FormLabel id="divide-mode">
          <Typography variant="h3" component="span">
            {t("divide.howTitle")}
          </Typography>
        </FormLabel>
        <RadioGroup aria-labelledby="divide-mode" value={form.mode} onChange={(e) => change({ mode: e.target.value as DivisionMode })}>
          {modes.map((mode) => (
            <FormControlLabel
              key={mode.id}
              value={mode.id}
              control={<Radio />}
              sx={{ alignItems: "flex-start", mt: 1, "& .MuiRadio-root": { pt: 0.5 } }}
              label={
                <span>
                  {mode.label}
                  <Typography variant="body2" color="text.secondary" component="span" sx={{ display: "block" }}>
                    {mode.help}
                  </Typography>
                </span>
              }
            />
          ))}
        </RadioGroup>
      </FormControl>

      {form.mode === "even" && (
        <FormControl component="fieldset" variant="standard">
          <FormLabel component="legend">{t("divide.peopleTitle")}</FormLabel>
          <FormGroup>
            {people.map((person) => (
              <FormControlLabel
                key={person.userId}
                control={<Checkbox checked={form.people.includes(person.userId)} onChange={() => togglePerson(person.userId)} />}
                label={`${person.username} (${t(`role.${person.role}`)})`}
                sx={{ wordBreak: "break-word" }}
              />
            ))}
          </FormGroup>
        </FormControl>
      )}

      {form.mode === "column" && (
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel id="divide-column">{t("divide.column")}</InputLabel>
            <Select
              labelId="divide-column"
              label={t("divide.column")}
              value={form.column ?? ""}
              onChange={(e) => {
                const value = e.target.value as number | "";
                change({ column: value === "" ? null : Number(value), groups: {} });
              }}
            >
              {columns.columns.map((column) => (
                <MenuItem key={column.index} value={column.index} disabled={!columnUsable(column)} sx={{ whiteSpace: "normal" }}>
                  {columnUsable(column)
                    ? columnLabel(column, t)
                    : column.index === 0
                      ? t("divide.columnIsId", { label: columnLabel(column, t) })
                      : t("divide.columnTooMany", { label: columnLabel(column, t), count: formatNumber(column.distinctCount, language) })}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>{t("divide.columnHelp")}</FormHelperText>
          </FormControl>
          <GroupsTable form={form} columns={columns} people={people} onChange={(groups) => change({ groups })} />
        </Stack>
      )}

      {form.mode !== "whole" && (
        <>
          <FormControl component="fieldset" variant="standard">
            <FormLabel component="legend">{t("divide.orderTitle")}</FormLabel>
            <RadioGroup
              value={form.order}
              onChange={(e) => change({ order: e.target.value === "mixed" || e.target.value === "nearby" ? e.target.value : "file" })}
            >
              <FormControlLabel value="file" control={<Radio />} label={t("divide.orderFile")} />
              <FormHelperText sx={{ mt: -0.5, ml: 4 }}>{t("divide.orderFileHelp")}</FormHelperText>
              <FormControlLabel
                value="nearby"
                control={<Radio slotProps={{ input: { "aria-describedby": "divide-order-nearby-help" } }} />}
                label={t("divide.orderNearby")}
                disabled={!columns.nearby.available}
              />
              <FormHelperText id="divide-order-nearby-help" sx={{ mt: -0.5, ml: 4 }}>
                {t("divide.orderNearbyHelp")}
                {nearbyText && (
                  <Typography variant="body2" component="span" sx={{ display: "block" }} color={columns.nearby.available ? "text.secondary" : "warning.main"}>
                    {nearbyText}
                  </Typography>
                )}
              </FormHelperText>
              <FormControlLabel value="mixed" control={<Radio />} label={t("divide.orderMixed")} />
              <FormHelperText sx={{ mt: -0.5, ml: 4 }}>{t("divide.orderMixedHelp")}</FormHelperText>
            </RadioGroup>
          </FormControl>

          <Section title={t("divide.checkTitle")}>
            <Stack spacing={2}>
              <FormControlLabel
                control={<Switch checked={form.overlap} onChange={(e) => change({ overlap: e.target.checked })} />}
                label={t("divide.checkSwitch")}
              />
              {form.overlap && (
                <TextField
                  label={t("divide.checkPercent")}
                  type="number"
                  value={form.overlapPercent}
                  onChange={(e) => change({ overlapPercent: e.target.value })}
                  error={percentBad}
                  helperText={percentBad ? t("divide.problemPercent") : t("divide.checkPercentHelp")}
                  slotProps={{ htmlInput: { min: MIN_OVERLAP_PERCENT, max: MAX_OVERLAP_PERCENT, inputMode: "numeric" } }}
                  sx={{ maxWidth: 320 }}
                />
              )}
            </Stack>
          </Section>
        </>
      )}

      {problemShown && problem && problem !== "divide.problemPercent" && (
        <Alert severity="warning" role="alert">
          {t(problem)}
        </Alert>
      )}
      {form.mode !== "whole" && <Typography color="text.secondary">{t("divide.applyNote")}</Typography>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="outlined" onClick={() => void run(true)} disabled={busy}>
          {t("divide.preview")}
        </Button>
        <Button variant="contained" onClick={() => void run(false)} disabled={busy}>
          {t("divide.apply")}
        </Button>
      </Stack>
      <ErrorAlert error={error} />
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}
      {preview && (
        <Section title={t("divide.previewTitle")}>
          <Stack spacing={1} role="status">
            <SharesTable people={preview.people} />
            {preview.unassigned > 0 && (
              <Alert severity="warning">{t("divide.previewUnassigned", { count: formatNumber(preview.unassigned, language) })}</Alert>
            )}
          </Stack>
        </Section>
      )}
    </Stack>
  );
}

function CurrentDivision({
  projectId,
  fileId,
  members,
  current,
  onChanged,
}: {
  projectId: string;
  fileId: string;
  members: Member[];
  current: DistributionState;
  onChanged: (state: DistributionState) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const people = useMemo(() => sortPeople(members), [members]);
  // The open "Move unfinished plots to…" menu, then the move waiting for confirmation.
  const [menu, setMenu] = useState<{ anchor: HTMLElement; from: PersonShare } | null>(null);
  const [pending, setPending] = useState<{ from: PersonShare; to: Member } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const shown = current.people.filter((p) => p.plots > 0);
  const move = async () => {
    if (!pending) return;
    const { from, to } = pending;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await moveUnfinished(projectId, fileId, from.userId, to.userId);
      setNotice(t("divide.moved", { count: formatNumber(result.moved, language), to: to.username }));
      onChanged(result);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <Stack spacing={2}>
      {current.distribution === null && <Typography color="text.secondary">{t("divide.currentWhole")}</Typography>}
      {current.distribution?.mode === "manual" && <Typography color="text.secondary">{t("divide.currentManual")}</Typography>}
      {shown.length === 0 ? (
        <Typography color="text.secondary">{t("divide.currentNobody")}</Typography>
      ) : (
        <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("divide.person")}</TableCell>
                <TableCell align="right">{t("divide.plots")}</TableCell>
                <TableCell sx={{ minWidth: 140 }}>{t("divide.submitted")}</TableCell>
                <TableCell>
                  <Box component="span" sx={visuallyHidden}>
                    {t("divide.moveButton")}
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((person) => {
                const label = t("divide.progressLabel", {
                  person: person.username,
                  submitted: formatNumber(person.submitted, language),
                  plots: formatNumber(person.plots, language),
                });
                return (
                  <TableRow key={person.userId}>
                    <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                      {person.username}
                    </TableCell>
                    <TableCell align="right">
                      {formatNumber(person.plots, language)}
                      {person.overlap > 0 && (
                        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: "block" }}>
                          {t("divide.copies")}: {formatNumber(person.overlap, language)}
                        </Typography>
                      )}
                      {person.sampled > 0 && (
                        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: "block" }}>
                          {t("divide.drawnCopies")}: {formatNumber(person.sampled, language)}
                        </Typography>
                      )}
                      {person.reference > 0 && (
                        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: "block" }}>
                          {t("divide.referenceCopies")}: {formatNumber(person.reference, language)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{formatNumber(person.submitted, language)}</Typography>
                      <LinearProgress
                        variant="determinate"
                        value={person.plots > 0 ? Math.min(100, (person.submitted / person.plots) * 100) : 0}
                        aria-label={label}
                        sx={{ mt: 0.5 }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        aria-haspopup="menu"
                        aria-label={t("divide.moveMenuLabel", { person: person.username })}
                        disabled={busy || person.submitted >= person.plots || people.length < 2}
                        onClick={(e) => setMenu({ anchor: e.currentTarget, from: person })}
                        endIcon={<ArrowForward />}
                        sx={{ whiteSpace: "nowrap" }}
                      >
                        {t("divide.moveButton")}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {current.unassigned > 0 && (
        <Alert severity="warning">{t("divide.currentUnassigned", { count: formatNumber(current.unassigned, language) })}</Alert>
      )}
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Menu anchorEl={menu?.anchor ?? null} open={menu !== null} onClose={() => setMenu(null)}>
        {menu &&
          people
            .filter((p) => p.userId !== menu.from.userId)
            .map((person) => (
              <MenuItem
                key={person.userId}
                onClick={() => {
                  setPending({ from: menu.from, to: person });
                  setMenu(null);
                }}
              >
                <ListItemText primary={person.username} secondary={t(`role.${person.role}`)} />
              </MenuItem>
            ))}
      </Menu>
      <Dialog open={pending !== null} onClose={() => !busy && setPending(null)}>
        <DialogTitle>{pending && t("divide.moveTitle", { from: pending.from.username, to: pending.to.username })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{pending && t("divide.moveText", { from: pending.from.username, to: pending.to.username })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void move()} disabled={busy}>
            {t("divide.move")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

// Pixel sizes as strings: in MUI's sx a number of 1 or less is a fraction (width: 1 is 100%),
// which made this hidden label as wide as the page and gave the page a horizontal scroll.
const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;

export function PlotFilePage({ projectId, fileId, onGo }: { projectId: string; fileId: string; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  const state = useLoad(() => loadFile(projectId, fileId), [projectId, fileId]);
  // Bumped by a move, so the form starts again from the new holders (and drops its old notice).
  const [moves, setMoves] = useState(0);
  const back = (
    <Box>
      <Button startIcon={<ArrowBack />} {...linkProps(pathFor({ name: "project", projectId, tab: "plots" }))}>
        {t("divide.back")}
      </Button>
    </Box>
  );

  if (state.loading && !state.data) return <Loading />;
  const missing = state.error instanceof ApiError && state.error.status === 404;
  if (missing || (state.data && !state.data.file)) {
    return (
      <Paper variant="outlined">
        <EmptyState title={t("divide.fileGone")} action={back} />
      </Paper>
    );
  }
  if (state.error || !state.data || !state.data.file) return <ErrorAlert error={state.error} onRetry={state.reload} />;

  const { file, members, current, columns } = state.data;
  const setCurrent = (next: DistributionState) => state.setData({ ...state.data!, current: next });

  return (
    <Stack spacing={3}>
      {back}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom sx={{ wordBreak: "break-word" }}>
          {t("divide.title", { file: file.filename })}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {t("divide.intro")}
        </Typography>
        {members.length <= 1 ? (
          <EmptyState
            title={t("plots.gridNeedsPeople")}
            action={
              <Button variant="contained" endIcon={<ArrowForward />} onClick={() => onGo("people")}>
                {t("step.invite.action")}
              </Button>
            }
          />
        ) : (
          <DivideForm projectId={projectId} fileId={fileId} members={members} columns={columns} current={current} onApplied={setCurrent} key={moves} />
        )}
      </Paper>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("divide.currentTitle")}
        </Typography>
        <CurrentDivision projectId={projectId} fileId={fileId} members={members} current={current}
          onChanged={(next) => {
            setCurrent(next);
            setMoves((n) => n + 1);
          }}
        />
      </Paper>
    </Stack>
  );
}
