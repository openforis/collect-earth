import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import FormLabel from "@mui/material/FormLabel";
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
import { useEffect, useId, useRef, useState } from "react";
import { drawSamplingNow, getSampling, saveSampling, type SamplingView } from "../api";
import { useApp } from "../appContext";
import { formOf, formWarnings, MAX_FIRST_N, notBlindText, ruleOf, type ChecksForm, type FileForm, type FileUse, type FormError } from "../checksView";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" } as const;

/** The id of a number field of the form (the project's, or a file's own rule's). */
const fieldId = (base: string, field: "firstN" | "percent", file?: string) => `${base}-${file ?? "project"}-${field}`;

/** One divided file's row: what it follows, and its own rule's fields when it has one. */
function FileRow({ file, form, error, idBase, onChange }: { file: SamplingView["files"][number]; form: FileForm; error: FormError | null; idBase: string; onChange: (f: FileForm) => void }) {
  const t = useT();
  const { language } = useApp();
  return (
    <TableRow>
      {/* A file name keeps a readable width; the table scrolls sideways in its frame on a phone. */}
      <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", minWidth: 160 }}>
        {file.filename}
      </TableCell>
      <TableCell sx={{ minWidth: 200 }}>
        <Stack spacing={1}>
          <Select size="small" value={form.use} onChange={(e) => onChange({ ...form, use: e.target.value as FileUse })} inputProps={{ "aria-label": `${t("checks.fileUse")}: ${file.filename}` }}>
            <MenuItem value="project">{t("checks.useProject")}</MenuItem>
            <MenuItem value="off">{t("checks.useOff")}</MenuItem>
            <MenuItem value="own">{t("checks.useOwn")}</MenuItem>
          </Select>
          {form.use === "own" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                size="small"
                id={fieldId(idBase, "firstN", file.csvFileId)}
                label={t("checks.ownFirstN")}
                value={form.firstN}
                onChange={(e) => onChange({ ...form, firstN: e.target.value })}
                inputMode="numeric"
                error={error?.field === "firstN"}
                helperText={error?.field === "firstN" ? t("checks.invalidN", { max: MAX_FIRST_N }) : undefined}
              />
              <TextField
                size="small"
                id={fieldId(idBase, "percent", file.csvFileId)}
                label={t("checks.ownPercent")}
                value={form.percent}
                onChange={(e) => onChange({ ...form, percent: e.target.value })}
                inputMode="numeric"
                error={error?.field === "percent"}
                helperText={error?.field === "percent" ? t("checks.invalidPercent") : undefined}
              />
            </Stack>
          )}
        </Stack>
      </TableCell>
      <TableCell align="right">{formatNumber(file.submitted, language)}</TableCell>
      <TableCell align="right">{formatNumber(file.sampledCopies, language)}</TableCell>
      <TableCell align="right">
        {formatNumber(file.divisionCopies, language)}
        {file.referenceCopies > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "normal", minWidth: 140 }}>
            {t(file.referenceCopies === 1 ? "checks.referenceCopiesOne" : "checks.referenceCopies", { count: formatNumber(file.referenceCopies, language) })}
          </Typography>
        )}
      </TableCell>
    </TableRow>
  );
}

/** The rule's form: the two parts, who may check, and the divided files. */
function RuleForm({ projectId, view, onSaved }: { projectId: string; view: SamplingView; onSaved: (v: SamplingView) => void }) {
  const t = useT();
  const idBase = useId();
  const [form, setForm] = useState<ChecksForm>(() => formOf(view));
  const [error, setError] = useState<FormError | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  // A rule saved (here or elsewhere) refills the form.
  // A rule saved (here or elsewhere) refills the form; a reload or "Draw now" bringing the same
  // rule back keeps what is being typed.
  const savedRule = JSON.stringify(view.rule);
  const seenRule = useRef(savedRule);
  useEffect(() => {
    if (seenRule.current === savedRule) return;
    seenRule.current = savedRule;
    setForm(formOf(view));
  }, [savedRule]);
  const change = (patch: Partial<ChecksForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setSaved(false);
    setError(null);
  };
  const save = async () => {
    const result = ruleOf(form);
    if ("error" in result) {
      setError(result.error);
      // The field that cannot be saved gets the focus (its message is read with it).
      const id = fieldId(idBase, result.error.field, result.error.file);
      window.setTimeout(() => document.getElementById(id)?.focus(), 0);
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      onSaved(await saveSampling(projectId, result.rule));
      setSaved(true);
    } catch (err) {
      setFailure(err);
    } finally {
      setSaving(false);
    }
  };
  const members = view.members.filter((m) => !m.disabled || form.checkers.includes(m.userId));
  const projectError = error && !error.file ? error : null;
  // The warnings follow the form as typed (the server gives the same ones for the saved rule).
  const warnings = formWarnings(form, view.members);
  return (
    <Stack spacing={2}>
      <Stack spacing={1}>
        <FormControlLabel control={<Switch checked={form.firstNOn} onChange={(e) => change({ firstNOn: e.target.checked })} />} label={t("checks.firstN")} />
        {form.firstNOn && (
          <TextField
            size="small"
            id={fieldId(idBase, "firstN")}
            label={t("checks.firstNCount")}
            value={form.firstN}
            onChange={(e) => change({ firstN: e.target.value })}
            inputMode="numeric"
            sx={{ maxWidth: 260 }}
            error={projectError?.field === "firstN"}
            helperText={projectError?.field === "firstN" ? t("checks.invalidN", { max: MAX_FIRST_N }) : undefined}
          />
        )}
        <FormControlLabel control={<Switch checked={form.percentOn} onChange={(e) => change({ percentOn: e.target.checked })} />} label={t("checks.percent")} />
        {form.percentOn && (
          <>
            <TextField
              size="small"
              id={fieldId(idBase, "percent")}
              label={t("checks.percentCount")}
              value={form.percent}
              onChange={(e) => change({ percent: e.target.value })}
              inputMode="numeric"
              sx={{ maxWidth: 260 }}
              error={projectError?.field === "percent"}
              helperText={projectError?.field === "percent" ? t("checks.invalidPercent") : undefined}
            />
            <Typography variant="body2" color="text.secondary">
              {t("checks.weekNote")}
            </Typography>
          </>
        )}
        {!form.firstNOn && !form.percentOn && (
          <Typography variant="body2" color="text.secondary">
            {t("checks.off")}
          </Typography>
        )}
      </Stack>
      <FormControl>
        <FormLabel id={`${idBase}-checkers`}>{t("checks.checkers")}</FormLabel>
        <RadioGroup aria-labelledby={`${idBase}-checkers`} value={form.checkersAll ? "all" : "some"} onChange={(e) => change({ checkersAll: e.target.value === "all" })}>
          <FormControlLabel value="all" control={<Radio />} label={t("checks.checkersAll")} />
          <FormControlLabel value="some" control={<Radio />} label={t("checks.checkersSome")} />
        </RadioGroup>
        {!form.checkersAll && (
          <FormGroup sx={{ pl: 4 }}>
            {members.map((m) => (
              <FormControlLabel
                key={m.userId}
                control={
                  <Checkbox
                    checked={form.checkers.includes(m.userId)}
                    onChange={(e) => change({ checkers: e.target.checked ? [...form.checkers, m.userId] : form.checkers.filter((id) => id !== m.userId) })}
                  />
                }
                label={`${m.username} (${t(`role.${m.role}`)}${m.disabled ? `, ${t("checks.disabled")}` : ""})`}
              />
            ))}
          </FormGroup>
        )}
      </FormControl>
      {view.files.length > 0 && (
        <Stack spacing={1}>
          <Typography variant="h3">{t("checks.filesTitle")}</Typography>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("checks.file")}</TableCell>
                  <TableCell>{t("checks.fileUse")}</TableCell>
                  <TableCell align="right">{t("checks.submittedCol")}</TableCell>
                  <TableCell align="right">{t("checks.drawnCol")}</TableCell>
                  <TableCell align="right">{t("checks.divisionCol")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {view.files.map((file) => (
                  <FileRow
                    key={file.csvFileId}
                    file={file}
                    form={form.files[file.csvFileId] ?? { use: "project", firstN: "", percent: "" }}
                    error={error?.file === file.csvFileId ? error : null}
                    idBase={idBase}
                    onChange={(f) => change({ files: { ...form.files, [file.csvFileId]: f } })}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      )}
      {warnings.noCheckers && (
        <Alert severity="warning" role="status">
          {t("checks.noCheckers")}
        </Alert>
      )}
      {warnings.notBlind.length > 0 && (
        <Alert severity="warning" role="status">
          {notBlindText(t, warnings.notBlind)}
        </Alert>
      )}
      {failure !== null && <ErrorAlert error={failure} />}
      {saved && (
        <Alert severity="success" role="status">
          {t("checks.saved")}
        </Alert>
      )}
      <Box>
        <Button variant="contained" onClick={save} disabled={saving}>
          {t("checks.save")}
        </Button>
      </Box>
    </Stack>
  );
}

/** The last draw, what is due, and "Draw now". */
function DrawStatus({ projectId, view, onDrawn }: { projectId: string; view: SamplingView; onDrawn: (v: SamplingView) => void }) {
  const t = useT();
  const { language } = useApp();
  const [drawing, setDrawing] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const draw = async () => {
    setDrawing(true);
    setFailure(null);
    setDone(null);
    try {
      const result = await drawSamplingNow(projectId);
      setDone(result.drawn);
      onDrawn(result.view);
    } catch (err) {
      setFailure(err);
    } finally {
      setDrawing(false);
    }
  };
  const last = view.lastDraw;
  return (
    <Stack spacing={1}>
      <Typography>
        {last
          ? t("checks.lastDraw", {
              date: formatDate(last.at, language),
              who: last.automatic ? t("checks.lastDrawAuto") : last.by ? t("checks.lastDrawBy", { name: last.by }) : t("activity.someone"),
              count: formatNumber(last.drawn, language),
            })
          : t("checks.lastDrawNone")}
      </Typography>
      {view.lastCheckedAt !== null && (!last || view.lastCheckedAt > last.at) && (
        <Typography variant="body2" color="text.secondary">
          {t("checks.lastChecked", { date: formatDate(view.lastCheckedAt, language) })}
        </Typography>
      )}
      {last && last.noChecker > 0 && <Alert severity="warning">{t("checks.noChecker", { count: formatNumber(last.noChecker, language) })}</Alert>}
      {view.due && view.nextAutomaticAt !== null && (
        <Typography variant="body2" color="text.secondary">
          {t("checks.due", { time: formatDate(view.nextAutomaticAt, language) })}
        </Typography>
      )}
      {view.active && (
        <Typography variant="body2">
          {view.pending.drawn > 0 ? t("checks.pending", { count: formatNumber(view.pending.drawn, language) }) : t("checks.pendingNone")}
        </Typography>
      )}
      {view.active && view.pending.noChecker > 0 && (!last || last.noChecker === 0) && (
        <Alert severity="warning">{t("checks.noChecker", { count: formatNumber(view.pending.noChecker, language) })}</Alert>
      )}
      {failure !== null && <ErrorAlert error={failure} />}
      {done !== null && (
        <Alert severity="success" role="status">
          {t("checks.drawn", { count: formatNumber(done, language) })}
        </Alert>
      )}
      <Box>
        <Button variant="outlined" onClick={draw} disabled={drawing || !view.active}>
          {t("checks.drawNow")}
        </Button>
      </Box>
    </Stack>
  );
}

/** Checks per person: open, done, and of them drawn automatically. */
function Load({ view }: { view: SamplingView }) {
  const t = useT();
  const { language } = useApp();
  const people = view.checkers.filter((c) => c.open + c.done > 0);
  return (
    <Stack spacing={1}>
      <Typography variant="h3">{t("checks.loadTitle")}</Typography>
      <Typography variant="body2" color="text.secondary">
        {t("checks.loadExplain")}
      </Typography>
      {people.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t("checks.loadNone")}
        </Typography>
      ) : (
        <TableContainer sx={tableFrame}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("checks.person")}</TableCell>
                <TableCell align="right">{t("checks.open")}</TableCell>
                <TableCell align="right">{t("checks.done")}</TableCell>
                <TableCell align="right">{t("checks.sampled")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {people.map((c) => (
                <TableRow key={c.userId}>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                    {c.username}
                    {c.disabled ? ` (${t("checks.disabled")})` : ""}
                  </TableCell>
                  <TableCell align="right">{formatNumber(c.open, language)}</TableCell>
                  <TableCell align="right">{formatNumber(c.done, language)}</TableCell>
                  <TableCell align="right">{formatNumber(c.sampled, language)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}

/**
 * The Quality tab's "Automatic checks" (coordinators): the rule that draws plots for a second,
 * blind assessment, its last draw and "Draw now", the divided files (whole files cannot hold
 * checks) and each person's checks.
 */
export function QualityChecks({ projectId }: { projectId: string }) {
  const t = useT();
  const { data, error, loading, reload, setData } = useLoad(() => getSampling(projectId), [projectId]);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section">
      <Stack spacing={2}>
        <Typography variant="h2">{t("checks.title")}</Typography>
        <Typography color="text.secondary">{t("checks.explain")}</Typography>
        {!data ? (
          loading ? (
            <Loading />
          ) : (
            <ErrorAlert error={error} onRetry={reload} />
          )
        ) : (
          <>
            {data.files.length === 0 && <Alert severity="info">{t("checks.noFiles")}</Alert>}
            {data.wholeFiles.length > 0 && <Alert severity="info">{t("checks.whole", { files: data.wholeFiles.map((f) => f.filename).join(", ") })}</Alert>}
            <RuleForm projectId={projectId} view={data} onSaved={setData} />
            <DrawStatus projectId={projectId} view={data} onDrawn={setData} />
            <Load view={data} />
          </>
        )}
      </Stack>
    </Paper>
  );
}
