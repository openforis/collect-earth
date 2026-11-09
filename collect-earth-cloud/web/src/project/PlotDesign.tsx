import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { generatePlotDesign, planPlotDesign, readDesignArea, type DesignArea, type DesignFacts, type DesignPlan } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { bytesToBase64, designOf, plotFileName, type DesignForm } from "../plotDesignView";

const km2 = (n: number, language: string) => formatNumber(Math.round(n * 10) / 10, language);

/**
 * Plot design: an area of interest in, a plot file out. The plot file goes to `onFile`, the plot
 * tab's own upload (replacing a file of the same name is asked there, as for any upload).
 */
export function PlotDesign({ projectId, busy, onFile }: { projectId: string; busy: boolean; onFile: (file: File) => Promise<void> }) {
  const t = useT();
  const { language } = useApp();
  const [area, setArea] = useState<{ name: string; sent: DesignArea; facts: DesignFacts } | null>(null);
  const [form, setForm] = useState<DesignForm>({ method: "random", count: "100", spacing: "1000", randomOffset: true, field: "", allocation: "equal" });
  const [plan, setPlan] = useState<DesignPlan | null>(null);
  // The design the plan counted: the file is made only for the design whose count is shown.
  const [plannedFor, setPlannedFor] = useState("");
  const [filename, setFilename] = useState("");
  const [working, setWorking] = useState<"reading" | "checking" | "creating" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const design = area ? designOf(form, area.facts.max) : null;

  const read = async ([file]: File[]) => {
    setError(null);
    setArea(null);
    setPlan(null);
    setWorking("reading");
    try {
      const sent: DesignArea = file.name.toLowerCase().endsWith(".zip") ? { shapefile: bytesToBase64(new Uint8Array(await file.arrayBuffer())) } : { geojson: await file.text() };
      const facts = await readDesignArea(projectId, sent);
      setArea({ name: file.name, sent, facts });
      setFilename(plotFileName(file.name));
      setForm((f) => ({ ...f, field: facts.fields[0] ?? "" }));
    } catch (err) {
      setError(err);
    } finally {
      setWorking(null);
    }
  };

  // The count, worked out again (with the same seed, so the file made is the one counted) as the form changes.
  const seed = plan?.seed;
  const designKey = JSON.stringify(design);
  useEffect(() => {
    if (!area || !design) {
      setPlan(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      setWorking("checking");
      try {
        const next = await planPlotDesign(projectId, area.sent, design, seed);
        if (live) {
          setPlan(next);
          setPlannedFor(designKey);
          setError(null);
        }
      } catch (err) {
        if (live) setError(err);
      } finally {
        if (live) setWorking(null);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The seed is kept from the first count, not a reason to count again.
  }, [projectId, area, designKey]);

  const create = async () => {
    if (!area || !design || !plan) return;
    setError(null);
    setWorking("creating");
    try {
      const csv = await generatePlotDesign(projectId, area.sent, design, plan.seed);
      const name = filename.trim().toLowerCase().endsWith(".csv") ? filename.trim() : `${filename.trim() || "plots"}.csv`;
      await onFile(new File([csv], name, { type: "text/csv" }));
    } catch (err) {
      setError(err);
    } finally {
      setWorking(null);
    }
  };

  const set = (change: Partial<DesignForm>) => setForm((f) => ({ ...f, ...change }));
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" gutterBottom>
        {t("design.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("design.explain")}
      </Typography>
      <Stack spacing={2}>
        <FileDrop label={t("design.drop")} buttonLabel={t("design.choose")} accept=".geojson,.json,.zip,application/geo+json,application/zip" disabled={working !== null || busy} onFiles={read} />
        {working === "reading" && <Typography role="status">{t("design.reading")}</Typography>}
        {area && (
          <>
            <Typography>{t("design.area", { name: area.name, features: formatNumber(area.facts.features, language), area: km2(area.facts.areaKm2, language) })}</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
              <TextField select size="small" label={t("design.method")} value={form.method} onChange={(e) => set({ method: e.target.value as DesignForm["method"] })} sx={{ minWidth: 240 }}>
                <MenuItem value="random">{t("design.random")}</MenuItem>
                <MenuItem value="grid">{t("design.grid")}</MenuItem>
                <MenuItem value="stratified" disabled={area.facts.fields.length === 0}>
                  {t("design.stratified")}
                </MenuItem>
              </TextField>
              {form.method === "stratified" && (
                <>
                  <TextField select size="small" label={t("design.field")} value={form.field} onChange={(e) => set({ field: e.target.value })} sx={{ minWidth: 180 }}>
                    {area.facts.fields.map((f) => (
                      <MenuItem key={f} value={f}>
                        {f}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField select size="small" label={t("design.allocation")} value={form.allocation} onChange={(e) => set({ allocation: e.target.value as DesignForm["allocation"] })} sx={{ minWidth: 220 }}>
                    <MenuItem value="equal">{t("design.equal")}</MenuItem>
                    <MenuItem value="proportional">{t("design.proportional")}</MenuItem>
                  </TextField>
                </>
              )}
              {form.method === "grid" ? (
                <TextField size="small" type="number" label={t("design.spacing")} value={form.spacing} onChange={(e) => set({ spacing: e.target.value })} slotProps={{ htmlInput: { min: 1 } }} />
              ) : (
                <TextField
                  size="small"
                  type="number"
                  label={t(form.method === "stratified" && form.allocation === "equal" ? "design.countPerStratum" : "design.count")}
                  value={form.count}
                  onChange={(e) => set({ count: e.target.value })}
                  slotProps={{ htmlInput: { min: 1, max: area.facts.max, step: 1 } }}
                />
              )}
              {form.method === "grid" && (
                <FormControlLabel control={<Checkbox checked={form.randomOffset} onChange={(e) => set({ randomOffset: e.target.checked })} />} label={t("design.offset")} />
              )}
            </Stack>
            <div role="status">
              {working === "checking" ? (
                <Typography color="text.secondary">{t("design.checking")}</Typography>
              ) : plan && design ? (
                plan.tooMany ? (
                  <Alert severity="warning">{t("design.tooMany", { count: formatNumber(plan.plots, language), max: formatNumber(plan.max, language) })}</Alert>
                ) : (
                  <>
                    <Typography>{t("design.estimate", { count: formatNumber(plan.plots, language) })}</Typography>
                    {plan.strata && (
                      <Box component="ul" sx={{ my: 1, color: "text.secondary" }}>
                        {plan.strata.map((s) => (
                          <li key={s.value}>{t("design.stratum", { value: s.value || t("design.noValue"), count: formatNumber(s.plots, language), area: km2(s.areaKm2, language) })}</li>
                        ))}
                      </Box>
                    )}
                  </>
                )
              ) : null}
            </div>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
              <TextField size="small" label={t("design.filename")} value={filename} onChange={(e) => setFilename(e.target.value)} sx={{ minWidth: 260 }} />
              <Box>
                <Button variant="contained" onClick={create} disabled={working !== null || busy || !design || !plan || plannedFor !== designKey || plan.tooMany || plan.plots === 0}>
                  {working === "creating" ? t("design.creating") : t("design.create")}
                </Button>
              </Box>
            </Stack>
          </>
        )}
        <ErrorAlert error={error} />
      </Stack>
    </Paper>
  );
}
