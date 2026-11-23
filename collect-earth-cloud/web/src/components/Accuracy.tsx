import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineOutlined from "@mui/icons-material/CheckCircleOutlineOutlined";
import ErrorOutlineOutlined from "@mui/icons-material/ErrorOutlineOutlined";
import HourglassEmpty from "@mui/icons-material/HourglassEmpty";
import RemoveCircleOutlineOutlined from "@mui/icons-material/RemoveCircleOutlineOutlined";
import TrendingDown from "@mui/icons-material/TrendingDown";
import TrendingFlat from "@mui/icons-material/TrendingFlat";
import TrendingUp from "@mui/icons-material/TrendingUp";
import VisibilityOutlined from "@mui/icons-material/VisibilityOutlined";
import type { Tally, Verdict } from "../api";
import { useApp } from "../appContext";
import { useT, type MessageKey } from "../i18n";
import { marginText, rangeText, tallyText, type Level } from "../warningsView";

// A share against the project's accuracy target, as the pages show it: the count, its margin of error drawn on a
// 0-100% track with the target marked, and a verdict in words. A state is never colour alone: the chip has an icon
// and a label, and the bar's tip says everything it draws.

const TONE = { below: "error", watch: "warning", ok: "success", early: "default" } as const;
const ICON = { below: ErrorOutlineOutlined, watch: VisibilityOutlined, ok: CheckCircleOutlineOutlined, early: HourglassEmpty } as const;

const tip = {
  tooltip: { sx: { maxWidth: 340, fontSize: "0.8rem", lineHeight: 1.5, p: 1.25, bgcolor: "#262b31" } },
  arrow: { sx: { color: "#262b31" } },
} as const;

/** "Below target", "Watch", "On target" or "Too early to say", with what it means in its tip. */
export function VerdictChip({ verdict }: { verdict: Verdict | null }) {
  const t = useT();
  if (verdict === null) return <>–</>;
  const Icon = ICON[verdict];
  return (
    <Tooltip title={t(`accuracy.verdictHelp.${verdict}` as MessageKey)} describeChild arrow slotProps={tip}>
      <Chip size="small" variant="outlined" color={TONE[verdict]} icon={<Icon />} label={t(`accuracy.verdict.${verdict}` as MessageKey)} tabIndex={0} sx={{ fontWeight: 500 }} />
    </Tooltip>
  );
}

const TREND = { better: TrendingUp, worse: TrendingDown, same: TrendingFlat } as const;

/** Someone's latest answers against their earlier ones: improving, getting worse or steady. Nothing while unknown. */
export function TrendMark({ trend }: { trend: "better" | "worse" | "same" | null }) {
  const t = useT();
  if (trend === null) return null;
  const Icon = TREND[trend];
  return (
    <Tooltip title={t("accuracy.trendHelp")} describeChild arrow slotProps={tip}>
      <Box component="span" tabIndex={0} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: "text.secondary", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
        <Icon fontSize="small" color={trend === "worse" ? "error" : trend === "better" ? "success" : "inherit"} aria-hidden />
        {t(`accuracy.trend.${trend}` as MessageKey)}
      </Box>
    </Tooltip>
  );
}

const BAND = { below: "error.main", watch: "warning.main", ok: "success.main", early: "text.disabled" } as const;

/**
 * "3 of 8" with the share drawn on a 0-100% track: a dot where the share is, a band over its margin of error (wide
 * with few answers, narrow with many) and a tick at the target. The band left of the tick is "below"; across it, "watch".
 */
export function MarginBar({ tally, target, width = 150 }: { tally: Tally & { low: number | null; high: number | null; verdict: Verdict | null }; target: number; width?: number }) {
  const t = useT();
  const { language } = useApp();
  const words = marginText(t, tally, target, language);
  if (tally.compared === 0 || tally.low === null || tally.high === null) {
    return (
      <Typography variant="body2" color="text.secondary">
        –
      </Typography>
    );
  }
  const share = tally.agreeing / tally.compared;
  const pct = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;
  const tone = BAND[tally.verdict ?? "early"];
  return (
    <Tooltip title={words} describeChild arrow slotProps={tip}>
      <Box tabIndex={0} role="img" aria-label={words} sx={{ minWidth: width, maxWidth: width + 40, outlineOffset: 2 }}>
        <Typography variant="body2" component="div" sx={{ fontVariantNumeric: "tabular-nums", display: "flex", justifyContent: "space-between", gap: 1 }}>
          <span>{tallyText(t, tally)}</span>
          <Box component="span" sx={{ color: "text.secondary" }}>
            {rangeText(tally, language)}
          </Box>
        </Typography>
        <Box aria-hidden sx={{ position: "relative", height: 14, mt: 0.25 }}>
          {/* the track, 0 to 100% */}
          <Box sx={{ position: "absolute", left: 0, right: 0, top: 5, height: 4, bgcolor: "#e6e9ee", borderRadius: 2 }} />
          {/* the margin of error */}
          <Box sx={{ position: "absolute", left: pct(tally.low), width: pct(tally.high - tally.low), top: 4, height: 6, minWidth: 2, bgcolor: tone, opacity: 0.4, borderRadius: 3 }} />
          {/* the target */}
          <Box sx={{ position: "absolute", left: pct(target / 100), top: 0, bottom: 0, width: "2px", ml: "-1px", bgcolor: "text.primary" }} />
          {/* the share itself, ringed in the page's colour where it lies on the band */}
          <Box sx={{ position: "absolute", left: pct(share), top: 2, width: 10, height: 10, ml: "-5px", borderRadius: "50%", bgcolor: tone, border: "2px solid #fff", boxSizing: "border-box" }} />
        </Box>
      </Box>
    </Tooltip>
  );
}

const LEVEL_TONE = { problem: "error", look: "warning", ok: "success", early: "default", none: "default" } as const;
const LEVEL_ICON = { problem: ErrorOutlineOutlined, look: VisibilityOutlined, ok: CheckCircleOutlineOutlined, early: HourglassEmpty, none: RemoveCircleOutlineOutlined } as const;

/** How a layer of the Early warning view stands. */
export function LevelChip({ level }: { level: Level }) {
  const t = useT();
  const Icon = LEVEL_ICON[level];
  return <Chip size="small" variant={level === "problem" ? "filled" : "outlined"} color={LEVEL_TONE[level]} icon={<Icon />} label={t(`level.${level}` as MessageKey)} sx={{ fontWeight: 500 }} />;
}
