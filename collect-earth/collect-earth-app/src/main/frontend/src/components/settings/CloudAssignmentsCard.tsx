import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { errorText } from "../../appBar";
import { useT } from "../../i18n";
import { serverText, type Texts } from "../../serverTexts";
import { formatText } from "../../settings";
import { cloudAssignments, downloadAssignment, type CloudAssignment } from "../../settingsApi";

interface Props {
  texts: Texts | null;
  /** The plot file downloaded: the page makes it the plots file, which Apply saves */
  onChosen: (path: string) => void;
}

/**
 * The plot files the cloud server assigns to the operator, in cloud mode, as the Sample data tab of the Swing settings
 * listed them: choosing one downloads it into the project and makes it the plots file.
 */
export function CloudAssignmentsCard({ texts, onChosen }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [assignments, setAssignments] = useState<CloudAssignment[] | null>(null);
  const [chosen, setChosen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((signal?: AbortSignal) => {
    setBusy(true);
    setError(null);
    cloudAssignments(signal).then((list) => {
      setAssignments(list);
      setChosen(list.find((a) => a.active)?.id ?? "");
    }, (e) => { if (!signal?.aborted) setError(errorText(e, t("appBar.unreachable"))); }).finally(() => setBusy(false));
  }, [t]);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const choose = (id: string) => {
    setChosen(id);
    setBusy(true);
    setError(null);
    downloadAssignment(id).then(onChosen, (e) => setError(errorText(e, t("appBar.unreachable")))).finally(() => setBusy(false));
  };
  const label = s("SampleDataPanel.assignmentLabel").replace(/:\s*$/, "");

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }} data-testid="cloud-assignments">
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <TextField select size="small" fullWidth label={label} value={chosen} disabled={busy || !assignments?.length}
            onChange={(e) => choose(e.target.value)}>
            {(assignments ?? []).map((a) => (
              <MenuItem key={a.id} value={a.id}>{a.filename}{" · "}{formatText(s("SettingsPage.sampleFile.plots"), a.plots)}</MenuItem>
            ))}
          </TextField>
          {busy ? <CircularProgress size={20} /> : <Button size="small" onClick={() => load()} sx={{ flexShrink: 0 }}>{s("SampleDataPanel.refreshAssignments")}</Button>}
        </Stack>
        {assignments?.length === 0 && <Alert severity="info">{s("SettingsPage.cloud.noAssignments")}</Alert>}
        {error && <Alert severity="warning">{error}</Alert>}
      </Stack>
    </Paper>
  );
}
