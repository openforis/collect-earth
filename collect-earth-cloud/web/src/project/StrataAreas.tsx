import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import { useEffect, useRef, useState } from "react";
import { downloadAreasFile, getAreas, saveAreas, uploadAreasFile } from "../api";
import { useApp } from "../appContext";
import { areasOf, shownArea, strataSettings, stratumKey, typedArea } from "../areasView";
import { csvText } from "../backupImportView";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FileDrop } from "../components/FileDrop";
import { FoldingCard } from "../components/FoldingCard";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";

const SOURCE_KEYS: Record<string, MessageKey> = {
  strata: "areas.source.strata",
  total: "areas.source.total",
  "areas_per_attribute.csv": "areas.source.attributeFile",
  "region_areas.csv": "areas.source.regionFile",
  uncertainty: "areas.source.uncertainty",
};

/**
 * Strata and areas (docs/plans/2026-11-11-strata-areas.md): what each plot's area comes from, the area of each stratum
 * (the values of the columns chosen, as the plot files have them) or one total area. `version`: changes when the plot
 * files do, to count their plots again.
 */
export function StrataAreas({ projectId, version }: { projectId: string; version?: unknown }) {
  const t = useT();
  const { language } = useApp();
  // null: the saved columns; a choice previews the strata those columns make
  const [chosen, setChosen] = useState<string[] | null>(null);
  const state = useLoad(["project", projectId, "getAreas", chosen], () => getAreas(projectId, chosen ?? undefined));
  // The plot files changed (another file, other values): their strata are asked again
  const { reload } = state;
  const shown = useRef(version);
  useEffect(() => {
    if (shown.current === version) return;
    shown.current = version;
    reload();
  }, [version, reload]);
  const [mode, setMode] = useState<"strata" | "total" | null>(null);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [total, setTotal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const n = (v: number, digits = 0) => formatNumber(Math.round(v * 10 ** digits) / 10 ** digits, language);

  const d = state.data;
  if (state.loading && !d) return <Loading />;
  if (!d) return <ErrorAlert error={state.error} onRetry={state.reload} />;

  const shownMode = mode ?? (d.settings?.mode === "total" ? "total" : "strata");
  const columns = chosen ?? (d.settings?.mode === "strata" ? d.settings.columns : []);
  const areas = areasOf(d.strata, typed, language);
  const wrong = areas.some((a) => a !== null && Number.isNaN(a));
  const savedTotal = d.settings?.mode === "total" ? d.settings.area : null;
  const totalArea = total === null ? savedTotal : typedArea(total, language);
  const strataSetting = strataSettings(columns, d.strata, areas);
  const sum = areas.reduce<number>((s, a) => s + (a !== null && Number.isFinite(a) ? a : 0), 0);
  const withoutArea = d.strata.filter((s, i) => areas[i] === null && (s.assessed > 0 || (s.plots ?? 0) > 0)).length;

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await work();
      setTyped({});
      setTotal(null);
      setMode(null);
      setChosen(null);
      setSaved(true);
      state.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => saveAreas(projectId, shownMode === "total" ? { mode: "total", area: totalArea! } : strataSetting));
  const upload = ([file]: File[]) => run(async () => uploadAreasFile(projectId, csvText(new Uint8Array(await file.arrayBuffer()))));
  const download = async () => {
    try {
      const { blob, filename } = await downloadAreasFile(projectId);
      saveBlob(blob, filename);
    } catch (err) {
      setError(err);
    }
  };
  // not while the strata of other columns load: the areas would go with the strata shown, of the columns before
  const canSave = d.canEdit && !busy && !state.loading && !state.error && (shownMode === "total" ? totalArea !== null && totalArea > 0 : columns.length > 0 && !wrong && strataSetting.strata.some((s) => s.area > 0));

  return (
    <FoldingCard title={t("areas.title")} summary={d.source ? t(SOURCE_KEYS[d.source]) : t("areas.source.none")}>
      <Explain sx={{ mb: 2 }} text={t("areas.explain.short")} more={t("areas.explain")} />
      <Typography sx={{ mb: 2 }}>{d.source ? t(SOURCE_KEYS[d.source]) : t("areas.source.none")}</Typography>
      {d.canEdit && (
        <ToggleButtonGroup exclusive size="small" color="primary" value={shownMode} onChange={(_, v) => v && setMode(v)} sx={{ mb: 2, display: "flex", width: "fit-content" }} aria-label={t("areas.title")}>
          <ToggleButton value="strata">{t("areas.byStratum")}</ToggleButton>
          <ToggleButton value="total">{t("areas.total")}</ToggleButton>
        </ToggleButtonGroup>
      )}

      {shownMode === "total" ? (
        <TextField
          size="small"
          label={t("areas.totalLabel")}
          value={total ?? (savedTotal === null ? "" : shownArea(savedTotal, language))}
          onChange={(e) => setTotal(e.target.value)}
          error={totalArea !== null && Number.isNaN(totalArea)}
          helperText={t("areas.totalHelp", { plots: n(d.assessed) })}
          slotProps={{ htmlInput: { inputMode: "decimal" } }}
          disabled={!d.canEdit}
          sx={{ maxWidth: 320, mb: 2 }}
          fullWidth
        />
      ) : (
        <Stack spacing={2} sx={{ mb: 2 }}>
          <Autocomplete
            multiple
            size="small"
            options={d.columns}
            value={columns}
            onChange={(_, v) => {
              setChosen(v.slice(0, 5));
              setTyped({});
            }}
            disabled={!d.canEdit}
            renderInput={(params) => <TextField {...params} label={t("areas.columns")} helperText={t("areas.columnsHelp")} />}
            sx={{ maxWidth: 560 }}
          />
          {columns.length > 0 && d.strata.length > 0 && (
            <TableContainer sx={{ maxHeight: 480 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{columns.join(" / ")}</TableCell>
                    <TableCell align="right">{t("areas.col.plots")}</TableCell>
                    <TableCell align="right">{t("areas.col.assessed")}</TableCell>
                    <TableCell align="right">{t("areas.col.area")}</TableCell>
                    <TableCell align="right">{t("areas.col.haPerPlot")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {d.strata.map((s, i) => {
                    const key = stratumKey(s.values);
                    const area = areas[i];
                    return (
                      <TableRow key={key}>
                        <TableCell sx={{ wordBreak: "break-word" }}>{s.values.map((v) => v || "—").join(" / ")}</TableCell>
                        <TableCell align="right">{s.plots === null ? "—" : n(s.plots)}</TableCell>
                        <TableCell align="right">{n(s.assessed)}</TableCell>
                        <TableCell align="right" sx={{ minWidth: 130 }}>
                          <TextField
                            size="small"
                            variant="standard"
                            value={typed[key] ?? (s.area === null ? "" : shownArea(s.area, language))}
                            onChange={(e) => setTyped((x) => ({ ...x, [key]: e.target.value }))}
                            error={area !== null && Number.isNaN(area)}
                            disabled={!d.canEdit}
                            slotProps={{ htmlInput: { inputMode: "decimal", style: { textAlign: "right" }, "aria-label": t("areas.areaOf", { stratum: s.values.join(" / ") }) } }}
                          />
                        </TableCell>
                        {area !== null && Number.isFinite(area) && s.assessed > 0 ? (
                          <TableCell align="right">{n(area / s.assessed, 1)}</TableCell>
                        ) : area !== null && Number.isFinite(area) && (s.plots ?? 0) > 0 ? (
                          // none assessed yet: the design's, over the plots of the plot files
                          <TableCell align="right" sx={{ color: "text.secondary" }} title={t("areas.planned")}>
                            {n(area / s.plots!, 1)}
                          </TableCell>
                        ) : (
                          <TableCell align="right">—</TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {columns.length > 0 && <Typography variant="body2">{t("areas.sum", { area: n(sum, 1), strata: n(d.strata.length) })}</Typography>}
          {d.more > 0 && <Alert severity="warning">{t("areas.more", { count: n(d.more) })}</Alert>}
          {withoutArea > 0 && <Alert severity="info">{t("areas.withoutArea", { count: n(withoutArea) })}</Alert>}
        </Stack>
      )}

      <Stack spacing={1} sx={{ mb: 2 }}>
        {d.source !== null && d.assessed > 0 && <Typography variant="body2">{t("areas.counted", { withArea: n(d.withArea), assessed: n(d.assessed) })}</Typography>}
        {d.unknownColumns.length > 0 && <Alert severity="warning">{t("areas.unknownColumns", { columns: d.unknownColumns.join(", ") })}</Alert>}
        {d.noStratum.plots > 0 && (
          <Alert severity="warning">
            {t("areas.noStratum", { count: n(d.noStratum.plots), examples: d.noStratum.examples.map((e) => `${e.stratum || "—"} (${n(e.plots)})`).join(", ") })}
          </Alert>
        )}
        {d.unreadable > 0 && <Alert severity="warning">{t("areas.unreadable", { count: n(d.unreadable) })}</Alert>}
        {saved && (
          <Alert severity="success" role="status">
            {t("areas.saved")}
          </Alert>
        )}
        <ErrorAlert error={error} />
      </Stack>

      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        {d.canEdit && (
          <Button variant="contained" onClick={() => void save()} disabled={!canSave}>
            {t("areas.save")}
          </Button>
        )}
        {d.settings?.mode === "strata" && (
          <Button startIcon={<Download />} onClick={() => void download()}>
            {t("areas.download")}
          </Button>
        )}
        {d.canEdit && (d.source === "strata" || d.source === "total") && (
          <Button color="inherit" onClick={() => void run(() => saveAreas(projectId, null))} disabled={busy}>
            {t("areas.reset")}
          </Button>
        )}
      </Box>
      {d.canEdit && shownMode === "strata" && (
        <Box sx={{ mt: 2 }}>
          <FileDrop label={t("areas.drop")} buttonLabel={t("areas.choose")} accept=".csv,text/csv" disabled={busy} onFiles={(files) => void upload(files)} />
        </Box>
      )}
    </FoldingCard>
  );
}
