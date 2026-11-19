import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { MouseEvent, ReactNode } from "react";

/** Small beside a question on a wide screen, a finger's size on a phone */
const TOOL_SX = { p: { xs: 1, sm: "5px" }, "& .MuiSvgIcon-root": { fontSize: { xs: 24, sm: 20 } } } as const;

/**
 * An icon button of the survey designer with its tooltip: the tooltip holds a span, so it still shows (and MUI does
 * not warn) while the button is disabled
 */
export function ToolButton({ title, label, disabled, color, onClick, children }: {
  /** What the tooltip says: what it does, or why it cannot */
  title: string;
  /** Its name for a screen reader: what it does, and to what */
  label: string;
  disabled?: boolean;
  color?: "error";
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <Tooltip title={title}>
      <span style={{ display: "inline-flex" }}>
        <IconButton size="small" color={color} aria-label={label} disabled={disabled} onClick={onClick} sx={TOOL_SX}>
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}
