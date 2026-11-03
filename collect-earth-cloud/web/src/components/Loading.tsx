import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useT } from "../i18n";

export function Loading() {
  const t = useT();
  return (
    <Box role="status" sx={{ display: "flex", alignItems: "center", gap: 2, py: 6, justifyContent: "center" }}>
      <CircularProgress size={28} />
      <Typography color="text.secondary">{t("common.loading")}</Typography>
    </Box>
  );
}
