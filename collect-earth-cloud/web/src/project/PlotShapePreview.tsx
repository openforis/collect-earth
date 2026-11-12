import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useT } from "../i18n";
import { hexagonPoints, plotDrawing, scaleBarLength, type Outline } from "../shared/plotPreview";

const PLOT_COLOR = "#fbc02d";
const REFERENCE_COLOR = "#8d9aa5";

/**
 * The plot drawn to scale from the layout being edited, as Collect Earth's Settings page draws it (its
 * components/settings/PlotPreview.tsx, same geometry from shared/plotPreview.ts): outline, sampling points, central
 * plot or cluster plots, reference area, and a scale bar.
 */
export function PlotShapePreview({ values }: { values: Record<string, string> }) {
  const t = useT();
  const drawing = plotDrawing(values);
  if (!drawing) return <Typography variant="body2" color="text.secondary">{t("file.layout.preview.none")}</Typography>;
  const e = drawing.extent || 1;
  const bar = scaleBarLength(e);
  const stroke = e / 150;
  const shape = (outline: Outline, props: Record<string, unknown>) => {
    if (outline.kind === "square") return <rect x={-outline.half} y={-outline.half} width={2 * outline.half} height={2 * outline.half} {...props} />;
    if (outline.kind === "circle") return <circle cx={0} cy={0} r={outline.r} {...props} />;
    return <polygon points={hexagonPoints(0, 0, outline.r)} {...props} />;
  };
  return (
    <Stack spacing={1} data-testid="plot-preview">
      <Typography variant="subtitle2">{t("file.layout.preview.title")}</Typography>
      <Box component="svg" viewBox={`${-e} ${-e} ${2 * e} ${2 * e}`} sx={{ width: "100%", maxWidth: 320, aspectRatio: "1", display: "block" }}
        role="img" aria-label={t("file.layout.preview.title")}>
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
        <g fill="currentColor" stroke="currentColor">
          <line x1={-e * 0.92} y1={e * 0.9} x2={-e * 0.92 + bar} y2={e * 0.9} strokeWidth={stroke * 1.5} />
          <line x1={-e * 0.92} y1={e * 0.87} x2={-e * 0.92} y2={e * 0.93} strokeWidth={stroke} />
          <line x1={-e * 0.92 + bar} y1={e * 0.87} x2={-e * 0.92 + bar} y2={e * 0.93} strokeWidth={stroke} />
          <text x={-e * 0.92 + bar / 2} y={e * 0.84} fontSize={e * 0.08} textAnchor="middle" stroke="none">{bar} m</text>
        </g>
      </Box>
      {drawing.randomPoints > 0 && (
        <Typography variant="caption" color="text.secondary">{t("file.layout.preview.randomPoints", { count: drawing.randomPoints })}</Typography>
      )}
    </Stack>
  );
}
