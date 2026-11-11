import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import Check from "@mui/icons-material/Check";
import Dns from "@mui/icons-material/Dns";
import EditLocationAlt from "@mui/icons-material/EditLocationAltOutlined";
import ManageAccounts from "@mui/icons-material/ManageAccountsOutlined";
import RateReview from "@mui/icons-material/RateReviewOutlined";
import Remove from "@mui/icons-material/Remove";
import { useState, type ReactElement, type ReactNode } from "react";
import type { Role } from "../api";
import { useApp, useLocalMode } from "../appContext";
import { useT, type MessageKey } from "../i18n";
import { linkProps } from "../router";

/** The roles, most powerful first, as the table shows them. */
export const ROLE_ORDER: readonly Role[] = ["admin", "reviewer", "operator"];

const ROLE_ICONS: Record<Role, ReactElement> = {
  admin: <ManageAccounts />,
  reviewer: <RateReview />,
  operator: <EditLocationAlt />,
};

/** A cell of the table: allowed, not allowed, or a short text saying how. */
export type RoleCell = "yes" | "no" | MessageKey;

/**
 * What each role can do in a project, as the server enforces it: requireProjectMembership's minimum role on each route
 * (src/routes/*.ts) and the routes' own role checks (reviewers: no figures per person, not their own plots, no reference
 * plot named; collectors: their own records only).
 */
export const ROLE_MATRIX: readonly { what: MessageKey; cells: Record<Role, RoleCell> }[] = [
  // a coordinator collects the plots they give themselves (a whole plot file or a share of a divided one)
  { what: "roles.row.collect", cells: { admin: "roles.cell.collectSelf", reviewer: "yes", operator: "yes" } },
  { what: "roles.row.progress", cells: { admin: "roles.cell.everyone", reviewer: "roles.cell.team", operator: "roles.cell.ownWork" } },
  { what: "roles.row.analysis", cells: { admin: "roles.cell.allPlots", reviewer: "roles.cell.allPlots", operator: "roles.cell.ownPlots" } },
  { what: "roles.row.areas", cells: { admin: "yes", reviewer: "roles.cell.lookOnly", operator: "no" } },
  { what: "roles.row.review", cells: { admin: "roles.cell.decideAll", reviewer: "roles.cell.decideOthers", operator: "no" } },
  { what: "roles.row.quality", cells: { admin: "roles.cell.everyone", reviewer: "roles.cell.team", operator: "roles.cell.ownQuality" } },
  {
    what: "roles.row.reference",
    cells: { admin: "roles.cell.referenceAdmin", reviewer: "roles.cell.referenceReviewer", operator: "roles.cell.referenceCollector" },
  },
  {
    what: "roles.row.training",
    cells: { admin: "roles.cell.trainingAdmin", reviewer: "roles.cell.trainingReviewer", operator: "roles.cell.trainingCollector" },
  },
  { what: "roles.row.plots", cells: { admin: "yes", reviewer: "no", operator: "no" } },
  { what: "roles.row.projectFile", cells: { admin: "yes", reviewer: "no", operator: "no" } },
  { what: "roles.row.people", cells: { admin: "yes", reviewer: "no", operator: "no" } },
  { what: "roles.row.data", cells: { admin: "yes", reviewer: "no", operator: "no" } },
  { what: "roles.row.settings", cells: { admin: "yes", reviewer: "no", operator: "no" } },
];

function CellText({ cell }: { cell: RoleCell }) {
  const t = useT();
  if (cell === "yes") return <Check fontSize="small" color="success" titleAccess={t("common.yes")} />;
  if (cell === "no") return <Remove fontSize="small" sx={{ color: "text.disabled" }} titleAccess={t("common.no")} />;
  return <>{t(cell)}</>;
}

/** The roles side by side, row by row; `role`: the reader's own, whose column is marked. */
export function RolesTable({ role }: { role?: Role }) {
  const t = useT();
  const mine = { bgcolor: (theme: { palette: { primary: { main: string } } }) => alpha(theme.palette.primary.main, 0.07) };
  return (
    <TableContainer>
      <Table size="small" aria-label={t("roles.title")} sx={{ "& .MuiTableCell-root": { px: { xs: 1, sm: 2 } } }}>
        <TableHead>
          <TableRow>
            <TableCell>{t("roles.col.what")}</TableCell>
            {ROLE_ORDER.map((r) => (
              <TableCell key={r} sx={{ fontWeight: 600, ...(r === role ? mine : {}) }}>
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, "& svg": { fontSize: "1.1rem" } }}>
                  {ROLE_ICONS[r]}
                  {r === role ? t("roles.youColumn", { role: t(`role.${r}`) }) : t(`role.${r}`)}
                </Box>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {ROLE_MATRIX.map((row) => (
            <TableRow key={row.what}>
              <TableCell component="th" scope="row">
                {t(row.what)}
              </TableCell>
              {ROLE_ORDER.map((r) => (
                <TableCell key={r} sx={r === role ? mine : undefined}>
                  <CellText cell={row.cells[r]} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/** "What can each role do?": the table, what counts whatever the role, and the server administrators apart. */
export function RolesContent({ role }: { role?: Role }) {
  const t = useT();
  return (
    <Stack spacing={2}>
      <Typography>{t("roles.intro")}</Typography>
      <RolesTable role={role} />
      <Typography variant="body2" color="text.secondary">
        {t("roles.note.work")}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t("roles.note.checks")}
      </Typography>
      <Box>
        <Typography variant="h3" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Dns fontSize="small" aria-hidden />
          {t("server.adminBadge")}
        </Typography>
        <Typography variant="body2">{t("roles.server.text")}</Typography>
      </Box>
    </Stack>
  );
}

export function RolesDialog({ role, onClose }: { role?: Role; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      scroll="paper"
      aria-labelledby="roles-title"
      // a phone keeps all its width for the table (which scrolls sideways if it must)
      sx={{ "& .MuiDialog-paper": { m: { xs: 1, sm: 4 }, width: { xs: "calc(100% - 16px)", sm: "calc(100% - 64px)" }, maxHeight: { xs: "calc(100% - 16px)", sm: "calc(100% - 64px)" } } }}
    >
      <DialogTitle id="roles-title">{t("roles.title")}</DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 1.5, sm: 3 } }}>
        <RolesContent role={role} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** A "What can each role do?" link (inline, so it fits in a helper text), opening the dialog. */
export function RolesLink({ role }: { role?: Role }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Link component="button" type="button" variant="inherit" onClick={() => setOpen(true)} aria-haspopup="dialog" sx={{ verticalAlign: "baseline" }}>
        {t("roles.title")}
      </Link>
      {open && <RolesDialog role={role} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A small chip that opens a short note, which ends with the "What can each role do?" link. */
function NoteChip({ icon, label, ariaLabel, role, children, sx }: { icon: ReactElement; label: string; ariaLabel: string; role?: Role; children: ReactNode; sx?: object }) {
  const t = useT();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [roles, setRoles] = useState(false);
  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        color="primary"
        icon={icon}
        label={label}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={sx}
      />
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { sx: { p: 2, maxWidth: 360 } } }}
      >
        <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
          {children}
          <Link
            component="button"
            type="button"
            variant="body2"
            onClick={() => {
              setAnchor(null);
              setRoles(true);
            }}
          >
            {t("roles.title")}
          </Link>
        </Stack>
      </Popover>
      {roles && <RolesDialog role={role} onClose={() => setRoles(false)} />}
    </>
  );
}

/** The reader's role in a project, as a static chip (inside a link: the projects list). */
export function RoleBadge({ role }: { role: Role }) {
  const t = useT();
  return <Chip size="small" icon={ROLE_ICONS[role]} label={t("roles.you", { role: t(`role.${role}`) })} color={role === "admin" ? "primary" : "default"} />;
}

/**
 * "You: Coordinator" in a project's header, opening what the role means. None in the local mode (one person, no
 * accounts or roles: the desktop's own data).
 */
export function RoleChip({ role }: { role: Role }) {
  const t = useT();
  const { me } = useApp();
  const local = useLocalMode();
  if (local) return null;
  const name = t(`role.${role}`);
  return (
    <NoteChip icon={ROLE_ICONS[role]} label={t("roles.you", { role: name })} ariaLabel={t("roles.youLabel", { role: name })} role={role}>
      <Typography variant="subtitle2">{t("roles.youLabel", { role: name })}</Typography>
      <Typography variant="body2">{t(`role.${role}.help`)}</Typography>
      {me?.isPlatformAdmin && (
        <Typography variant="body2" color="text.secondary">
          {t("roles.serverAdminHere")}
        </Typography>
      )}
    </NoteChip>
  );
}

/** "Server administrator" in the app bar, for the server's administrators (never in the local mode). */
export function ServerAdminChip({ sx }: { sx?: object }) {
  const t = useT();
  const { me } = useApp();
  const local = useLocalMode();
  if (local || !me?.isPlatformAdmin) return null;
  return (
    <NoteChip icon={<Dns />} label={t("server.adminBadge")} ariaLabel={t("server.adminBadge")} sx={sx}>
      <Typography variant="body2">{t("serverAdmin.note")}</Typography>
      <Link {...linkProps("/server")} variant="body2">
        {t("serverAdmin.open")}
      </Link>
    </NoteChip>
  );
}
