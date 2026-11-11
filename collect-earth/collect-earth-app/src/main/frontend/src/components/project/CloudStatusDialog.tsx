import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Snackbar from "@mui/material/Snackbar";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import { errorText } from "../../appBar";
import { type CloudState, serverOf } from "../../cloud";
import { useT } from "../../i18n";
import { CLOUD_STATUS_POLL_MILLIS, type CloudStatus } from "../../project";
import { cloudStatus, cloudSyncNow } from "../../projectApi";
import { serverText, type Texts } from "../../serverTexts";

/** `cloud`: the project's state (cloud.ts), for the names of the cloud project and its server */
interface Props { open: boolean; texts: Texts | null; language: string; cloud: CloudState | null; onClose: () => void }

/** Cloud sync status (CloudSyncStatusDialog): the queue's counts, refreshed every few seconds while open; Sync now. */
export function CloudStatusDialog({ open, texts, language, cloud, onClose }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback((signal?: AbortSignal) => {
    cloudStatus(signal).then((r) => { setStatus(r); setError(null); }, (e) => { if (!signal?.aborted) setError(errorText(e, t("appBar.unreachable"))); });
  }, [t]);
  useEffect(() => {
    if (!open) return;
    setStatus(null); setError(null);
    const controller = new AbortController();
    refresh(controller.signal);
    const timer = window.setInterval(() => refresh(controller.signal), CLOUD_STATUS_POLL_MILLIS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [open, refresh]);

  const syncNow = () => cloudSyncNow().then(() => { setNotice(s("CloudSyncStatusDialog.syncNowStarted")); refresh(); }, (e) => setError(errorText(e, t("appBar.unreachable"))));
  const when = (millis: number | null | undefined) => (millis == null ? s("CloudSyncStatusDialog.never") : new Date(millis).toLocaleString(language));
  // The Swing labels end with a colon
  const label = (key: string) => s(key).replace(/:\s*$/, "");
  // The cloud project by its name (its id after it) and its server, as /api/cloud/state tells them
  const p = cloud?.project.mode === "cloud" ? cloud.project : null;
  const withDetail = (main: string, detail: string | null | undefined) => (detail && detail !== main ? main + " (" + detail + ")" : main);
  const name = p?.cloudProjectName ? withDetail(p.cloudProjectName, status?.project) : status?.project;
  const server = p && serverOf(p) ? withDetail(serverOf(p), p.server) : null;
  const rows: [string, string][] = status ? [
    [label("CloudSyncStatusDialog.projectLabel"), name ?? s("CloudSyncStatusDialog.none")],
    ...(server ? [[t("cloud.status.server"), server] as [string, string]] : []),
    ...(status.enabled ? [
      [label("CloudSyncStatusDialog.pendingLabel"), String(status.pending ?? 0)],
      [label("CloudSyncStatusDialog.failedLabel"), String(status.failed ?? 0)],
      [label("CloudSyncStatusDialog.syncedLabel"), String(status.synced ?? 0)],
      [label("CloudSyncStatusDialog.lastSyncLabel"), when(status.lastSync)],
      [label("CloudSyncStatusDialog.lastErrorLabel"), status.lastError ?? s("CloudSyncStatusDialog.none")],
    ] as [string, string][] : []),
  ] : [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" data-testid="cloud-status-dialog">
      <DialogTitle>{s("CloudSyncStatusDialog.title")}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {status && !status.enabled && <Alert severity="info" sx={{ mb: 1 }}>{s("CloudSyncStatusDialog.notEnabled")}</Alert>}
        <Table size="small">
          <TableBody>
            {rows.map(([name, value]) => (
              <TableRow key={name}>
                <TableCell sx={{ color: "text.secondary", pl: 0 }}>{name}</TableCell>
                <TableCell sx={{ fontWeight: 600, wordBreak: "break-word" }}>{value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => refresh()}>{s("CloudSyncStatusDialog.refreshButton")}</Button>
        {status?.enabled && <Button variant="outlined" onClick={syncNow}>{s("CloudSyncStatusDialog.syncNowButton")}</Button>}
        <Button variant="contained" onClick={onClose}>{s("CloudSyncStatusDialog.closeButton")}</Button>
      </DialogActions>
      <Snackbar open={notice !== null} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice} />
    </Dialog>
  );
}
