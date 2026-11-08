import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { anonymizeFormerMember, getFormerMembers, type FormerMember } from "../api";
import { useApp } from "../appContext";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";
import { ErrorAlert } from "./ErrorAlert";

/**
 * The people who collected in the project and have left it (People tab, coordinators): their name stays on what they
 * collected until a coordinator anonymises it, which renames it "former-member-N" everywhere at once (cannot be undone).
 * Nothing shows while nobody has left.
 */
export function FormerMembers({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const list = useLoad(() => getFormerMembers(projectId), [projectId]);
  const [asking, setAsking] = useState<FormerMember | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const named = (list.data ?? []).filter((f) => !f.anonymized);
  const anonymized = (list.data ?? []).filter((f) => f.anonymized);
  if (!list.data || list.data.length === 0) return list.error ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null;

  const anonymize = async (f: FormerMember) => {
    setBusy(true);
    setError(null);
    try {
      const r = await anonymizeFormerMember(projectId, f.operator);
      setDone(t("former.done", { name: f.operator, pseudonym: r.operator, count: formatNumber(r.records, language) }));
      setAsking(null);
      list.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" component="section" aria-labelledby="former-members" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h2" id="former-members" gutterBottom>
        {t("former.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("former.explain")}
      </Typography>
      {done && (
        <Alert severity="success" role="status" sx={{ mb: 2 }}>
          {done}
        </Alert>
      )}
      <ErrorAlert error={error} />
      {named.length > 0 && (
        <List disablePadding>
          {named.map((f) => (
            <ListItem key={f.operator} divider sx={{ px: 0, gap: 2, flexWrap: "wrap" }}>
              <ListItemText primary={f.operator} secondary={t(f.records === 1 ? "former.recordsOne" : "former.records", { count: formatNumber(f.records, language) })} sx={{ flex: "1 1 200px" }} />
              <Button variant="outlined" onClick={() => setAsking(f)} aria-label={t("former.anonymizeLabel", { name: f.operator })}>
                {t("former.anonymize")}
              </Button>
            </ListItem>
          ))}
        </List>
      )}
      {anonymized.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t("former.alreadyAnonymized", { names: anonymized.map((f) => f.operator).join(", ") })}
        </Typography>
      )}
      <Dialog open={asking !== null} onClose={busy ? undefined : () => setAsking(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("former.confirmTitle", { name: asking?.operator ?? "" })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("former.confirmText", { name: asking?.operator ?? "", count: formatNumber(asking?.records ?? 0, language) })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAsking(null)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="contained" color="warning" onClick={() => asking && void anonymize(asking)} disabled={busy}>
            {t("former.anonymize")}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
