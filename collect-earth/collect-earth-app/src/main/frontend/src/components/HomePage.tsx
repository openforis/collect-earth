import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { UiState } from "../controller";
import type { AppInfo } from "../appInfo";
import { statusCounts } from "../home";
import { useT } from "../i18n";
import type { PlotStatus } from "../types";
import { StatusDot } from "./common";
import { bannerText } from "./MapArea";

/**
 * The page without a map, for the Google Earth Pro viewer: the plots are in Google Earth Pro, where their data is
 * entered, so the page only shows the project, the operator and how far the work has got.
 */
export function HomePage({ info, state }: { info: AppInfo | null; state: UiState }) {
  const t = useT();
  const counts = statusCounts(state.order, state.statuses);
  const pct = counts.total ? Math.round((counts.saved / counts.total) * 100) : 0;
  const numbers: [PlotStatus, number][] = [["saved", counts.saved], ["partial", counts.partial], ["empty", counts.empty]];

  return (
    <Box sx={{ height: "100%", overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", p: { xs: 2, sm: 4 } }}>
      <Stack spacing={3} sx={{ width: "100%", maxWidth: 720, mt: { xs: 2, sm: 6 } }} data-testid="home">
        <Box>
          {info
            ? <Typography variant="h4" component="h1" sx={{ fontWeight: 600, wordBreak: "break-word" }}>{info.project}</Typography>
            : <Skeleton variant="text" width="60%" sx={{ fontSize: "2.125rem" }} />}
          {info?.operator && <Typography variant="subtitle1" color="text.secondary">{info.operator}</Typography>}
        </Box>
        {/* Why there are no plots: no survey loaded, or a load that failed and is tried again (the controller's banner) */}
        {state.banner && (
          <Alert severity={state.banner.severity} role="status" data-testid="banner">{bannerText(state.banner, t)}</Alert>
        )}
        <Paper variant="outlined" sx={{ p: 3 }}>
          {state.loaded && state.order.length > 0 ? (
            <Stack spacing={2}>
              <Typography variant="body1">{t("progress", { saved: counts.saved, total: counts.total, pct })}</Typography>
              <LinearProgress variant="determinate" value={pct} aria-label={t("completedPlots")}
                sx={{ height: 10, borderRadius: 5 }} />
              <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
                {numbers.map(([status, n]) => (
                  <Stack key={status} spacing={0.5} sx={{ flex: "1 1 140px" }}>
                    <Typography variant="h4" component="p" sx={{ fontWeight: 600 }}>{n}</Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                      <StatusDot status={status} />
                      <Typography variant="body2" color="text.secondary">{t(`status.${status}`)}</Typography>
                    </Stack>
                  </Stack>
                ))}
              </Stack>
            </Stack>
          ) : state.loaded || state.banner ? (
            <Typography variant="body2" color="text.secondary">{t("noPlots")}</Typography>
          ) : (
            <Stack spacing={1}>
              <Typography variant="body2" color="text.secondary">{t("loading")}</Typography>
              <LinearProgress />
            </Stack>
          )}
        </Paper>
        <Typography variant="body1" color="text.secondary">{t("home.hint")}</Typography>
      </Stack>
    </Box>
  );
}
