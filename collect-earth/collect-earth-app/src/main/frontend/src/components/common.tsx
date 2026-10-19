import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { STATUS_COLORS, type PlotStatus } from "../types";

export function StatusDot({ status, size = 10 }: { status: PlotStatus; size?: number }) {
  return (
    <Box component="span" aria-hidden sx={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "inline-block",
      bgcolor: STATUS_COLORS[status], boxShadow: "0 0 0 2px var(--mui-palette-background-paper), 0 0 0 3px rgba(0,0,0,.15)",
    }} />
  );
}

/** Keyboard-shortcut hint, e.g. <Kbd>N</Kbd> */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <Box component="kbd" sx={{
      font: "11px/1 ui-monospace, SFMono-Regular, Consolas, monospace",
      px: "5px", py: "2px", borderRadius: "4px", border: 1, borderBottomWidth: 2,
      borderColor: "currentColor", opacity: 0.6,
    }}>{children}</Box>
  );
}
