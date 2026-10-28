import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import InputLabel from "@mui/material/InputLabel";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Delete from "@mui/icons-material/Delete";
import Link from "@mui/icons-material/Link";
import LinkOff from "@mui/icons-material/LinkOff";
import { useState, type FormEvent } from "react";
import {
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
  ROLES,
  setMemberRole,
  type Invite,
  type Member,
  type NewInvite,
  type Role,
} from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { JoinSteps } from "../components/JoinSteps";
import { Loading } from "../components/Loading";
import { formatDay } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

const EXPIRY_CHOICES = [1, 7, 30, 0] as const; // days; 0 = never

function InviteForm({ projectId, onCreated }: { projectId: string; onCreated: (invite: NewInvite) => void }) {
  const t = useT();
  const [role, setRole] = useState<Role>("operator");
  const [maxUses, setMaxUses] = useState("10");
  const [expiry, setExpiry] = useState<number>(30);
  const [error, setError] = useState<unknown>(null);
  const [badUses, setBadUses] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const uses = Number(maxUses);
    if (!Number.isInteger(uses) || uses < 1 || uses > 10000) {
      setBadUses(true);
      return;
    }
    setBusy(true);
    try {
      onCreated(await createInvite(projectId, { role, maxUses: uses, expiresInDays: expiry || null }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <FormControl fullWidth>
          <InputLabel id="invite-role">{t("people.role")}</InputLabel>
          <Select labelId="invite-role" label={t("people.role")} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {t(`role.${r}`)}
              </MenuItem>
            ))}
          </Select>
          <FormHelperText>{t(`role.${role}.help`)}</FormHelperText>
        </FormControl>
        <TextField
          label={t("people.maxUses")}
          type="number"
          value={maxUses}
          onChange={(e) => {
            setMaxUses(e.target.value);
            setBadUses(false);
          }}
          error={badUses}
          helperText={badUses ? t("people.maxUsesBad") : t("people.maxUsesHelp")}
          slotProps={{ htmlInput: { min: 1, max: 10000, inputMode: "numeric" } }}
        />
        <FormControl fullWidth>
          <InputLabel id="invite-expiry">{t("people.expires")}</InputLabel>
          <Select labelId="invite-expiry" label={t("people.expires")} value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            {EXPIRY_CHOICES.map((days) => (
              <MenuItem key={days} value={days}>
                {days === 0 ? t("people.expiresNever") : t(`people.expires${days}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>
      <ErrorAlert error={error} />
      <Box>
        <Button type="submit" variant="contained" startIcon={<Link />} disabled={busy}>
          {t("people.makeLink")}
        </Button>
      </Box>
    </Stack>
  );
}

function InviteList({ invites, onRevoke }: { invites: Invite[]; onRevoke: (invite: Invite) => void }) {
  const t = useT();
  const { language } = useApp();
  if (invites.length === 0) return <Typography color="text.secondary">{t("people.noInvites")}</Typography>;
  return (
    <List disablePadding>
      {invites.map((invite) => (
        <ListItem
          key={invite.id}
          divider
          secondaryAction={
            <Tooltip title={t("people.revoke")}>
              <IconButton edge="end" aria-label={t("people.revoke")} onClick={() => onRevoke(invite)}>
                <LinkOff />
              </IconButton>
            </Tooltip>
          }
        >
          <ListItemText
            primary={t("people.inviteRow", { role: t(`role.${invite.role}`), used: invite.usedCount, max: invite.maxUses })}
            secondary={[
              invite.createdAt !== null ? t("people.inviteMade", { date: formatDay(invite.createdAt, language) }) : null,
              invite.expiresAt !== null ? t("people.inviteExpires", { date: formatDay(invite.expiresAt, language) }) : t("people.inviteNoExpiry"),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        </ListItem>
      ))}
    </List>
  );
}

function MemberList({ projectId, members, onChanged }: { projectId: string; members: Member[]; onChanged: () => void }) {
  const t = useT();
  const { me } = useApp();
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  const changeRole = async (member: Member, role: Role) => {
    setError(null);
    setNotice(null);
    try {
      await setMemberRole(projectId, member.userId, role);
      setNotice(t("people.roleChanged", { name: member.username, role: t(`role.${role}`) }));
      onChanged();
    } catch (err) {
      setError(err);
    }
  };
  const remove = async (member: Member) => {
    setRemoving(null);
    setError(null);
    setNotice(null);
    try {
      await removeMember(projectId, member.userId);
      setNotice(t("people.removed", { name: member.username }));
      onChanged();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Stack spacing={2}>
      {members.length <= 1 && <Alert severity="info">{t("people.onlyYou")}</Alert>}
      <List disablePadding>
        {members.map((member) => (
          <ListItem key={member.userId} divider sx={{ gap: 2, flexWrap: "wrap", pr: 0 }}>
            <ListItemText
              primary={member.userId === me?.userId ? `${member.username} ${t("people.you")}` : member.username}
              sx={{ flex: "1 1 160px", wordBreak: "break-word" }}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Select
                size="small"
                value={member.role}
                onChange={(e) => void changeRole(member, e.target.value as Role)}
                slotProps={{ input: { "aria-label": t("people.changeRole", { name: member.username }) } }}
                sx={{ minWidth: 150 }}
              >
                {ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {t(`role.${r}`)}
                  </MenuItem>
                ))}
              </Select>
              <Tooltip title={t("people.remove", { name: member.username })}>
                <IconButton aria-label={t("people.remove", { name: member.username })} onClick={() => setRemoving(member)}>
                  <Delete />
                </IconButton>
              </Tooltip>
            </Stack>
          </ListItem>
        ))}
      </List>
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}
      <ErrorAlert error={error} />
      <Dialog open={removing !== null} onClose={() => setRemoving(null)}>
        <DialogTitle>{removing && t("people.removeTitle", { name: removing.username })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{removing && t("people.removeText", { name: removing.username })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
          <Button color="error" variant="contained" onClick={() => removing && void remove(removing)}>
            {t("common.remove")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

export function PeopleTab({ projectId }: { projectId: string }) {
  const t = useT();
  const invites = useLoad(() => listInvites(projectId), [projectId]);
  const members = useLoad(() => listMembers(projectId), [projectId]);
  const [created, setCreated] = useState<NewInvite | null>(null);
  const [revokeError, setRevokeError] = useState<unknown>(null);

  const revoke = async (invite: Invite) => {
    setRevokeError(null);
    try {
      await revokeInvite(projectId, invite.id);
      invites.reload();
    } catch (err) {
      setRevokeError(err);
    }
  };

  return (
    <Stack spacing={3}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("people.inviteTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {t("people.inviteIntro")}
        </Typography>
        <InviteForm
          projectId={projectId}
          onCreated={(invite) => {
            setCreated(invite);
            invites.reload();
          }}
        />
        {created && (
          <Box sx={{ mt: 3 }}>
            <Divider sx={{ mb: 3 }} />
            <Alert severity="success" role="status" sx={{ mb: 2 }}>
              <strong>{t("people.linkReady")}</strong> {t("people.linkOnce")}
            </Alert>
            <Typography variant="h3" gutterBottom>
              {t("people.stepsTitle")}
            </Typography>
            <JoinSteps link={created.joinUrl} />
          </Box>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("people.openInvites")}
        </Typography>
        {invites.loading && !invites.data ? (
          <Loading />
        ) : invites.error ? (
          <ErrorAlert error={invites.error} onRetry={invites.reload} />
        ) : (
          <InviteList invites={invites.data ?? []} onRevoke={revoke} />
        )}
        {revokeError !== null && (
          <Box sx={{ mt: 2 }}>
            <ErrorAlert error={revokeError} />
          </Box>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h2" gutterBottom>
          {t("people.list")}
        </Typography>
        {members.loading && !members.data ? (
          <Loading />
        ) : members.error ? (
          <ErrorAlert error={members.error} onRetry={members.reload} />
        ) : (
          <MemberList projectId={projectId} members={members.data ?? []} onChanged={members.reload} />
        )}
      </Paper>
    </Stack>
  );
}
