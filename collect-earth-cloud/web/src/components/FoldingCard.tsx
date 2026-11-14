import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Collapse from "@mui/material/Collapse";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { createContext, useContext, useId, useState, type ReactNode } from "react";

/** Set by `OpenCards`: the cards inside show open, without the fold control. */
const Unfolded = createContext(false);

/**
 * Inside, folding cards show open with no fold control, except those marked `keepFolded`: for a page of one or two
 * cards (a Setup section), where folding only hides what the page is for.
 */
export function OpenCards({ children }: { children: ReactNode }) {
  return <Unfolded.Provider value>{children}</Unfolded.Provider>;
}

/**
 * A card whose content folds away under its title: for what is needed now and then (designing plots, the strata's
 * areas), so the page shows first what is used every day. Folded, its title says where things stand (`summary`).
 */
export function FoldingCard({ title, summary, defaultOpen = false, danger = false, keepFolded = false, children }: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  /** Deleting and the like: the border and title in the error colour */
  danger?: boolean;
  /** Folds even inside `OpenCards`: what is rare or dangerous */
  keepFolded?: boolean;
  children: ReactNode;
}) {
  const unfolded = useContext(Unfolded) && !keepFolded;
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  if (unfolded) return <OpenFrame title={title} danger={danger}>{children}</OpenFrame>;
  return (
    <Paper variant="outlined" component="section" aria-labelledby={`${id}-title`} sx={danger ? { borderColor: "error.main" } : undefined}>
      <ButtonBase
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        sx={{ width: "100%", justifyContent: "flex-start", textAlign: "left", px: { xs: 2, sm: 3 }, py: 2, gap: 2, borderRadius: 1 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h2" id={`${id}-title`} color={danger ? "error" : undefined}>{title}</Typography>
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

/** A card with its title, open. */
function OpenFrame({ title, danger, children }: { title: string; danger: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: { xs: 2, sm: 3 }, ...(danger ? { borderColor: "error.main" } : {}) }}>
      <Typography variant="h2" id={id} color={danger ? "error" : undefined} sx={{ mb: 2 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/**
 * A card with its title: folded under it when `fold` is given (what the folded card says of where things stand),
 * else open as the page's other cards. Inside `OpenCards`, open whatever `fold` says unless `keepFolded`.
 */
export function CardFrame({ title, fold, danger = false, keepFolded = false, children }: {
  title: string;
  fold?: ReactNode;
  danger?: boolean;
  keepFolded?: boolean;
  children: ReactNode;
}) {
  if (fold !== undefined) {
    return (
      <FoldingCard title={title} summary={fold} danger={danger} keepFolded={keepFolded}>
        {children}
      </FoldingCard>
    );
  }
  return <OpenFrame title={title} danger={danger}>{children}</OpenFrame>;
}
