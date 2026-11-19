import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useId, type MouseEvent, type ReactNode } from "react";

/** Small beside a question on a wide screen, a finger's size on a phone */
const TOOL_SX = { p: { xs: 1, sm: "5px" }, "& .MuiSvgIcon-root": { fontSize: { xs: 24, sm: 20 } } } as const;
const OFF_SX = { ...TOOL_SX, color: "action.disabled", cursor: "default", "&:hover": { bgcolor: "transparent" } } as const;

/**
 * An icon button of the survey designer with its tooltip. Unavailable, it stays focusable (aria-disabled, not
 * disabled): the keyboard keeps its place on it while a change is saved, and a screen reader reads why it cannot be
 * used (`reason`, its description), not only a mouse's tooltip.
 */
export function ToolButton({ title, label, disabled, reason, color, onClick, children }: {
  /** What the tooltip says: what it does, or why it cannot */
  title: string;
  /** Its name for a screen reader: what it does, and to what */
  label: string;
  disabled?: boolean;
  /** Why it cannot be used, when that is not only "a change is being saved": read with its name */
  reason?: string;
  color?: "error";
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Tooltip title={title}>
      <span style={{ display: "inline-flex" }}>
      <IconButton
        size="small"
        color={disabled ? undefined : color}
        aria-label={label}
        aria-disabled={disabled || undefined}
        aria-describedby={disabled && reason ? id : undefined}
        disableRipple={disabled}
        onClick={disabled ? undefined : onClick}
        sx={disabled ? OFF_SX : TOOL_SX}
      >
        {children}
        {disabled && reason && (
          <span id={id} hidden>
            {reason}
          </span>
        )}
      </IconButton>
      </span>
    </Tooltip>
  );
}
