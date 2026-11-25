import { useCallback, useMemo } from "react";
import type { Data, Layout, PlotMouseEvent } from "plotly.js";
import Plot from "../Plot";
import ChartCard from "../ChartCard";
import { CONFIG, baseLayout, iso } from "./chartStyle";
import { useApi } from "../../hooks/useApi";
import { postApi } from "../../lib/api";
import { usePlot } from "../../state/PlotContext";
import { useFold, type CardProps } from "../../lib/folds";
import { downloadText } from "../../lib/csv";
import { chartRequest, withYears } from "../../lib/config";
import { alertsByMonth, forestLossCsv, inPeriod, type ForestLoss } from "../../lib/forestLoss";
import { t, type Key } from "../../lib/i18n";

const DAY = 86400000;
const STYLE = { width: "100%", height: 266 };
/** Hansen behind in neutral grey; the alert systems in Okabe-Ito vermilion and blue, told apart by colour-blind readers too. */
const HANSEN_COLOR = "#8a857b";
const SOURCES = [
  { source: "RADD", color: "#d55e00", light: "#f0b78f", offset: 8, confirmed: "loss.raddConfirmed", unconfirmed: "loss.raddUnconfirmed" },
  { source: "GLAD", color: "#0072b2", light: "#8ec1e3", offset: 22, confirmed: "loss.gladConfirmed", unconfirmed: "loss.gladUnconfirmed" },
] as const;

/**
 * Hansen's yearly loss as wide grey bars, and each alert system's area per month as narrow bars side by side in front:
 * confirmed solid, unconfirmed lighter and hatched on top. Alerts are many and small (a RADD pixel is 0.01 ha, a few dates a month),
 * so monthly sums read as a rate comparable across systems where markers per date would pile up. The data is every year
 * (the server ignores dates); the card shows the request's period.
 */
export default function ForestLossCard(props: CardProps) {
  const { params } = props;
  const { plot, start, end, plotId, canCompareAround, compareAround } = usePlot();
  const fold = useFold("forest-loss", props);
  const { path, body } = chartRequest({ type: "forest-loss", params }, { plot, start, end });
  const state = useApi<ForestLoss>((s) => postApi(path, body, s), [plot], { enabled: fold.live });
  const shown = useMemo(() => state.data && inPeriod(state.data, body.start, body.end), [state.data, body.start, body.end]);
  const compare = canCompareAround("landsat");

  const data = useMemo<Data[]>(() => {
    if (!shown) return [];
    const traces: Data[] = [
      {
        x: shown.hansen.map((h) => iso(Date.UTC(h.year, 6, 1))),
        y: shown.hansen.map((h) => h.ha),
        width: shown.hansen.map(() => 340 * DAY),
        type: "bar",
        name: t("loss.hansen"),
        marker: { color: HANSEN_COLOR, opacity: 0.45 },
        hovertemplate: "%{x|%Y}: %{y:.2f} ha<extra>Hansen</extra>",
      },
    ];
    for (const { source, color, light, offset, confirmed, unconfirmed } of SOURCES) {
      const months = alertsByMonth(shown.alerts, source);
      if (!months.length) continue;
      const x = months.map((m) => iso(m.month + offset * DAY));
      const width = months.map(() => 13 * DAY);
      // Unconfirmed: a lighter tint and hatched, on top of the confirmed bar, so it does not rely on colour alone.
      const bar = (y: number[], name: string, marker: object, base?: number[]): Data => ({
        x, y, base, width, type: "bar", name, marker, hovertemplate: `%{x|%b %Y}: %{y:.2f} ha<extra>${name}</extra>`,
      });
      if (months.some((m) => m.confirmed)) traces.push(bar(months.map((m) => m.confirmed), t(confirmed), { color }));
      if (months.some((m) => m.unconfirmed))
        traces.push(bar(months.map((m) => m.unconfirmed), t(unconfirmed), { color: light, pattern: { shape: "/", fgcolor: color, size: 5 } }, months.map((m) => m.confirmed)));
    }
    return traces;
  }, [shown]);

  const firstAlert = shown?.alerts[0]?.date;
  const yMax = shown ? Math.max(1, ...shown.hansen.map((h) => h.ha), ...SOURCES.flatMap(({ source }) => alertsByMonth(shown.alerts, source).map((m) => m.confirmed + m.unconfirmed))) : 1;
  const layout = useMemo<Partial<Layout>>(() => {
    // The axis ends with the period (the alerts run to this week), not with the last bar.
    const l = baseLayout(STYLE.height, [0, yMax * 1.1], true, Date.parse(body.end));
    l.barmode = "overlay";
    // To the period's end, so years without loss show as such. Months on a 25-year axis are a pixel or two wide: with
    // alerts it opens on their years (from two years before the first); the range buttons' All shows Hansen's whole record.
    const from = firstAlert === undefined ? Math.max(Date.UTC(2001, 0, 1), Date.parse(body.start)) : Date.UTC(new Date(firstAlert).getUTCFullYear() - 2, 0, 1);
    l.xaxis!.range = [iso(from), iso(Date.parse(body.end) + 31 * DAY)];
    return l;
  }, [yMax, body.start, body.end, firstAlert]);

  const onClick = useCallback(
    (e: Readonly<PlotMouseEvent>) => {
      const hit = e.points[0];
      if (compare && hit && hit.curveNumber === 0) compareAround("landsat", new Date(hit.x as string).getUTCFullYear());
    },
    [compare, compareAround],
  );

  const facts = (d: ForestLoss) => {
    const loss = d.hansen.reduce((s, h) => s + h.ha, 0);
    const lines: [Key, Record<string, string>?][] = [];
    if (d.treeCover2000 !== null) lines.push(["loss.cover", { cover: d.treeCover2000.toFixed(0) }]);
    lines.push(["loss.total", { ha: loss.toFixed(1), share: d.plotHa ? ((100 * loss) / d.plotHa).toFixed(0) : "0" }]);
    if (!d.coverage.radd) lines.push(["loss.noRadd"]);
    if (!d.coverage.glad) lines.push(["loss.noGlad"]);
    return lines.map(([k, p]) => t(k, p)).join(" ");
  };

  return (
    <ChartCard
      title={withYears(t("loss.title"), params)}
      tooltip={t("loss.tooltip") + (compare ? `. ${t("loss.clickTitle")}` : "")}
      state={state}
      open={fold.open}
      onToggle={fold.toggle}
      onDownload={() => downloadText(`${plotId || "plot"}-forest-loss.csv`, forestLossCsv(shown!))}
    >
      {() => (
        <>
          <div className="chart-results">{facts(shown!)}</div>
          <Plot data={data} layout={layout} config={CONFIG} style={STYLE} onClick={onClick} />
        </>
      )}
    </ChartCard>
  );
}
