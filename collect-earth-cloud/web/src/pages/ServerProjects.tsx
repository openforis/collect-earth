import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
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
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Check from "@mui/icons-material/Check";
import ContentCopy from "@mui/icons-material/ContentCopy";
import Archive from "@mui/icons-material/ArchiveOutlined";
import MoreVert from "@mui/icons-material/MoreVert";
import PersonAdd from "@mui/icons-material/PersonAddAlt";
import Search from "@mui/icons-material/Search";
import Unarchive from "@mui/icons-material/UnarchiveOutlined";
import WarningAmber from "@mui/icons-material/WarningAmber";
import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  handProjectTo,
  listAdminProjects,
  PROJECT_FILTERS,
  PROJECT_SORTS,
  setProjectArchived,
  type AdminProject,
  type ProjectQuery,
  type ProjectSort,
} from "../api";
import { useApp } from "../appContext";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatBytes, formatDay, formatNumber } from "../format";
import { useT } from "../i18n";
import { chipsToShow, shortId, sinceText } from "../serverAccountsView";
import { useLoad } from "../useLoad";

const PAGE_SIZE = 25;

/** A project's id, short (its first 8 characters), with the whole id on hover and a button to copy it. */
function ProjectId({ id }: { id: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, or no permission): the whole id stays in the tooltip, to select by hand.
    }
  };
  return (
    <Stack direction="row" sx={{ alignItems: "center" }}>
      <Tooltip title={<Box component="span" sx={{ fontFamily: "monospace", wordBreak: "break-all" }}>{id}</Box>}>
        <Typography component="span" tabIndex={0} aria-label={id} sx={{ fontFamily: "monospace", fontSize: "0.9rem", fontWeight: 600, whiteSpace: "nowrap" }}>
          {shortId(id)}
        </Typography>
      </Tooltip>
      <Tooltip title={copied ? t("common.copied") : t("serverProjects.copyId")}>
        <IconButton size="small" aria-label={t("serverProjects.copyId")} onClick={() => void copy()} sx={{ ml: 0.25 }}>
          {copied ? <Check fontSize="inherit" /> : <ContentCopy fontSize="inherit" />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

type Pending = { kind: "archive" | "restore"; project: AdminProject } | { kind: "hand"; project: AdminProject };

/**
 * The Projects section's directory (GET /v1/admin/projects): every project by id only, searched, filtered (those needing
 * a coordinator first among the filters), ordered and in pages; each one archived or restored, or handed to a coordinator.
 */
export function ProjectsDirectory() {
  const t = useT();
  const { language } = useApp();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<ProjectQuery>({ q: "", filter: "all", sort: "lastActivity", desc: true, page: 1, pageSize: PAGE_SIZE });
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery((q) => (q.q === search.trim() ? q : { ...q, q: search.trim(), page: 1 })), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const projects = useLoad(["app", "listAdminProjects", query], () => listAdminProjects(query));
  const [menu, setMenu] = useState<{ anchor: HTMLElement; project: AdminProject } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const n = (v: number) => formatNumber(v, language);
  const page = projects.data;

  const open = (p: Pending) => {
    setMenu(null);
    setPending(p);
    setUsername("");
    setDialogError(null);
  };

  const confirm = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!pending) return;
    const { project } = pending;
    setBusy(true);
    setDialogError(null);
    try {
      if (pending.kind === "hand") {
        const handed = await handProjectTo(project.projectId, username.trim());
        setDone(t("serverProjects.handed", { name: handed.username, id: project.projectId }));
      } else {
        await setProjectArchived(project.projectId, pending.kind === "archive");
        setDone(t(pending.kind === "archive" ? "serverProjects.archived" : "serverProjects.restored", { id: project.projectId }));
      }
      setPending(null);
      projects.reload();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setDialogError(
        code === "no_such_account" ? t("serverProjects.noSuchAccount")
        : code === "already_coordinator" ? t("serverProjects.alreadyCoordinator")
        : code === "account_disabled" ? t("serverProjects.accountDisabled")
        : err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="server-projects-directory">
      <Stack spacing={2}>
        <Typography variant="h2" id="server-projects-directory">{t("serverProjects.title")}</Typography>
        <Typography color="text.secondary" variant="body2">{t("serverProjects.intro")}</Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: { md: "center" } }}>
          <TextField
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("serverProjects.search")}
            slotProps={{
              htmlInput: { "aria-label": t("serverProjects.search"), autoComplete: "off", spellCheck: false },
              input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> },
            }}
            sx={{ flex: 1, minWidth: 220 }}
          />
          <TextField select size="small" label={t("serverProjects.sortBy")} value={`${query.sort}:${query.desc}`}
            onChange={(e) => {
              const [sort, desc] = e.target.value.split(":");
              setQuery({ ...query, sort: sort as ProjectSort, desc: desc === "true", page: 1 });
            }}
            sx={{ minWidth: 220 }}>
            {PROJECT_SORTS.flatMap((s) => [true, false].map((d) => (
              <MenuItem key={`${s}:${d}`} value={`${s}:${d}`}>{t(`serverProjects.sort.${s}.${d ? "desc" : "asc"}`)}</MenuItem>
            )))}
          </TextField>
        </Stack>
        <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }} role="group" aria-label={t("serverProjects.filters")}>
          {chipsToShow(PROJECT_FILTERS, query.filter, page?.counts).map((f) => {
            const count = page?.counts[f];
            const warn = f === "noCoordinator" && (count ?? 0) > 0;
            return (
              <Chip
                key={f}
                icon={warn ? <WarningAmber /> : undefined}
                label={`${t(`serverProjects.filter.${f}`)} ${count !== undefined ? n(count) : ""}`.trim()}
                color={query.filter === f ? "primary" : warn ? "warning" : "default"}
                variant={query.filter === f ? "filled" : "outlined"}
                onClick={() => setQuery({ ...query, filter: f, page: 1 })}
                aria-pressed={query.filter === f}
              />
            );
          })}
        </Stack>
        {done && <Alert severity="success" role="status" onClose={() => setDone(null)}>{done}</Alert>}
        {projects.loading && !page ? (
          <Loading />
        ) : projects.error || !page ? (
          <ErrorAlert error={projects.error} onRetry={projects.reload} />
        ) : page.projects.length === 0 ? (
          <EmptyState title={query.q || query.filter !== "all" ? t("serverProjects.none") : t("serverProjects.empty")} />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" role="status">
              {t("serverProjects.shown", { from: n((page.page - 1) * page.pageSize + 1), to: n((page.page - 1) * page.pageSize + page.projects.length), total: n(page.total) })}
            </Typography>
            <List disablePadding sx={{ opacity: projects.loading ? 0.6 : 1 }}>
              {page.projects.map((p) => (
                <ListItem key={p.projectId} divider sx={{ px: 0, alignItems: "flex-start" }}
                  secondaryAction={
                    <IconButton edge="end" aria-label={t("serverProjects.actionsFor", { id: p.projectId })} aria-haspopup="menu"
                      onClick={(e) => setMenu({ anchor: e.currentTarget, project: p })}>
                      <MoreVert />
                    </IconButton>
                  }>
                  <ListItemText
                    sx={{ pr: 6 }}
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5 }}>
                        <Chip size="small" variant={p.status === "active" ? "filled" : "outlined"} color={p.status === "active" ? "success" : "default"}
                          label={t(`project.status.${p.status}`)} />
                        <ProjectId id={p.projectId} />
                        {p.needsCoordinator && (
                          <Tooltip title={t("serverProjects.needsCoordinatorHelp")}>
                            <Chip size="small" color="warning" icon={<WarningAmber />} label={t("serverProjects.needsCoordinator")} tabIndex={0} />
                          </Tooltip>
                        )}
                      </Stack>
                    }
                    secondary={
                      <>
                        {t(p.people === 1 ? "serverProjects.peopleOne" : "serverProjects.people", { count: n(p.people) })}
                        {" · "}
                        {p.coordinators === 0 ? t("serverProjects.noCoordinators") : t("serverProjects.coordinators", { total: n(p.coordinators), active: n(p.activeCoordinators) })}
                        {" · "}
                        {formatBytes(p.storageBytes, language)}
                        <br />
                        {t("serverProjects.created", { date: formatDay(p.createdAt, language) })}
                        {" · "}
                        {p.lastActivityAt === null ? t("serverProjects.neverActive") : t("serverProjects.lastActive", { when: sinceText(p.lastActivityAt, Date.now(), language) })}
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
          <MenuItem key="hand" onClick={() => open({ kind: "hand", project: menu.project })}>
            <ListItemIcon><PersonAdd fontSize="small" /></ListItemIcon>{t("serverProjects.hand")}
          </MenuItem>,
          menu.project.status === "archived" ? (
            <MenuItem key="restore" onClick={() => open({ kind: "restore", project: menu.project })}>
              <ListItemIcon><Unarchive fontSize="small" /></ListItemIcon>{t("serverProjects.restore")}
            </MenuItem>
          ) : (
            <MenuItem key="archive" onClick={() => open({ kind: "archive", project: menu.project })}>
              <ListItemIcon><Archive fontSize="small" /></ListItemIcon>{t("serverProjects.archive")}
            </MenuItem>
          ),
        ]}
      </Menu>

      <Dialog open={pending !== null} onClose={() => !busy && setPending(null)} aria-labelledby="server-project-dialog" fullWidth maxWidth="sm">
        {pending && (
          <form onSubmit={(e) => void confirm(e)}>
            <DialogTitle id="server-project-dialog" sx={{ wordBreak: "break-all" }}>
              {pending.kind === "hand"
                ? t("serverProjects.handTitle", { id: pending.project.projectId })
                : t(pending.kind === "archive" ? "serverProjects.archiveTitle" : "serverProjects.restoreTitle", { id: pending.project.projectId })}
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                <DialogContentText>
                  {pending.kind === "hand" ? t("serverProjects.handText") : t(pending.kind === "archive" ? "serverProjects.archiveText" : "serverProjects.restoreText")}
                </DialogContentText>
                {pending.kind === "hand" && (
                  <TextField autoFocus required label={t("serverProjects.username")} value={username} onChange={(e) => setUsername(e.target.value)}
                    slotProps={{ htmlInput: { autoComplete: "off", spellCheck: false, maxLength: 64 } }} />
                )}
                {dialogError && <Alert severity="error">{dialogError}</Alert>}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setPending(null)} disabled={busy}>{t("common.cancel")}</Button>
              <Button type="submit" variant="contained" color={pending.kind === "archive" ? "warning" : "primary"}
                disabled={busy || (pending.kind === "hand" && username.trim() === "")}>
                {pending.kind === "hand" ? t("serverProjects.handGo") : t(pending.kind === "archive" ? "serverProjects.archive" : "serverProjects.restore")}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>
    </Paper>
  );
}
