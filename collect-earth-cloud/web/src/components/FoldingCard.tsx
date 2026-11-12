import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useId, useState, type ReactNode } from "react";

/**
 * A card whose content folds away under its title: for what is needed now and then (designing plots, the strata's
 * areas), so the page shows first what is used every day. Folded, its title says where things stand (`summary`).
 */
export function FoldingCard({ title, summary, defaultOpen = false, children }: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <Paper variant="outlined" component="section" aria-labelledby={`${id}-title`}>
      <ButtonBase
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", px: { xs: 2, sm: 3 }, py: 2, gap: 2, borderRadius: 1 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h2" id={`${id}-title`}>{title}</Typography>
          {summary && !open && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{summary}</Typography>
          )}
        </Box>
        <ExpandMore aria-hidden sx={{ transition: "transform 150ms", transform: open ? "rotate(180deg)" : "none", color: "action.active" }} />
      </ButtonBase>
      <Collapse in={open} id={`${id}-content`} unmountOnExit={false}>
        <Box sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 3 } }}>{children}</Box>
      </Collapse>
    </Paper>
  );
}
