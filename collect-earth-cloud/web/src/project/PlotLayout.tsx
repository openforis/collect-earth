import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useState, type FormEvent } from "react";
import { getPlotLayout, savePlotLayout, type PlotLayoutSettings } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { useT, type MessageKey } from "../i18n";
import { BUFFER_SHAPES, NUMBER_FIELDS, POINT_COUNTS, SAMPLE_SHAPES, checkLayout, distanceMeaning, isShown, layoutDiffers, type NumberKey } from "../plotLayoutView";
import { linkProps, pathFor } from "../router";
import { hexagonPoints, plotDrawing, scaleBarLength, type Outline } from "../shared/plotPreview";
import { useLoad } from "../useLoad";

/** The plots' yellow on the map of Collect Earth, and the reference area's grey (the desktop's settings preview) */
const PLOT_COLOR = "#fbc02d";
const REFERENCE_COLOR = "#8d9aa5";

const FIELD_LABEL: Record<Exclude<NumberKey, "distance_between_sample_points">, MessageKey> = {
  distance_to_plot_boundaries: "layout.margin",
  inner_point_side: "layout.innerSide",
  large_central_plot_side: "layout.centralSide",
  distance_between_plots: "layout.betweenPlots",
  distance_to_buffers: "layout.bufferDistance",
};

/** The plot drawn to scale, as Collect Earth draws it, north up, with a scale bar (the desktop's settings preview). */
function LayoutPreview({ layout }: { layout: PlotLayoutSettings }) {
  const t = useT();
  const drawing = plotDrawing({ ...layout });
  if (!drawing) return <Typography variant="body2" color="text.secondary">{t("layout.noPreview")}</Typography>;
  const e = drawing.extent || 1;
  const bar = scaleBarLength(e);
  const stroke = e / 150;
  const shape = (outline: Outline, props: Record<string, unknown>) => {
    if (outline.kind === "square") return <rect x={-outline.half} y={-outline.half} width={2 * outline.half} height={2 * outline.half} {...props} />;
    if (outline.kind === "circle") return <circle cx={0} cy={0} r={outline.r} {...props} />;
    return <polygon points={hexagonPoints(0, 0, outline.r)} {...props} />;
  };
  return (
    <Stack spacing={1}>
      <Box component="svg" viewBox={`${-e} ${-e} ${2 * e} ${2 * e}`} role="img" aria-label={t("layout.preview")} data-testid="layout-preview"
        sx={{ width: "100%", maxWidth: 320, aspectRatio: "1", display: "block", bgcolor: "action.hover", borderRadius: 1 }}>
        <g transform="scale(1,-1)">
          {drawing.reference && shape(drawing.reference, { fill: "none", stroke: REFERENCE_COLOR, strokeWidth: stroke, strokeDasharray: `${stroke * 4} ${stroke * 3}` })}
          {drawing.clusterPlots.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={PLOT_COLOR} fillOpacity={0.15} stroke={PLOT_COLOR} strokeWidth={stroke * 1.5} />
          ))}
          {shape(drawing.outline, { fill: PLOT_COLOR, fillOpacity: 0.15, stroke: PLOT_COLOR, strokeWidth: stroke * 1.5 })}
          {drawing.centralPlot && (
            <rect x={-drawing.centralPlot.half} y={-drawing.centralPlot.half} width={2 * drawing.centralPlot.half} height={2 * drawing.centralPlot.half}
              fill="none" stroke={PLOT_COLOR} strokeWidth={stroke * 1.5} />
          )}
          {drawing.points.map((p, i) => (
            <rect key={i} x={p.x - p.side / 2} y={p.y - p.side / 2} width={p.side} height={p.side} fill={PLOT_COLOR} stroke="#5d4a00" strokeWidth={stroke / 2} />
          ))}
        </g>
        <g fill="currentColor" stroke="currentColor">
          <line x1={-e * 0.92} y1={e * 0.9} x2={-e * 0.92 + bar} y2={e * 0.9} strokeWidth={stroke * 1.5} />
          <line x1={-e * 0.92} y1={e * 0.87} x2={-e * 0.92} y2={e * 0.93} strokeWidth={stroke} />
          <line x1={-e * 0.92 + bar} y1={e * 0.87} x2={-e * 0.92 + bar} y2={e * 0.93} strokeWidth={stroke} />
          <text x={-e * 0.92 + bar / 2} y={e * 0.84} fontSize={e * 0.08} textAnchor="middle" stroke="none">{bar} m</text>
        </g>
      </Box>
      {drawing.randomPoints > 0 && (
        <Typography variant="caption" color="text.secondary">{t("layout.randomPoints", { count: String(drawing.randomPoints) })}</Typography>
      )}
    </Stack>
  );
}

/**
 * The plot layout (Project file tab): how Collect Earth draws each plot for the collectors, kept in the project file's
 * properties, with the fields the desktop's settings page shows for the shape chosen, a preview to scale and the areas.
 * Saving makes a new project file, which the collectors who joined before get as after an upload (People).
 */
export function PlotLayoutCard({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const t = useT();
  const { language } = useApp();
  const loaded = useLoad(() => getPlotLayout(projectId), [projectId]);
  const [layout, setLayout] = useState<PlotLayoutSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<"saved" | "unchanged" | null>(null);
  useEffect(() => {
    if (loaded.data) setLayout(loaded.data.layout);
  }, [loaded.data]);

  if (loaded.loading && !loaded.data) return <Loading />;
  if (loaded.error) return <ErrorAlert error={loaded.error} onRetry={loaded.reload} />;
  if (!loaded.data || !layout) return null;
  const { canEdit, polygons } = loaded.data;
  const check = checkLayout(layout);
  const blocked = check.invalid.length > 0 || check.tooClose !== null;
  const changed = layoutDiffers(layout, loaded.data.layout);
  const ha = (v: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(v);
  const set = (key: keyof PlotLayoutSettings, value: string) => {
    setResult(null);
    setLayout({ ...layout, [key]: value });
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || !canEdit) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await savePlotLayout(projectId, layout);
      setResult(saved.changed ? "saved" : "unchanged");
      loaded.setData({ ...loaded.data!, layout: saved.layout });
      setLayout(saved.layout);
      if (saved.changed) onSaved?.();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const numberField = (key: NumberKey) => {
    const field = NUMBER_FIELDS.find((f) => f.key === key)!;
    if (!isShown(key, layout)) return null;
    const label = key === "distance_between_sample_points" ? t(`layout.distance.${distanceMeaning(layout.sample_shape)}`) : t(FIELD_LABEL[key]);
    const bad = check.invalid.includes(key);
    return (
      <TextField key={key} size="small" label={label} value={layout[key]} onChange={(e) => set(key, e.target.value)} disabled={!canEdit}
        error={bad} helperText={t(bad ? "layout.rangeError" : "layout.range", { min: String(field.min), max: String(field.max) })}
        slotProps={{ htmlInput: { inputMode: "numeric", "data-field": key } }} sx={{ width: { xs: 1, sm: 300 } }} />
    );
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="plot-layout">
      <Box component="form" onSubmit={save} noValidate>
        <Stack spacing={2}>
          <Typography variant="h2" id="plot-layout">{t("layout.title")}</Typography>
          <Explain color="text.primary" text={t("layout.intro.short")} more={t("layout.intro")} />
          {polygons && <Alert severity="info">{t("layout.polygons")}</Alert>}
          {!canEdit && <Typography variant="body2" color="text.secondary">{t("layout.readOnly")}</Typography>}
          <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: { md: "flex-start" } }}>
            <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
              <TextField select size="small" label={t("layout.shape")} value={layout.sample_shape} onChange={(e) => set("sample_shape", e.target.value)}
                disabled={!canEdit} sx={{ width: { xs: 1, sm: 420 } }}>
                {SAMPLE_SHAPES.map((s) => <MenuItem key={s} value={s}>{t(`layout.shape.${s}`)}</MenuItem>)}
              </TextField>
              {isShown("number_of_sampling_points_in_plot", layout) && (
                <TextField select size="small" label={t("layout.points")} value={layout.number_of_sampling_points_in_plot}
                  onChange={(e) => set("number_of_sampling_points_in_plot", e.target.value)} disabled={!canEdit} sx={{ width: { xs: 1, sm: 300 } }}>
                  {POINT_COUNTS.map((n) => (
                    <MenuItem key={n} value={String(n)}>
                      {n === 0 ? t("layout.points.none") : n === 1 ? t("layout.points.central") : t("layout.points.grid", { side: String(Math.sqrt(n)), count: String(n) })}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {numberField("distance_between_sample_points")}
              {numberField("distance_to_plot_boundaries")}
              {numberField("inner_point_side")}
              {numberField("large_central_plot_side")}
              {numberField("distance_between_plots")}
              {isShown("buffer_shape", layout) && (
                <TextField select size="small" label={t("layout.buffer")} value={layout.buffer_shape} onChange={(e) => set("buffer_shape", e.target.value)}
                  disabled={!canEdit} helperText={t("layout.bufferHelp")} sx={{ width: { xs: 1, sm: 300 } }}>
                  {BUFFER_SHAPES.map((s) => <MenuItem key={s} value={s}>{t(`layout.buffer.${s}`)}</MenuItem>)}
                </TextField>
              )}
              {numberField("distance_to_buffers")}
            </Stack>
            <Stack spacing={1} sx={{ width: { xs: 1, md: 320 }, flexShrink: 0 }}>
              <Typography variant="subtitle2" component="h3">{t("layout.preview")}</Typography>
              <LayoutPreview layout={layout} />
              {check.plotHa !== null && <Typography variant="body2">{t("layout.plotArea", { ha: ha(check.plotHa) })}</Typography>}
              {check.referenceHa !== null && <Typography variant="body2">{t("layout.referenceArea", { ha: ha(check.referenceHa) })}</Typography>}
            </Stack>
          </Stack>
          {check.tooClose !== null && <Alert severity="error">{t("layout.referenceTooClose", { min: String(check.tooClose) })}</Alert>}
          {check.small !== null && (
            <Alert severity="info" action={canEdit ? <Button color="inherit" size="small" onClick={() => set("distance_to_buffers", String(check.small))}>{t("layout.useRecommended", { distance: String(check.small) })}</Button> : undefined}>
              {t("layout.referenceSmall", { distance: String(check.small) })}
            </Alert>
          )}
          <ErrorAlert error={error} />
          {result === "saved" && (
            <Alert severity="success" role="status">
              {t("layout.saved")}{" "}
              <Link {...linkProps(pathFor({ name: "project", projectId, tab: "people" }))}>{t("layout.openPeople")}</Link>
            </Alert>
          )}
          {result === "unchanged" && <Alert severity="info" role="status">{t("layout.unchanged")}</Alert>}
          {canEdit && (
            <Box>
              <Button type="submit" variant="contained" disabled={saving || blocked || !changed}>{t("layout.save")}</Button>
            </Box>
          )}
        </Stack>
      </Box>
    </Paper>
  );
}
