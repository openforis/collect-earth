import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useApp } from "../appContext";
import { useT } from "../i18n";
import { hexagonPoints, plotDrawing, scaleBarLength, type Outline } from "../shared/plotPreview";
import { plotFigures } from "./plotLayoutView";

const PLOT_COLOR = "#fbc02d";
const REFERENCE_COLOR = "#8d9aa5";

/**
 * The plot drawn to scale from the layout being edited, as Collect Earth's Settings page draws it (its
 * components/settings/PlotPreview.tsx, same geometry from shared/plotPreview.ts): outline, sampling points, central
 * plot or cluster plots, reference area, and a scale bar under it (clear of the plot, so it reads against nothing
 * else); then the plot's size and area and the reference area's, as Collect Earth's settings compute them.
 */
export function PlotShapePreview({ values }: { values: Record<string, string> }) {
  const t = useT();
  const { language } = useApp();
  const drawing = plotDrawing(values);
  if (!drawing) return <Typography variant="body2" color="text.secondary">{t("file.layout.preview.none")}</Typography>;
  const e = drawing.extent || 1;
  const bar = scaleBarLength(e);
  const stroke = e / 150;
  // The room under the drawing for the scale bar
  const below = e * 0.22;
  const figures = plotFigures(values);
  const metres = (n: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(n);
  const area = (m2: number) =>
    `${new Intl.NumberFormat(language, { maximumFractionDigits: m2 < 1000 ? 3 : 2 }).format(m2 / 10000)} ha (${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(m2)} m²)`;
  const shape = (outline: Outline, props: Record<string, unknown>) => {
    if (outline.kind === "square") return <rect x={-outline.half} y={-outline.half} width={2 * outline.half} height={2 * outline.half} {...props} />;
    if (outline.kind === "circle") return <circle cx={0} cy={0} r={outline.r} {...props} />;
    return <polygon points={hexagonPoints(0, 0, outline.r)} {...props} />;
  };
  return (
    <Stack spacing={1} data-testid="plot-preview">
      <Typography variant="subtitle2">{t("file.layout.preview.title")}</Typography>
      <Box component="svg" viewBox={`${-e} ${-e} ${2 * e} ${2 * e + below}`} sx={{ width: "100%", maxWidth: 320, aspectRatio: `${2 * e} / ${2 * e + below}`, display: "block" }}
        role="img" aria-label={t("file.layout.preview.scale", { length: bar })}>
        {/* North up: the drawing's y grows northwards, SVG's downwards */}
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
        {/* The scale bar under the drawing, from its left edge, in the page's text colour */}
        <g fill="currentColor" stroke="currentColor">
          <line x1={-e} y1={e + below * 0.7} x2={-e + bar} y2={e + below * 0.7} strokeWidth={stroke * 1.5} />
          <line x1={-e} y1={e + below * 0.55} x2={-e} y2={e + below * 0.85} strokeWidth={stroke} />
          <line x1={-e + bar} y1={e + below * 0.55} x2={-e + bar} y2={e + below * 0.85} strokeWidth={stroke} />
          <text x={-e + bar + e * 0.04} y={e + below * 0.7} dominantBaseline="middle" fontSize={e * 0.08} stroke="none">{metres(bar)} m</text>
        </g>
      </Box>
      {figures && (
        <Typography variant="body2" data-testid="plot-figures">
          {figures.side !== null
            ? t("file.layout.preview.square", { side: metres(figures.side), area: area(figures.area) })
            : t("file.layout.preview.round", { radius: metres(figures.radius ?? 0), area: area(figures.area) })}
          {figures.referenceArea !== null && <><br />{t("file.layout.preview.reference", { area: area(figures.referenceArea) })}</>}
        </Typography>
      )}
      {drawing.randomPoints > 0 && (
        <Typography variant="caption" color="text.secondary">{t("file.layout.preview.randomPoints", { count: drawing.randomPoints })}</Typography>
      )}
    </Stack>
  );
}
