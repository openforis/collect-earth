import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";
import { formatText } from "../../settings";
import { cloudAssignments, myPlots, openTraining, refreshMyPlots, useMyPlots, type CloudAssignment, type MyPlots } from "../../settingsApi";
import { CloudAssignmentsCard } from "./CloudAssignmentsCard";

interface Props {
  texts: Texts | null;
  /** An older server's plot file downloaded: the page makes it the plots file, which Apply saves */
  onChosen: (path: string) => void;
}

/**
 * In a cloud project, the person's plots (docs/plans/2026-11-16-plots-from-the-server.md): they come from the server
 * and Collect Earth keeps them up to date by itself, so there is nothing to choose; how many, when last asked, Refresh
 * now, and the training sets, opened instead of the person's plots and left with "Back to my plots", at once (no
 * Apply). An older server, which lists plot files instead, gets the list of before (CloudAssignmentsCard).
 */
export function CloudPlotsCard({ texts, onChosen }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [status, setStatus] = useState<MyPlots | null>(null);
  const [sets, setSets] = useState<CloudAssignment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    myPlots(signal).then(setStatus, (e) => { if (!signal?.aborted) setError(errorText(e, t("appBar.unreachable"))); });
    // The training sets: the person's other files are in their plots
    cloudAssignments(signal).then((list) => setSets(list.filter((a) => a.training)), () => setSets([]));
  }, [t]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const act = (call: () => Promise<MyPlots>) => {
    setBusy(true);
    setError(null);
    call().then(setStatus, (e) => setError(errorText(e, t("appBar.unreachable")))).finally(() => setBusy(false));
  };

  if (status?.mode === "files") return <CloudAssignmentsCard texts={texts} onChosen={onChosen} />;
  if (!status) return error ? <Alert severity="warning">{error}</Alert> : <CircularProgress size={20} />;

  const when = (millis: number | null) => (millis == null ? "–" : new Date(millis).toLocaleString());
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="cloud-plots">
      <Stack spacing={1.5}>
        <Typography variant="body2">{formatText(s("SettingsPage.myPlots.explain"), status.checkMinutes)}</Typography>
        {status.training ? (
          <Alert severity="info" action={<Button size="small" disabled={busy} onClick={() => act(useMyPlots)}>{s("SettingsPage.myPlots.back")}</Button>}>
            {formatText(s("SettingsPage.myPlots.onTraining"), status.training)}
          </Alert>
        ) : (
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }} data-testid="my-plots-count">{formatText(s("SettingsPage.myPlots.plots"), status.plots)}</Typography>
            <Typography variant="body2" color="text.secondary">{formatText(s("SettingsPage.myPlots.checked"), when(status.checkedAt))}</Typography>
            {busy ? <CircularProgress size={20} /> : <Button size="small" onClick={() => act(refreshMyPlots)}>{s("SettingsPage.myPlots.refresh")}</Button>}
          </Stack>
        )}
        {status.mode === "pending" && <Alert severity="info">{s("SettingsPage.myPlots.pending")}</Alert>}
        {status.mode === "myPlots" && status.plots === 0 && !status.training && <Alert severity="info">{s("SettingsPage.myPlots.none")}</Alert>}
        {status.outcome === "OFFLINE" && <Alert severity="warning">{s("SettingsPage.myPlots.offline")}</Alert>}
        {status.leftOut.length > 0 && <Alert severity="warning">{formatText(s("SettingsPage.myPlots.leftOut"), status.leftOut.join(", "))}</Alert>}
        {status.unreadable > 0 && <Alert severity="warning">{formatText(s("SettingsPage.myPlots.unreadable"), status.unreadable)}</Alert>}
        {sets.length > 0 && (
          <Stack spacing={0.5} data-testid="training-sets">
            <Typography variant="subtitle2">{s("SettingsPage.myPlots.training")}</Typography>
            {sets.map((set) => (
              <Stack key={set.id} direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ flexGrow: 1 }}>{set.filename}{" · "}{formatText(s("SettingsPage.sampleFile.plots"), set.plots)}</Typography>
                <Button size="small" disabled={busy || set.filename === status.training} onClick={() => act(() => openTraining(set.id))}>
                  {s("SettingsPage.myPlots.open")}
                </Button>
              </Stack>
            ))}
          </Stack>
        )}
        {error && <Alert severity="warning">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
