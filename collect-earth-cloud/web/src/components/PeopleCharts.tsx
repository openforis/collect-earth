import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useApp } from "../appContext";
import { formatDate } from "../format";
import { useT } from "../i18n";
import { calendarWeeks, heatLevel, type CalendarCell } from "../peopleView";

// The People pages' small charts: columns (the week, the hours of the day, the speed
// estimate) and the activity calendar. Colours come from the MUI theme (one hue,
// lighter to darker for more); each chart has a table view, and every mark says its
// value on hover (and in the table).

/** The width of an element, kept up to date (charts are drawn at their real size). */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** "Figures as of 14:05: newer ones are being worked out" when a page's figures are older than the records. */
export function AsOf({ asOf }: { asOf: number | null }) {
  const t = useT();
  const { language } = useApp();
  if (asOf === null) return null;
  return (
    <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>
      {t("people.asOf", { time: formatDate(asOf, language) })}
    </Typography>
  );
}

/** Arrow keys, Home and End move along `count` items (null: not a key that moves). */
export function stepKey(e: KeyboardEvent, at: number, count: number): number | null {
  if (count === 0) return null;
  if (e.key === "ArrowLeft" || e.key === "ArrowDown") return Math.max(0, at - 1);
  if (e.key === "ArrowRight" || e.key === "ArrowUp") return Math.min(count - 1, at + 1);
  if (e.key === "Home") return 0;
  if (e.key === "End") return count - 1;
  return null;
}

/** A chart with a Chart / Table switch above it. */
export function ChartOrTable({ label, chart, table }: { label: string; chart: ReactNode; table: ReactNode }) {
  const t = useT();
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Box>
      <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label={label} sx={{ mb: 1 }}>
        <ToggleButton value="chart">{t("quality.showChart")}</ToggleButton>
        <ToggleButton value="table">{t("quality.showTable")}</ToggleButton>
      </ToggleButtonGroup>
      {view === "chart" ? chart : table}
    </Box>
  );
}

export interface Column {
  /** Under the column (shown when there is room, or when `always`). */
  label: string;
  value: number;
  /** What hovering says, e.g. "Tue 27 Oct: 12 plots". */
  title: string;
  /** Show this column's label even when labels are thinned out. */
  always?: boolean;
  /** Drawn in the warning colour (e.g. "very fast"). */
  warn?: boolean;
}

/** Columns from one baseline, at most 24 px thick with a rounded top, the value on each cap that has room. */
export function ColumnChart({ columns, height = 160, ariaLabel }: { columns: readonly Column[]; height?: number; ariaLabel: string }) {
  const theme = useTheme();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const readout = useId();
  const box = { width: Math.max(width, 120), height, top: 18, bottom: 22, side: 4 };
  const plotWidth = box.width - 2 * box.side;
  const band = columns.length > 0 ? plotWidth / columns.length : plotWidth;
  const thick = Math.max(2, Math.min(24, band - 4));
  const max = Math.max(1, ...columns.map((c) => c.value));
  const base = box.height - box.bottom;
  const scale = (v: number) => ((box.height - box.top - box.bottom) * v) / max;
  // Labels under at most one column in `every` (always the ones marked always).
  const every = Math.max(1, Math.ceil(28 / band));
  const ink = theme.palette.text.secondary;
  const mark = theme.palette.primary.main;
  const warn = theme.palette.warning.main;
  return (
    <Box ref={ref} sx={{ width: "100%" }}>
      <Typography id={readout} variant="body2" sx={{ minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }} aria-live={focused ? "polite" : "off"}>
        {active !== null ? columns[active]?.title : ""}
      </Typography>
      {width > 0 && (
        <Box
          role="group"
          tabIndex={0}
          aria-label={ariaLabel}
          aria-describedby={readout}
          onFocus={() => {
            setFocused(true);
            setActive((a) => a ?? 0);
          }}
          onBlur={() => {
            setFocused(false);
            setActive(null);
          }}
          onKeyDown={(e) => {
            const next = stepKey(e, active ?? 0, columns.length);
            if (next === null) return;
            e.preventDefault();
            setActive(next);
          }}
          sx={{ borderRadius: 1, outline: "none", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
        >
        <svg width={box.width} height={box.height} aria-hidden style={{ display: "block" }} onMouseLeave={() => setActive(null)}>
          <line x1={box.side} x2={box.width - box.side} y1={base} y2={base} stroke={theme.palette.divider} strokeWidth={1} />
          {columns.map((c, i) => {
            const cx = box.side + band * i + band / 2;
            const h = scale(c.value);
            const r = Math.min(4, thick / 2, h);
            const x = cx - thick / 2;
            const y = base - h;
            // A rounded top, square at the baseline.
            const path = h <= 0 ? "" : `M${x},${base} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + thick - r},${y} Q${x + thick},${y} ${x + thick},${y + r} L${x + thick},${base} Z`;
            return (
              <g key={i}>
                {path && <path d={path} fill={c.warn ? warn : mark} opacity={active === null || active === i ? 1 : 0.55} />}
                {c.value > 0 && band >= 18 && (
                  <text x={cx} y={y - 4} textAnchor="middle" fontSize={11} fill={ink}>
                    {c.value}
                  </text>
                )}
                {(c.always || i % every === 0) && (
                  <text x={cx} y={box.height - 6} textAnchor="middle" fontSize={11} fill={ink}>
                    {c.label}
                  </text>
                )}
                <rect x={box.side + band * i} y={0} width={band} height={box.height} fill="transparent" onMouseEnter={() => setActive(i)}>
                  <title>{c.title}</title>
                </rect>
              </g>
            );
          })}
        </svg>
        </Box>
      )}
    </Box>
  );
}

/** A plain table of a chart's values: one row per column. */
export function ValuesTable({ head, rows }: { head: [string, string]; rows: readonly { label: string; value: string }[] }) {
  return (
    <TableContainer sx={{ maxHeight: 360 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>{head[0]}</TableCell>
            <TableCell align="right">{head[1]}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell component="th" scope="row">
                {r.label}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {r.value}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

const CELL = 18;
const GAP = 3;
/**
 * The shades of the days, over the paper: the lightest is still 3:1 against an empty day
 * (#f5f5f5) with the theme's green; the darkest is the theme's dark green.
 */
const SHADES = [0.7, 0.82, 1] as const;

/**
 * The activity calendar: a square per day (weeks as columns, Monday on top), darker for
 * more plots and checks submitted that day. It scrolls sideways inside its box when the
 * span is longer than the screen; the newest week is shown first.
 */
export function CalendarHeatMap({
  days,
  today,
  language,
  cellTitle,
  ariaLabel,
}: {
  days: readonly { date: string; plots: number; checks: number }[];
  today: string;
  language: string;
  cellTitle: (cell: CalendarCell) => string;
  ariaLabel: string;
}) {
  const t = useT();
  const theme = useTheme();
  const cal = calendarWeeks(days, today);
  const [active, setActive] = useState<CalendarCell | null>(null);
  const [focused, setFocused] = useState(false);
  const readout = useId();
  const cells = cal.weeks.flat().filter((c): c is CalendarCell => c !== null);
  const scroller = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cal.weeks.length]);
  const fill = (level: number) =>
    level === 0 ? theme.palette.action.hover : level === 4 ? theme.palette.primary.dark : alpha(theme.palette.primary.main, SHADES[level - 1]);
  const left = 28;
  const top = 16;
  const width = left + cal.weeks.length * (CELL + GAP);
  const height = top + 7 * (CELL + GAP);
  const ink = theme.palette.text.secondary;
  // The month's short name above the first week that starts in it.
  const months: { x: number; text: string }[] = [];
  cal.weeks.forEach((week, i) => {
    const first = week.find((c) => c !== null);
    if (first && (i === 0 || first.date.slice(8) <= "07")) {
      const text = new Intl.DateTimeFormat(language, { month: "short", timeZone: "UTC" }).format(Date.parse(`${first.date}T12:00:00Z`));
      if (months.length === 0 || months[months.length - 1].text !== text) months.push({ x: left + i * (CELL + GAP), text });
    }
  });
  // Wide enough for the last month's name: a span of a week or two would cut it ("No").
  const lastMonth = months[months.length - 1];
  const svgWidth = lastMonth ? Math.max(width, lastMonth.x + 8 * lastMonth.text.length + 4) : width;
  const weekdays = [0, 2, 4].map((i) => ({ i, text: new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }).format(Date.parse(`2026-11-0${2 + i}T12:00:00Z`)) }));
  return (
    <Stack spacing={1}>
      <Typography id={readout} variant="body2" sx={{ minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }} aria-live={focused ? "polite" : "off"}>
        {active ? cellTitle(active) : ""}
      </Typography>
      {/* Focusable, so the keyboard can scroll it and step through the days (arrows, Home, End). */}
      <Box
        ref={scroller}
        role="group"
        tabIndex={0}
        aria-label={`${ariaLabel}. ${t("person.calendarKeys")}`}
        aria-describedby={readout}
        onFocus={() => {
          setFocused(true);
          setActive((a) => a ?? cells[cells.length - 1] ?? null);
        }}
        onBlur={() => {
          setFocused(false);
          setActive(null);
        }}
        onKeyDown={(e) => {
          const at = active ? cells.findIndex((c) => c.date === active.date) : cells.length - 1;
          const next = stepKey(e, at, cells.length);
          if (next === null) return;
          e.preventDefault();
          setActive(cells[next]);
        }}
        sx={{ overflowX: "auto", maxWidth: "100%", borderRadius: 1, outline: "none", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
      >
        <svg width={svgWidth} height={height} aria-hidden style={{ display: "block" }} onMouseLeave={() => setActive(null)}>
          {months.map((m) => (
            <text key={`${m.x}`} x={m.x} y={11} fontSize={12} fill={ink}>
              {m.text}
            </text>
          ))}
          {weekdays.map((w) => (
            <text key={w.i} x={0} y={top + w.i * (CELL + GAP) + CELL - 2} fontSize={10} fill={ink}>
              {w.text}
            </text>
          ))}
          {cal.weeks.map((week, i) =>
            week.map((cell, j) =>
              cell === null ? null : (
                <rect
                  key={cell.date}
                  x={left + i * (CELL + GAP)}
                  y={top + j * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  rx={3}
                  fill={fill(heatLevel(cell.count, cal.max))}
                  stroke={cell.date === active?.date || cell.date === today ? theme.palette.text.primary : "none"}
                  strokeWidth={cell.date === active?.date ? 2 : cell.date === today ? 1 : 0}
                  onMouseEnter={() => setActive(cell)}
                >
                  <title>{cellTitle(cell)}</title>
                </rect>
              ),
            ),
          )}
        </svg>
      </Box>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }} aria-hidden>
        <Typography variant="body2" color="text.secondary">
          {t("person.less")}
        </Typography>
        {[0, 1, 2, 3, 4].map((level) => (
          <Box key={level} sx={{ width: CELL, height: CELL, borderRadius: "3px", bgcolor: fill(level) }} />
        ))}
        <Typography variant="body2" color="text.secondary">
          {t("person.more")}
        </Typography>
      </Stack>
    </Stack>
  );
}
