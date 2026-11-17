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
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { anonymizeFormerMember, getFormerMembers, giveTypedName, listMembers, type FormerMember } from "../api";
import { useApp } from "../appContext";
import { formatNumber } from "../format";
import { formerMembersView, giveCandidates, isDefaultName } from "../formerMembersView";
import { useT } from "../i18n";
import { queryClient } from "../queryClient";
import { useLoad } from "../useLoad";
import { ErrorAlert } from "./ErrorAlert";
import { Explain } from "./Explain";

/**
 * The names on the project's plots that are nobody in it (People tab, coordinators), in two cards:
 * - the names typed in Collect Earth (a backup, a CEO project, an older Collect Earth): "Give to…" a person of the
 *   project moves their plots to that person, so they count as theirs; they can also be anonymised;
 * - the people who collected and have left: their name stays on what they collected until a coordinator anonymises
 *   it, which renames it "former-member-N" everywhere at once (cannot be undone).
 * Nothing shows while there is neither.
 */
export function FormerMembers({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const list = useLoad(["project", projectId, "getFormerMembers"], () => getFormerMembers(projectId));
  const members = useLoad(["project", projectId, "listMembers"], () => listMembers(projectId));
  const [asking, setAsking] = useState<FormerMember | null>(null);
  const [giving, setGiving] = useState<FormerMember | null>(null);
  const [person, setPerson] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!list.data || list.data.length === 0) return list.error ? <ErrorAlert error={list.error} onRetry={list.reload} /> : null;
  const { typed, left, anonymized } = formerMembersView(list.data);
  const candidates = giving ? giveCandidates(members.data ?? [], giving.operator) : [];

  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      setDone(await work());
      setAsking(null);
      setGiving(null);
      // The figures of every page move with the plots: asked again when each page opens, the People tab's at once
      void queryClient.invalidateQueries({ queryKey: ["project", projectId], refetchType: "none" });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "getPeople"] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId, "getFormerMembers"] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const anonymize = (f: FormerMember) =>
    act(async () => {
      const r = await anonymizeFormerMember(projectId, f.operator);
      return t("former.done", { name: f.operator, pseudonym: r.operator, count: formatNumber(r.records, language) });
    });
  const give = (f: FormerMember, username: string) =>
    act(async () => {
      const r = await giveTypedName(projectId, f.operator, username);
      const count = (n: number) => t(n === 1 ? "former.recordsOne" : "former.records", { count: formatNumber(n, language) });
      const values = { name: f.operator, person: r.username, records: count(r.moved), kept: count(r.kept) };
      return t(r.kept > 0 ? "typed.doneKept" : "typed.done", values);
    });
  const openGive = (f: FormerMember) => {
    setGiving(f);
    setPerson(giveCandidates(members.data ?? [], f.operator)[0]?.username ?? "");
  };
  const records = (f: FormerMember) => t(f.records === 1 ? "former.recordsOne" : "former.records", { count: formatNumber(f.records, language) });
  const doneAlert = done && (
    <Alert severity="success" role="status" sx={{ mb: 2 }}>
      {done}
    </Alert>
  );

  return (
    <>
      {typed.length > 0 && (
        <Paper variant="outlined" component="section" aria-labelledby="typed-names" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h2" id="typed-names" gutterBottom>
            {t("typed.title")}
          </Typography>
          <Explain sx={{ mb: 2 }} text={t("typed.explain.short")} more={t("typed.explain")} />
          {doneAlert}
          <ErrorAlert error={error} />
          <List disablePadding>
            {typed.map((f) => (
              <ListItem key={f.operator} divider sx={{ px: 0, gap: 2, flexWrap: "wrap" }}>
                <ListItemText primary={f.operator} secondary={records(f)} sx={{ flex: "1 1 200px" }} />
                <Stack direction="row" spacing={1}>
                  <Button variant="contained" onClick={() => openGive(f)} aria-label={t("typed.giveLabel", { name: f.operator })}>
                    {t("typed.give")}
                  </Button>
                  <Button onClick={() => setAsking(f)} aria-label={t("former.anonymizeLabel", { name: f.operator })}>
                    {t("former.anonymize")}
                  </Button>
                </Stack>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
      {(left.length > 0 || anonymized.length > 0) && (
        <Paper variant="outlined" component="section" aria-labelledby="former-members" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h2" id="former-members" gutterBottom>
            {t("former.title")}
          </Typography>
          <Explain sx={{ mb: 2 }} text={t("former.explain.short")} more={t("former.explain")} />
          {typed.length === 0 && doneAlert}
          {typed.length === 0 && <ErrorAlert error={error} />}
          {left.length > 0 && (
            <List disablePadding>
              {left.map((f) => (
                <ListItem key={f.operator} divider sx={{ px: 0, gap: 2, flexWrap: "wrap" }}>
                  <ListItemText primary={f.operator} secondary={records(f)} sx={{ flex: "1 1 200px" }} />
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
        </Paper>
      )}
      <Dialog open={giving !== null} onClose={busy ? undefined : () => setGiving(null)} maxWidth="xs" fullWidth aria-labelledby="give-title">
        <DialogTitle id="give-title">{t("typed.giveTitle", { name: giving?.operator ?? "" })}</DialogTitle>
        <DialogContent>
          {candidates.length === 0 ? (
            <DialogContentText>{members.error ? null : t("typed.noPeople")}</DialogContentText>
          ) : (
            <>
              <TextField select fullWidth label={t("typed.person")} value={person} onChange={(e) => setPerson(e.target.value)} sx={{ mt: 1, mb: 2 }}>
                {candidates.map((m) => (
                  <MenuItem key={m.userId} value={m.username}>
                    {m.username}
                  </MenuItem>
                ))}
              </TextField>
              <DialogContentText>{t("typed.giveText", { records: giving ? records(giving) : "" })}</DialogContentText>
              {giving && isDefaultName(giving.operator) && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {t("typed.defaultName", { name: giving.operator })}
                </Alert>
              )}
            </>
          )}
          <ErrorAlert error={members.error} onRetry={members.reload} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGiving(null)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="contained" onClick={() => giving && person && void give(giving, person)} disabled={busy || !person}>
            {t("typed.giveButton")}
          </Button>
        </DialogActions>
      </Dialog>
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
    </>
  );
}
