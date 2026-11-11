import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBack from "@mui/icons-material/ArrowBack";
import Download from "@mui/icons-material/Download";
import { useMemo, useState } from "react";
import {
  ApiError,
  getProject,
  getUncertainty,
  getUncertaintySetup,
  IPCC_CATEGORIES,
  saveUncertaintySettings,
  type UncertaintyData,
  type UncertaintySetup,
} from "../api";
import { labelIn } from "../analysisView";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { csvBlob } from "../csv";
import { useT, type MessageKey } from "../i18n";
import { linkProps, pathFor } from "../router";
import { saveBlob } from "../saveBlob";
import { codeRows, codesOf, csvOf, uncertaintySheets, xlsxOf, type CodeChoice, type CodeRow, type ColumnFormat, type Sheet } from "../uncertaintyView";
import { useLoad } from "../useLoad";

/** The IPCC uncertainty of the land areas (coordinators and reviewers): the setup, then the tables, to download. */
export function UncertaintyPage({ projectId }: { projectId: string }) {
  const t = useT();
  const project = useLoad(() => getProject(projectId), [projectId]);
  const setup = useLoad(() => getUncertaintySetup(projectId), [projectId]);
  const [editing, setEditing] = useState(false);
  const forbidden = setup.error instanceof ApiError && setup.error.status === 403;
  const settings = setup.data?.settings ?? null;
  return (
    <AppShell wide>
      <Box sx={{ mb: 2 }}>
        <Button startIcon={<ArrowBack />} {...linkProps(pathFor({ name: "analysis", projectId }))}>
          {t("uncertainty.back")}
        </Button>
      </Box>
      <Typography variant="h1" sx={{ mb: 1 }}>
        {t("uncertainty.title")}
      </Typography>
      <Typography sx={{ mb: 0.5 }}>{t("uncertainty.intro")}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("uncertainty.cite")}
      </Typography>
      {setup.loading && !setup.data ? (
        <Loading />
      ) : forbidden ? (
        <Alert severity="info">{t("uncertainty.forbidden")}</Alert>
      ) : setup.error ? (
        <ErrorAlert error={setup.error} onRetry={setup.reload} />
      ) : setup.data ? (
        settings && !editing ? (
          <>
            {setup.data.canEdit && (
              <Button sx={{ mb: 2 }} variant="outlined" onClick={() => setEditing(true)}>
                {t("uncertainty.change")}
              </Button>
            )}
            <Results projectId={projectId} projectName={project.data?.name ?? ""} />
          </>
        ) : setup.data.canEdit ? (
          <SetupForm
            projectId={projectId}
            setup={setup.data}
            onCancel={settings ? () => setEditing(false) : undefined}
            onSaved={(saved) => {
              setup.setData((prev) => ({ ...prev, settings: saved }));
              setEditing(false);
            }}
          />
        ) : (
          <Alert severity="info">{t("uncertainty.notSetUp")}</Alert>
        )
      ) : null}
    </AppShell>
  );
}

function SetupForm({ projectId, setup, onSaved, onCancel }: { projectId: string; setup: UncertaintySetup; onSaved: (s: NonNullable<UncertaintySetup["settings"]>) => void; onCancel?: () => void }) {
  const t = useT();
  const { language } = useApp();
  const s = setup.settings;
  const named = (name: string) => (setup.questions.some((q) => q.name === name) ? name : "");
  const [initial, setInitial] = useState(named(s?.initial ?? ""));
  const [final, setFinal] = useState(named(s?.final ?? "land_use_category"));
  const [initialYear, setInitialYear] = useState(s?.initialYear ?? "");
  const [finalYear, setFinalYear] = useState(s?.finalYear ?? "");
  const [totalArea, setTotalArea] = useState(s?.totalArea ? String(s.totalArea) : "");
  // the person's choices, over the saved ones (the rows are worked out again when the questions change)
  const [chosen, setChosen] = useState<Record<string, CodeChoice>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rows: CodeRow[] = useMemo(
    () => codeRows(setup.questions, setup.lists, [initial, final], s?.codes ?? {}, (i) => labelIn(i.labels, language, setup, i.code)).map((r) => ({ ...r, choice: chosen[`${r.list}\u0000${r.code}`] ?? r.choice })),
    [setup, initial, final, s, language, chosen],
  );
  const area = Number(totalArea.replace(",", "."));
  const needsArea = setup.areas === null;
  const ready = initial !== "" && final !== "" && (!needsArea || (Number.isFinite(area) && area > 0));
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveUncertaintySettings(projectId, { initial, final, initialYear, finalYear, codes: codesOf(rows), totalArea: needsArea ? area : null }));
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };
  const question = (value: string, onChange: (v: string) => void, label: MessageKey) => (
    <TextField select size="small" label={t(label)} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 240, flex: 1 }}>
      {setup.questions.map((q) => (
        <MenuItem key={q.name} value={q.name}>
          {labelIn(q.labels, language, setup, q.name)} ({q.name})
        </MenuItem>
      ))}
    </TextField>
  );
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h2" sx={{ mb: 2 }}>
        {t("uncertainty.setup")}
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        {question(initial, setInitial, "uncertainty.initialQuestion")}
        <TextField size="small" label={t("uncertainty.initialYear")} value={initialYear} onChange={(e) => setInitialYear(e.target.value)} slotProps={{ htmlInput: { maxLength: 20 } }} />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2 }}>
        {question(final, setFinal, "uncertainty.finalQuestion")}
        <TextField size="small" label={t("uncertainty.finalYear")} value={finalYear} onChange={(e) => setFinalYear(e.target.value)} slotProps={{ htmlInput: { maxLength: 20 } }} />
      </Stack>
      {needsArea ? (
        <TextField
          size="small"
          label={t("uncertainty.totalArea")}
          value={totalArea}
          onChange={(e) => setTotalArea(e.target.value)}
          slotProps={{ htmlInput: { inputMode: "decimal" } }}
          helperText={t("uncertainty.totalAreaHelp")}
          sx={{ mb: 2, maxWidth: 420 }}
          fullWidth
        />
      ) : (
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t("uncertainty.areasFile", { file: setup.areas! })}
        </Typography>
      )}
      {rows.length > 0 && (
        <>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            {t("uncertainty.codes")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("uncertainty.codesHelp")}
          </Typography>
          <TableContainer sx={{ mb: 2, maxHeight: 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t("uncertainty.col.code")}</TableCell>
                  <TableCell>{t("uncertainty.col.category")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.list} ${r.code}`}>
                    <TableCell>
                      {r.label} <Typography component="span" variant="body2" color="text.secondary">({r.code})</Typography>
                    </TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        aria-label={`${t("uncertainty.col.category")}: ${r.label}`}
                        value={r.choice === null ? "-" : r.choice}
                        onChange={(e) => setChosen((prev) => ({ ...prev, [`${r.list}\u0000${r.code}`]: e.target.value === "-" ? null : (e.target.value as CodeChoice) }))}
                      >
                        {IPCC_CATEGORIES.map((c) => (
                          <MenuItem key={c} value={c}>
                            {t(`uncertainty.cat.${c}` as MessageKey)}
                          </MenuItem>
                        ))}
                        <MenuItem value="-">{t("uncertainty.leaveOut")}</MenuItem>
                        <MenuItem value="">{t("uncertainty.notMapped")}</MenuItem>
                      </TextField>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
      {error ? <ErrorAlert error={error} /> : null}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button variant="contained" disabled={!ready || saving} onClick={save}>
          {t("uncertainty.save")}
        </Button>
        {onCancel && <Button onClick={onCancel}>{t("uncertainty.cancel")}</Button>}
      </Stack>
    </Paper>
  );
}

const ERROR_KEYS: Record<string, MessageKey> = { not_set_up: "uncertainty.notSetUp", needs_total_area: "uncertainty.needsTotalArea", question_missing: "uncertainty.questionMissing" };

function Results({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useT();
  const { language } = useApp();
  const data = useLoad(() => getUncertainty(projectId), [projectId]);
  const sheets = useMemo(() => (data.data ? uncertaintySheets(data.data, t) : []), [data.data, t]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) {
    const key = data.error instanceof ApiError ? ERROR_KEYS[data.error.code] : undefined;
    return key ? <Alert severity="warning">{t(key)}</Alert> : <ErrorAlert error={data.error} onRetry={data.reload} />;
  }
  const d = data.data;
  if (!d) return null;
  const file = `${projectName || "project"} - uncertainty`;
  return (
    <Stack spacing={3}>
      <Summary d={d} />
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
        <Button variant="outlined" startIcon={<Download />} onClick={() => saveBlob(new Blob([xlsxOf(sheets) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${file}.xlsx`)}>
          {t("uncertainty.download.xlsx")}
        </Button>
        <Button variant="outlined" startIcon={<Download />} onClick={() => saveBlob(csvBlob(csvOf(sheets, language)), `${file}.csv`)}>
          {t("uncertainty.download.csv")}
        </Button>
      </Stack>
      <Legend />
      {sheets.map((s) => (
        <SheetTable key={s.id} sheet={s} />
      ))}
    </Stack>
  );
}

function Summary({ d }: { d: UncertaintyData }) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number, digits = 0) => new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(v);
  const skipped = (["missing", "unmapped", "noArea"] as const).filter((k) => d.skipped[k] > 0);
  const noData = Math.max(d.noData.initial.area, d.noData.final.area);
  const unmappedOf = (which: "initial" | "final") => d.unmapped.filter((u) => u.which === which);
  return (
    <Stack spacing={1}>
      <Typography>{t("uncertainty.summary", { plots: n(d.plots), area: n(d.totalArea, 1) })}</Typography>
      <Typography variant="body2">{d.estimator === "simple" ? t("uncertainty.estimator.simple") : t("uncertainty.estimator.stratified", { strata: n(d.strata.filter((s) => s.plots > 0).length) })}</Typography>
      {skipped.length > 0 && (
        <Alert severity="info">
          {t("uncertainty.skippedTitle")}
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {skipped.map((k) => (
              <li key={k}>{t(`uncertainty.skipped.${k}`, { count: n(d.skipped[k]) })}</li>
            ))}
          </Box>
          {(["initial", "final"] as const).map((which) =>
            unmappedOf(which).length > 0 ? (
              <div key={which}>
                {t("uncertainty.unmappedList", { year: which === "initial" ? d.settings.initialYear : d.settings.finalYear, codes: unmappedOf(which).map((u) => `${u.code} (${n(u.plots)})`).join(", ") })}
              </div>
            ) : null,
          )}
        </Alert>
      )}
      {noData > 0 && (
        <Alert severity="info">
          {t("uncertainty.noDataNote", { initial: n(d.noData.initial.area, 1), final: n(d.noData.final.area, 1), initialYear: d.settings.initialYear, finalYear: d.settings.finalYear })}
        </Alert>
      )}
      {d.notEstimable.length > 0 && (
        <Alert severity="warning">{t("uncertainty.notEstimable", { strata: d.notEstimable.map((s) => `${s.key || "—"} (${n(s.plots)})`).join(", ") })}</Alert>
      )}
    </Stack>
  );
}

function Legend() {
  const t = useT();
  const keys = ["plots", "share", "area", "se", "ci", "uncertainty", "matrix"] as const;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h3" sx={{ mb: 1 }}>
        {t("uncertainty.legend.title")}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 3 }}>
        {keys.map((k) => (
          <Typography component="li" variant="body2" key={k}>
            {t(`uncertainty.legend.${k}`)}
          </Typography>
        ))}
      </Box>
    </Paper>
  );
}

const DIGITS: Record<ColumnFormat, number> = { text: 0, count: 0, share: 4, ha: 1, percent: 1 };

function SheetTable({ sheet }: { sheet: Sheet }) {
  const { language } = useApp();
  const show = (v: string | number | null, f: ColumnFormat) => (v === null ? "—" : typeof v === "number" ? new Intl.NumberFormat(language, { maximumFractionDigits: DIGITS[f], minimumFractionDigits: f === "count" ? 0 : Math.min(1, DIGITS[f]) }).format(v) : v);
  return (
    <Box>
      <Typography variant="h2" sx={{ mb: 1 }}>
        {sheet.title}
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {sheet.header.map((h, i) => (
                <TableCell key={i} align={sheet.formats[i] === "text" ? "left" : "right"} sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {sheet.rows.map((row, r) => (
              <TableRow key={r}>
                {row.map((v, i) => (
                  <TableCell key={i} align={sheet.formats[i] === "text" ? "left" : "right"} sx={{ whiteSpace: "nowrap" }}>
                    {show(v, sheet.formats[i])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
