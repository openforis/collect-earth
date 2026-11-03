import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { hexagonPoints, plotDrawing, scaleBarLength, type Outline } from "../../plotPreview";
import { formatText, type PlotFigures, type Values } from "../../settings";
import { serverText, type Texts } from "../../serverTexts";

/** The plot colour of the map (types.ts ACTIVE_COLOR is the selected plot's; the plots themselves are drawn in this yellow) */
const PLOT_COLOR = "#fbc02d";
const REFERENCE_COLOR = "#8d9aa5";

const HECTARES = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/**
 * The plot drawn to scale from the plot settings, as the KML generators will draw it: its outline, its sample
 * points, its central plot or the other plots of its cluster, and the reference area around it; with a scale bar,
 * and under it the areas the server computed with the last validation.
 */
export function PlotPreview({ values, plot, texts }: { values: Values; plot: PlotFigures | null; texts: Texts | null }) {
  const s = (key: string) => serverText(texts, key);
  const drawing = plotDrawing(values);
  if (!drawing) {
    return <Typography variant="body2" color="text.secondary">{s("SettingsPage.preview.noDrawing")}</Typography>;
  }
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
      <Typography variant="subtitle2">{s("SettingsPage.preview.title")}</Typography>
      <Box component="svg" viewBox={`${-e} ${-e} ${2 * e} ${2 * e}`} sx={{ width: "100%", maxWidth: 360, aspectRatio: "1", display: "block" }}
        role="img" aria-label={s("SettingsPage.preview.title")}>
        {/* North up: the generators' y grows northwards, SVG's downwards */}
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
        {/* The scale bar, bottom left, in the page's text colour */}
        <g fill="currentColor" stroke="currentColor">
          <line x1={-e * 0.92} y1={e * 0.9} x2={-e * 0.92 + bar} y2={e * 0.9} strokeWidth={stroke * 1.5} />
          <line x1={-e * 0.92} y1={e * 0.87} x2={-e * 0.92} y2={e * 0.93} strokeWidth={stroke} />
          <line x1={-e * 0.92 + bar} y1={e * 0.87} x2={-e * 0.92 + bar} y2={e * 0.93} strokeWidth={stroke} />
          <text x={-e * 0.92 + bar / 2} y={e * 0.84} fontSize={e * 0.08} textAnchor="middle" stroke="none">{bar} m</text>
        </g>
      </Box>
      {plot && (
        <Typography variant="body2">
          {s("OptionWizard.131")} {HECTARES.format(plot.plotAreaHa)}
          {plot.referenceAreaHa != null && <>{" \u00b7 "}{s("OptionWizard.1026")} {HECTARES.format(plot.referenceAreaHa)}</>}
        </Typography>
      )}
      {drawing.randomPoints > 0 && (
        <Typography variant="caption" color="text.secondary">{formatText(s("SettingsPage.preview.randomPoints"), drawing.randomPoints)}</Typography>
      )}
    </Stack>
  );
}
