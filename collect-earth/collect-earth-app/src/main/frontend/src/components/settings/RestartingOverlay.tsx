import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { Logo } from "../Logo";

/**
 * Over everything while Collect Earth restarts for the settings or the project: the process that served this page
 * closes its browser windows on its way out, and the new one opens its own.
 */
export function RestartingOverlay({ text }: { text: string }) {
  return (
    <Box role="alert" sx={{
      position: "fixed", inset: 0, zIndex: (theme) => theme.zIndex.modal + 1, bgcolor: "background.default",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, p: 3, textAlign: "center",
    }}>
      <Logo sx={{ height: 64 }} />
      <CircularProgress />
      <Typography variant="h6" sx={{ maxWidth: 520 }}>{text}</Typography>
    </Box>
  );
}
