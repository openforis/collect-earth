import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Pagination from "@mui/material/Pagination";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AdminPanelSettings from "@mui/icons-material/AdminPanelSettings";
import Block from "@mui/icons-material/Block";
import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import Download from "@mui/icons-material/Download";
import Key from "@mui/icons-material/Key";
import Logout from "@mui/icons-material/Logout";
import MoreVert from "@mui/icons-material/MoreVert";
import PersonAdd from "@mui/icons-material/PersonAdd";
import PhonelinkErase from "@mui/icons-material/PhonelinkErase";
import Search from "@mui/icons-material/Search";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ACCOUNT_FILTERS,
  ACCOUNT_SORTS,
  ApiError,
  createAccounts,
  deleteUserAccount,
  downloadUsersCsv,
  listUsers,
  makeResetLink,
  resetUserTwoFactor,
  setPlatformAdmin,
  setUserDisabled,
  signOutUser,
  type AccountFilter,
  type AccountQuery,
  type AccountSort,
  type AdminUser,
  type MadeAccount,
  type ResetLink,
} from "../api";
import { useApp } from "../appContext";
import { CopyField } from "../components/CopyField";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatDay, formatNumber } from "../format";
import { useT } from "../i18n";
import { saveBlob } from "../saveBlob";
import { accountsToMake, sinceText } from "../serverAccountsView";
import { useLoad } from "../useLoad";

const PAGE_SIZE = 25;

/** What an action on one account needs confirmed before it is done (disable, admin role, sign out, delete). */
type Confirm =
  | { kind: "disable"; user: AdminUser }
  | { kind: "admin"; user: AdminUser; on: boolean }
  | { kind: "signOut"; user: AdminUser }
  | { kind: "twoFactor"; user: AdminUser }
  | { kind: "delete"; user: AdminUser };

/** Making accounts: one per line, "username" or "username, email"; then each one's link, or that it was mailed. */
function AddAccountsDialog({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: () => void }) {
  const t = useT();
  const { language, info } = useApp();
  const [text, setText] = useState("");
  const [mail, setMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [made, setMade] = useState<MadeAccount[] | null>(null);
  const parsed = accountsToMake(text);
  const mailReady = info.selfServiceReset === true;
  const close = () => {
    setText("");
    setMade(null);
    setError(null);
    onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (parsed.problems.length > 0 || parsed.accounts.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setMade(await createAccounts(parsed.accounts, mail && mailReady, language));
      onMade();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="md" aria-labelledby="add-accounts-title">
      <Box component="form" onSubmit={(e) => void submit(e)} noValidate>
        <DialogTitle id="add-accounts-title">{t("accounts.addTitle")}</DialogTitle>
        <DialogContent>
          {made === null ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <DialogContentText>{t("accounts.addIntro")}</DialogContentText>
              <TextField
                label={t("accounts.addList")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                multiline
                minRows={5}
                placeholder={"maria, maria@example.org\njoao"}
                error={parsed.problems.length > 0}
                helperText={
                  parsed.problems.length > 0
                    ? parsed.problems.map((p) => t(`accounts.problem.${p.kind}`, { line: String(p.line), value: p.value })).join(" · ")
                    : t("accounts.addListHelp", { count: String(parsed.accounts.length) })
                }
                slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "none" } }}
              />
              <FormControlLabel
                control={<Checkbox checked={mail && mailReady} disabled={!mailReady} onChange={(e) => setMail(e.target.checked)} />}
                label={mailReady ? t("accounts.addMail") : t("accounts.addMailOff")}
              />
              <ErrorAlert error={error} />
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Alert severity="success" role="status">
                {t("accounts.addDone", { count: String(made.filter((m) => m.status === "created").length) })}
              </Alert>
              <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("accounts.col.account")}</TableCell>
                      <TableCell>{t("accounts.col.link")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {made.map((m) => (
                      <TableRow key={m.username}>
                        <TableCell component="th" scope="row" sx={{ fontWeight: 600, whiteSpace: "nowrap", verticalAlign: "top" }}>{m.username}</TableCell>
                        <TableCell>
                          {m.status === "taken" ? (
                            <Typography color="warning.main">{t("accounts.taken")}</Typography>
                          ) : m.mailed ? (
                            <Typography>{t("accounts.mailed")}</Typography>
                          ) : (
                            <Stack spacing={0.5}>
                              <CopyField value={m.setPasswordUrl ?? ""} label={t("accounts.linkFor", { name: m.username })} />
                              {m.expiresAt !== null && (
                                <Typography variant="caption" color="text.secondary">{t("accounts.linkUntil", { date: formatDate(m.expiresAt, language) })}</Typography>
                              )}
                            </Stack>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography variant="body2" color="text.secondary">{t("accounts.addNext")}</Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {made === null ? (
            <>
              <Button onClick={close} disabled={busy}>{t("common.cancel")}</Button>
              <Button type="submit" variant="contained" disabled={busy || parsed.accounts.length === 0 || parsed.problems.length > 0}>
                {t("accounts.addSubmit", { count: String(parsed.accounts.length) })}
              </Button>
            </>
          ) : (
            <Button onClick={close} variant="contained">{t("common.close")}</Button>
          )}
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/**
 * The Accounts section of the server page: every account, searched by name or address, filtered, sorted and in pages,
 * with when it was made and last active; each account's actions in its menu; new accounts; the list as CSV. How many
 * projects each account is in, never which ones (§4b).
 */
export function AccountsSection({ onAccountChanged }: { onAccountChanged: () => void }) {
  const t = useT();
  const { language, me } = useApp();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<AccountQuery>({ q: "", filter: "all", sort: "name", desc: false, page: 1, pageSize: PAGE_SIZE });
  // The search is asked a moment after the typing stops
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((q) => (q.q === search.trim() ? q : { ...q, q: search.trim(), page: 1 })), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const users = useLoad(() => listUsers(query), [query]);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; user: AdminUser } | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [typed, setTyped] = useState("");
  const [link, setLink] = useState<{ user: AdminUser; reset: ResetLink } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirmError, setConfirmError] = useState<ReactNode | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const n = (v: number) => formatNumber(v, language);

  const run = async (action: () => Promise<string>, inDialog = false) => {
    setBusy(true);
    setError(null);
    setConfirmError(null);
    setDone(null);
    try {
      setDone(await action());
      setConfirm(null);
      setTyped("");
      users.reload();
      onAccountChanged();
    } catch (err) {
      if (inDialog && err instanceof ApiError && err.code === "sole_coordinator") {
        const ids = Array.isArray(err.details.projectIds) ? (err.details.projectIds as string[]) : [];
        setConfirmError(
          <>
            {t("accounts.deleteSoleCoordinator")}
            <Box component="ul" sx={{ m: 0, pl: 2.5, fontFamily: "monospace", fontSize: "0.8rem" }}>{ids.map((id) => <li key={id}>{id}</li>)}</Box>
          </>,
        );
      } else if (inDialog) {
        setConfirmError(<ErrorAlert error={err} />);
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const act = (kind: Confirm["kind"] | "reset" | "enable" | "admin", user: AdminUser, on?: boolean) => {
    setMenu(null);
    if (kind === "reset") {
      void run(async () => {
        setLink({ user, reset: await makeResetLink(user.userId) });
        return "";
      });
    } else if (kind === "enable") {
      void run(async () => {
        await setUserDisabled(user.userId, false);
        return t("server.enabledNow", { name: user.username });
      });
    } else if (kind === "admin") {
      setConfirm({ kind: "admin", user, on: on === true });
    } else {
      setConfirm({ kind, user } as Confirm);
    }
  };

  const confirmed = () => {
    if (!confirm) return;
    const { user } = confirm;
    if (confirm.kind === "disable") {
      void run(async () => {
        await setUserDisabled(user.userId, true);
        return t("server.disabledNow", { name: user.username });
      }, true);
    } else if (confirm.kind === "admin") {
      void run(async () => {
        await setPlatformAdmin(user.userId, confirm.on);
        return t(confirm.on ? "accounts.adminMade" : "accounts.adminRemoved", { name: user.username });
      }, true);
    } else if (confirm.kind === "signOut") {
      void run(async () => {
        await signOutUser(user.userId);
        return t("accounts.signedOut", { name: user.username });
      }, true);
    } else if (confirm.kind === "twoFactor") {
      void run(async () => {
        await resetUserTwoFactor(user.userId);
        return t("server.twoFactorResetDone", { name: user.username });
      }, true);
    } else {
      void run(async () => {
        const { projectsDeleted } = await deleteUserAccount(user.userId, typed);
        return t(projectsDeleted > 0 ? "accounts.deletedWithProjects" : "accounts.deleted", { name: user.username, count: n(projectsDeleted) });
      }, true);
    }
  };

  const download = async () => {
    setError(null);
    try {
      const { blob, filename } = await downloadUsersCsv(query);
      saveBlob(blob, filename);
    } catch (err) {
      setError(err);
    }
  };

  const page = users.data;
  const own = (u: AdminUser) => u.userId === me?.userId;
  const confirmTexts: Record<Confirm["kind"], { title: string; text: string; go: string; color: "warning" | "error" | "primary" }> | null = confirm
    ? {
        disable: { title: t("server.disableTitle", { name: confirm.user.username }), text: t("server.disableText", { name: confirm.user.username }), go: t("server.disableConfirm"), color: "warning" },
        admin: confirm.kind === "admin" && confirm.on
          ? { title: t("accounts.makeAdminTitle", { name: confirm.user.username }), text: t("accounts.makeAdminText", { name: confirm.user.username }), go: t("accounts.makeAdmin"), color: "primary" }
          : { title: t("accounts.removeAdminTitle", { name: confirm.user.username }), text: t("accounts.removeAdminText", { name: confirm.user.username }), go: t("accounts.removeAdmin"), color: "warning" },
        signOut: { title: t("accounts.signOutTitle", { name: confirm.user.username }), text: t("accounts.signOutText", { name: confirm.user.username }), go: t("accounts.signOut"), color: "warning" },
        twoFactor: { title: t("server.twoFactorResetLabel", { name: confirm.user.username }), text: t("server.twoFactorResetConfirm", { name: confirm.user.username }), go: t("server.twoFactorReset"), color: "warning" },
        delete: { title: t("accounts.deleteTitle", { name: confirm.user.username }), text: t("accounts.deleteText", { name: confirm.user.username }), go: t("accounts.deleteConfirm"), color: "error" },
      }
    : null;
  const texts = confirm && confirmTexts ? confirmTexts[confirm.kind] : null;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="server-accounts">
      <Stack spacing={2}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ justifyContent: "space-between", alignItems: { sm: "center" } }}>
          <Typography variant="h2" id="server-accounts">{t("server.users")}</Typography>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<Download />} onClick={() => void download()}>{t("accounts.csv")}</Button>
            <Button variant="contained" startIcon={<PersonAdd />} onClick={() => setAdding(true)}>{t("accounts.add")}</Button>
          </Stack>
        </Stack>
        <Typography color="text.secondary" variant="body2">{t("server.privacy")}</Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "center" } }}>
          <TextField
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("accounts.search")}
            slotProps={{
              htmlInput: { "aria-label": t("accounts.search"), autoComplete: "off", spellCheck: false },
              input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> },
            }}
            sx={{ flex: 1, minWidth: 220 }}
          />
          <TextField select size="small" label={t("accounts.sortBy")} value={`${query.sort}:${query.desc}`}
            onChange={(e) => {
              const [sort, desc] = e.target.value.split(":");
              setQuery({ ...query, sort: sort as AccountSort, desc: desc === "true", page: 1 });
            }}
            sx={{ minWidth: 220 }}>
            {ACCOUNT_SORTS.flatMap((s) => [false, true].map((d) => (
              <MenuItem key={`${s}:${d}`} value={`${s}:${d}`}>{t(`accounts.sort.${s}.${d ? "desc" : "asc"}`)}</MenuItem>
            )))}
          </TextField>
        </Stack>
        <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }} role="group" aria-label={t("accounts.filters")}>
          {ACCOUNT_FILTERS.map((f) => (
            <Chip
              key={f}
              label={`${t(`accounts.filter.${f}`)} ${page ? n(page.counts[f]) : ""}`.trim()}
              color={query.filter === f ? "primary" : "default"}
              variant={query.filter === f ? "filled" : "outlined"}
              onClick={() => setQuery({ ...query, filter: f as AccountFilter, page: 1 })}
              aria-pressed={query.filter === f}
            />
          ))}
        </Stack>
        {done && <Alert severity="success" role="status" onClose={() => setDone(null)}>{done}</Alert>}
        <ErrorAlert error={error} />
        {users.loading && !page ? (
          <Loading />
        ) : users.error || !page ? (
          <ErrorAlert error={users.error} onRetry={users.reload} />
        ) : page.users.length === 0 ? (
          <EmptyState title={query.q || query.filter !== "all" ? t("accounts.none") : t("server.noUsers")} />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" role="status">
              {t("accounts.shown", { from: n((page.page - 1) * page.pageSize + 1), to: n((page.page - 1) * page.pageSize + page.users.length), total: n(page.total) })}
            </Typography>
            <List disablePadding sx={{ opacity: users.loading ? 0.6 : 1 }}>
              {page.users.map((user) => (
                <ListItem key={user.userId} divider sx={{ px: 0, gap: 1, alignItems: "flex-start" }}
                  secondaryAction={
                    <IconButton edge="end" aria-label={t("accounts.actionsFor", { name: user.username })} aria-haspopup="menu"
                      onClick={(e) => setMenu({ anchor: e.currentTarget, user })}>
                      <MoreVert />
                    </IconButton>
                  }>
                  <ListItemText
                    sx={{ pr: 6 }}
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
                        <Typography component="span" sx={{ fontWeight: 600, wordBreak: "break-word" }}>{user.username}</Typography>
                        {own(user) && <Chip size="small" variant="outlined" label={t("accounts.you")} />}
                        {user.isPlatformAdmin && <Chip size="small" color="primary" label={t("server.adminBadge")} />}
                        {user.disabledAt !== null && <Chip size="small" color="warning" icon={<Block />} label={t("server.disabledBadge")} />}
                        {user.twoFactor && <Chip size="small" variant="outlined" label={t("server.twoFactorBadge")} />}
                      </Stack>
                    }
                    secondary={
                      <>
                        {user.email ? `${user.email}${user.emailConfirmed ? "" : ` (${t("accounts.notConfirmed")})`}` : t("accounts.noEmail")}
                        {" · "}
                        {t(user.projects === 1 ? "server.userProjectsOne" : "server.userProjects", { count: user.projects, coordinated: user.coordinatedProjects })}
                        <br />
                        {user.createdAt !== null && t("accounts.created", { date: formatDay(user.createdAt, language) })}
                        {" · "}
                        {user.lastActiveAt === null ? t("accounts.neverActive") : t("accounts.lastActive", { when: sinceText(user.lastActiveAt, Date.now(), language) })}
                        {user.disabledAt !== null && (
                          <>
                            <br />
                            {user.disabledBy
                              ? t("server.disabledBy", { date: formatDate(user.disabledAt, language), name: user.disabledBy })
                              : t("server.disabledOn", { date: formatDate(user.disabledAt, language) })}
                          </>
                        )}
                      </>
                    }
                  />
                </ListItem>
              ))}
            </List>
            {page.pages > 1 && (
              <Pagination count={page.pages} page={page.page} onChange={(_, p) => setQuery({ ...query, page: p })} sx={{ alignSelf: "center" }}
                getItemAriaLabel={(type, p) => (type === "page" ? t("accounts.page", { page: String(p) }) : t(`accounts.pageNav.${type}`))} />
            )}
          </>
        )}
      </Stack>

      <Menu anchorEl={menu?.anchor} open={menu !== null} onClose={() => setMenu(null)}>
        {menu && [
          menu.user.disabledAt === null && (
            <MenuItem key="reset" onClick={() => act("reset", menu.user)}>
              <ListItemIcon><Key fontSize="small" /></ListItemIcon>{t("server.makeReset")}
            </MenuItem>
          ),
          !own(menu.user) && (
            <MenuItem key="admin" onClick={() => act("admin", menu.user, !menu.user.isPlatformAdmin)}>
              <ListItemIcon><AdminPanelSettings fontSize="small" /></ListItemIcon>{t(menu.user.isPlatformAdmin ? "accounts.removeAdmin" : "accounts.makeAdmin")}
            </MenuItem>
          ),
          menu.user.twoFactor && !own(menu.user) && (
            <MenuItem key="twoFactor" onClick={() => act("twoFactor", menu.user)}>
              <ListItemIcon><PhonelinkErase fontSize="small" /></ListItemIcon>{t("server.twoFactorReset")}
            </MenuItem>
          ),
          !own(menu.user) && (
            <MenuItem key="signOut" onClick={() => act("signOut", menu.user)}>
              <ListItemIcon><Logout fontSize="small" /></ListItemIcon>{t("accounts.signOut")}
            </MenuItem>
          ),
          !own(menu.user) && (menu.user.disabledAt === null ? (
            <MenuItem key="disable" onClick={() => act("disable", menu.user)}>
              <ListItemIcon><Block fontSize="small" /></ListItemIcon>{t("server.disable")}
            </MenuItem>
          ) : (
            <MenuItem key="enable" onClick={() => act("enable", menu.user)}>
              <ListItemIcon><CheckCircleOutline fontSize="small" /></ListItemIcon>{t("server.enable")}
            </MenuItem>
          )),
          !own(menu.user) && <Divider key="divider" />,
          !own(menu.user) && (
            <MenuItem key="delete" onClick={() => act("delete", menu.user)} sx={{ color: "error.main" }}>
              <ListItemIcon><DeleteOutline fontSize="small" color="error" /></ListItemIcon>{t("accounts.delete")}
            </MenuItem>
          ),
          own(menu.user) && (
            <MenuItem key="own" disabled>{t("accounts.ownHint")}</MenuItem>
          ),
        ].filter(Boolean)}
      </Menu>

      <Dialog open={confirm !== null} onClose={busy ? undefined : () => { setConfirm(null); setConfirmError(null); setTyped(""); }} fullWidth maxWidth="sm">
        {confirm && texts && (
          <Box component="form" onSubmit={(e) => { e.preventDefault(); confirmed(); }} noValidate>
            <DialogTitle>{texts.title}</DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                <DialogContentText>{texts.text}</DialogContentText>
                {confirm.kind === "delete" && (
                  <TextField label={t("accounts.deleteType", { name: confirm.user.username })} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus
                    slotProps={{ htmlInput: { autoComplete: "off", spellCheck: false, autoCapitalize: "none" } }} />
                )}
                {confirmError && <Alert severity="error">{confirmError}</Alert>}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => { setConfirm(null); setConfirmError(null); setTyped(""); }} disabled={busy}>{t("common.cancel")}</Button>
              <Button type="submit" variant="contained" color={texts.color} disabled={busy || (confirm.kind === "delete" && typed !== confirm.user.username)}>{texts.go}</Button>
            </DialogActions>
          </Box>
        )}
      </Dialog>

      <Dialog open={link !== null} onClose={() => setLink(null)} fullWidth maxWidth="sm">
        {link && (
          <>
            <DialogTitle>{t("server.resetTitle", { name: link.user.username })}</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ pt: 1 }}>
                {link.reset.mailed ? (
                  <DialogContentText>{t("server.resetMailed", { name: link.user.username })}</DialogContentText>
                ) : (
                  <>
                    <DialogContentText>
                      {link.reset.expiresAt !== null
                        ? t("server.resetText", { name: link.user.username, date: formatDate(link.reset.expiresAt, language) })
                        : t("server.resetTextNoDate", { name: link.user.username })}
                    </DialogContentText>
                    <CopyField value={link.reset.resetUrl ?? ""} label={t("server.resetLink")} />
                  </>
                )}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setLink(null)}>{t("common.close")}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <AddAccountsDialog open={adding} onClose={() => setAdding(false)} onMade={() => { users.reload(); onAccountChanged(); }} />
    </Paper>
  );
}
