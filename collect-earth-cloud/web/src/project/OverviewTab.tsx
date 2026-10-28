import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ArrowForward from "@mui/icons-material/ArrowForward";
import CheckCircle from "@mui/icons-material/CheckCircle";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import { getOverview, listAssignments, listInvites } from "../api";
import { useApp } from "../appContext";
import { checklist, doneCount, STEP_TAB } from "../checklist";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import type { ProjectTab } from "../router";
import { useLoad } from "../useLoad";

async function loadOverview(projectId: string) {
  const [overview, invites, assignments] = await Promise.all([
    getOverview(projectId),
    // Older servers have no invite list: the checklist then counts only people.
    listInvites(projectId).catch(() => []),
    listAssignments(projectId).catch(() => []),
  ]);
  return { overview, openInvites: invites.length, assignments: assignments.length };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Typography variant="h2" component="p">
        {value}
      </Typography>
      <Typography color="text.secondary">{label}</Typography>
    </Paper>
  );
}

export function OverviewTab({ projectId, onGo }: { projectId: string; onGo: (tab: ProjectTab) => void }) {
  const t = useT();
  const { language } = useApp();
  const state = useLoad(() => loadOverview(projectId), [projectId]);

  if (state.loading && !state.data) return <Loading />;
  if (state.error || !state.data) return <ErrorAlert error={state.error} onRetry={state.reload} />;

  const { overview, openInvites, assignments } = state.data;
  const steps = checklist({
    hasProjectFile: overview.cep !== null,
    plotFileCount: overview.csvFiles,
    memberCount: overview.members,
    openInviteCount: openInvites,
    assignmentCount: assignments,
    recordCount: overview.records.total,
  });
  const done = doneCount(steps);
  const n = (value: number) => formatNumber(value, language);

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("overview.checklistTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {done === steps.length ? t("overview.allDone") : t("overview.stepsDone", { done, total: steps.length })}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={(done / steps.length) * 100}
          sx={{ mb: 2, height: 8, borderRadius: 4 }}
          aria-label={t("overview.stepsDone", { done, total: steps.length })}
        />
        <Box component="ol" sx={{ listStyle: "none", p: 0, m: 0 }}>
          {steps.map((step, index) => (
            <Box
              component="li"
              key={step.id}
              sx={{
                display: "flex",
                gap: 2,
                alignItems: { xs: "flex-start", sm: "center" },
                flexDirection: { xs: "column", sm: "row" },
                py: 1.5,
                px: 1.5,
                borderRadius: 2,
                bgcolor: step.current ? "action.selected" : "transparent",
              }}
              aria-current={step.current ? "step" : undefined}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start", flex: 1 }}>
                {step.done ? (
                  <CheckCircle color="success" aria-label={t("step.done")} />
                ) : (
                  <RadioButtonUnchecked color={step.current ? "primary" : "disabled"} aria-label={t("step.todo")} />
                )}
                <Box>
                  <Typography sx={{ fontWeight: step.current ? 600 : 400 }}>
                    {index + 1}. {t(`step.${step.id}.title`)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(`step.${step.id}.help`)}
                  </Typography>
                </Box>
              </Stack>
              {step.done ? (
                <Chip label={t("step.done")} color="success" variant="outlined" size="small" sx={{ ml: { xs: 4.5, sm: 0 } }} />
              ) : (
                <Button
                  variant={step.current ? "contained" : "outlined"}
                  endIcon={<ArrowForward />}
                  onClick={() => onGo(STEP_TAB[step.id])}
                  sx={{ ml: { xs: 4.5, sm: 0 }, flexShrink: 0 }}
                >
                  {t(`step.${step.id}.action`)}
                </Button>
              )}
            </Box>
          ))}
        </Box>
      </Paper>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Stat label={t("overview.plots")} value={n(overview.plots)} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Stat label={t("overview.submitted")} value={n(overview.records.submitted)} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Stat label={t("overview.plotFiles")} value={n(overview.csvFiles)} />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Stat label={t("overview.people")} value={n(overview.members)} />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("overview.byPerson")}
        </Typography>
        {overview.records.byOperator.length === 0 ? (
          <Typography color="text.secondary">{t("overview.noData")}</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("overview.person")}</TableCell>
                  <TableCell align="right">{t("overview.submittedCol")}</TableCell>
                  <TableCell align="right">{t("overview.savedCol")}</TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>{t("overview.lastActivity")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {overview.records.byOperator.map((o) => (
                  <TableRow key={o.operator}>
                    <TableCell sx={{ wordBreak: "break-word" }}>{o.operator || t("overview.unknownPerson")}</TableCell>
                    <TableCell align="right">{n(o.submitted)}</TableCell>
                    <TableCell align="right">{n(o.total)}</TableCell>
                    <TableCell sx={{ display: { xs: "none", sm: "table-cell" } }}>{formatDate(o.lastModifiedOn, language)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  );
}
