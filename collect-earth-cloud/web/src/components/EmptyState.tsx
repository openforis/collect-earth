import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/** What to do next when there is nothing to show yet. */
export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Box sx={{ textAlign: "center", py: 4, px: 2, color: "text.secondary" }}>
      {icon && <Box sx={{ mb: 1, "& svg": { fontSize: 48 } }}>{icon}</Box>}
      <Typography variant="h3" component="p" color="text.primary" gutterBottom>
        {title}
      </Typography>
      {children && <Typography sx={{ maxWidth: 520, mx: "auto" }}>{children}</Typography>}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  );
}
