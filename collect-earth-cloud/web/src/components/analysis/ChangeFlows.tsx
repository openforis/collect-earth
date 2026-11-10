import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowForward from "@mui/icons-material/ArrowForward";
import { useEffect, useId, useMemo, useState } from "react";
import type { AnalysisModelData } from "../../api";
import { changeChoiceSql, changeFields, defaultChange, flowsSql, pickChange, sankeyLayout, type Flow } from "../../analysisInsights";
import type { Filter } from "../../analysisQuestion";
import { valueColour } from "../../analysisColors";
import type { Cube } from "../../analysisView";
import { useApp } from "../../appContext";
import { formatNumber } from "../../format";
import { useT } from "../../i18n";
import { ErrorAlert } from "../ErrorAlert";

const W = 1000;
const H = 520;
const BAR = 14;
/** Room for the labels on each side of the bars. */
const SIDE = 210;
const GAP = 10;

/**
 * The land use change as a Sankey: the land use before on the left, after on the right, a band for each pair as wide
 * as its plots (or area). A click on a band or a bar lists its plots, with the view's filters.
 */
export function ChangeFlows({
  model,
  cube,
  filters,
  measure,
  query,
  onPick,
}: {
  model: AnalysisModelData;
  cube: Cube;
  filters: Filter[];
  /** The area's column, to add up the area; null counts the plots. */
  measure: string | null;
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  onPick: (filters: Filter[]) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const id = useId().replace(/:/g, "");
  const fields = useMemo(() => changeFields(model, cube), [model, cube]);
  const initial = useMemo(() => defaultChange(model, cube), [model, cube]);
  const none = t("analysis.noAnswer");
  // "before" is chosen once the data says which field shows the change best (pickChange), until then nothing is drawn
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(initial?.to ?? "");
  const [flows, setFlows] = useState<Flow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [hover, setHover] = useState<string | null>(null);
  // the filters change identity at every render of the page: the query follows their content
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    if (!to) return;
    let live = true;
    const candidates = fields.map((f) => f.name).filter((n) => n !== to);
    query(changeChoiceSql(cube, candidates, to, none, filters)).then(
      (rows) => live && setFrom(pickChange(candidates, rows[0]) ?? initial?.from ?? candidates[0] ?? ""),
      () => live && setFrom(initial?.from ?? candidates[0] ?? ""),
    );
    return () => {
      live = false;
    };
    // chosen once per table: later the person picks
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube]);

  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    setFlows(null);
    setError(null);
    query(flowsSql(cube, from, to, measure, filters, none)).then(
      (rows) => live && setFlows(rows.map((r) => ({ source: String(r.source), target: String(r.target), value: Number(r.value) }))),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cube, from, to, measure, filtersKey, query]);

  const layout = useMemo(() => sankeyLayout(flows ?? [], H, GAP), [flows]);
  const byName = new Map(cube.columns.map((c) => [c.name, c]));
  const colour = (field: string, value: string) => valueColour(byName.get(field), value, model);
  const total = (flows ?? []).reduce((s, f) => s + f.value, 0);
  const changed = (flows ?? []).filter((f) => f.source !== f.target).reduce((s, f) => s + f.value, 0);
  const amount = (v: number) => formatNumber(Math.round(v), language);
  const pct = (v: number) => (total ? `${formatNumber(Math.round((1000 * v) / total) / 10, language)}%` : "");
  const unit = t(measure ? "analysis.flows.unitArea" : "analysis.flows.unitPlots");
  const xL = SIDE;
  const xR = W - SIDE - BAR;
  const mid = (xL + BAR + xR) / 2;
  const picker = (label: string, value: string, set: (v: string) => void) => (
    <TextField select size="small" label={label} value={value} onChange={(e) => set(e.target.value)} sx={{ minWidth: 240, flex: "1 1 240px", maxWidth: 380 }}>
      {fields.map((f) => (
        <MenuItem key={f.name} value={f.name}>
          {f.name}
        </MenuItem>
      ))}
    </TextField>
  );

  if (fields.length < 2) return <Alert severity="info">{t("analysis.flows.noFields")}</Alert>;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", p: 2, overflow: "auto" }}>
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        {picker(t("analysis.flows.from"), from, setFrom)}
        <ArrowForward color="action" />
        {picker(t("analysis.flows.to"), to, setTo)}
        {flows && total > 0 && (
          <Box sx={{ ml: { md: "auto" }, display: "flex", gap: 3 }}>
            <Stat label={t("analysis.flows.total", { unit })} value={amount(total)} />
            <Stat label={t("analysis.flows.changed")} value={pct(changed)} accent />
          </Box>
        )}
      </Box>
      <ErrorAlert error={error} />
      {!flows && !error && <LinearProgress />}
      {flows && total === 0 && <Typography color="text.secondary">{t("analysis.flows.none")}</Typography>}
      {flows && total > 0 && (
        <Box component="svg" viewBox={`-4 -4 ${W + 8} ${H + 8}`} sx={{ width: "100%", flex: "1 1 auto", minHeight: 360, maxHeight: "100%", font: "13px Roboto, system-ui, sans-serif" }} role="img" aria-label={t("analysis.flows.label", { from, to })}>
          <defs>
            {layout.links.map((l, i) => (
              <linearGradient key={i} id={`${id}-g${i}`} gradientUnits="userSpaceOnUse" x1={xL + BAR} x2={xR} y1={0} y2={0}>
                <stop offset="0%" stopColor={colour(from, l.source)} />
                <stop offset="100%" stopColor={colour(to, l.target)} />
              </linearGradient>
            ))}
          </defs>
          {layout.links.map((l, i) => {
            const key = `${l.source}\u0000${l.target}`;
            const x0 = xL + BAR;
            const d = `M${x0},${l.y0} C${mid},${l.y0} ${mid},${l.y1} ${xR},${l.y1} L${xR},${l.y1 + l.w} C${mid},${l.y1 + l.w} ${mid},${l.y0 + l.w} ${x0},${l.y0 + l.w} Z`;
            const lit = hover === null ? 0.42 : hover === key || hover === `L${l.source}` || hover === `R${l.target}` ? 0.8 : 0.12;
            return (
              <path
                key={i}
                d={d}
                fill={`url(#${id}-g${i})`}
                fillOpacity={lit}
                style={{ cursor: "pointer", transition: "fill-opacity 160ms" }}
                onMouseEnter={() => setHover(key)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick([...filters.filter(([c]) => c !== from && c !== to), [from, "==", l.source], [to, "==", l.target]])}
              >
                <title>{t("analysis.flows.band", { from: l.source, to: l.target, value: amount(l.value), unit, pct: pct(l.value) })}</title>
              </path>
            );
          })}
          {layout.nodes.map((n) => {
            const left = n.side === "left";
            const field = left ? from : to;
            const key = `${left ? "L" : "R"}${n.name}`;
            return (
              <g
                key={key}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(key)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onPick([...filters.filter(([c]) => c !== field), [field, "==", n.name]])}
              >
                <rect x={left ? xL : xR} y={n.y} width={BAR} height={Math.max(1, n.h)} rx={3} fill={colour(field, n.name)} />
                {n.h >= 11 && (
                  <text x={left ? xL - 8 : xR + BAR + 8} y={n.y + n.h / 2} dominantBaseline="middle" textAnchor={left ? "end" : "start"} fill="#1f2a30">
                    <tspan fontWeight={600}>{n.name.length > 26 ? `${n.name.slice(0, 25)}…` : n.name}</tspan>
                    <tspan fill="#6b777e" dx={6}>
                      {pct(n.value)}
                    </tspan>
                  </text>
                )}
                <title>{`${n.name}: ${amount(n.value)} ${unit} (${pct(n.value)})`}</title>
              </g>
            );
          })}
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        {t("analysis.flows.help")}
      </Typography>
    </Box>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.3, color: accent ? "primary.main" : "text.primary" }}>
        {value}
      </Typography>
    </Box>
  );
}
