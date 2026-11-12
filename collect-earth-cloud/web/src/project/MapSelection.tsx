import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useId, useMemo, useState } from "react";
import { listMembers, moveUnfinished, type Member } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { MoreInfo } from "../components/Explain";
import { sortPeople } from "../division";
import { formatNumber } from "../format";
import { useT, type MessageKey } from "../i18n";
import { addResult, givePlan, type GiveResult, type KeptCounts, type SelectionSummary } from "../mapSelectView";

const KEPT: [keyof KeptCounts, MessageKey][] = [
  ["submitted", "map.heading.selectKeptSubmitted"],
  ["reference", "map.heading.selectKeptReference"],
  ["wholeFile", "map.heading.selectKeptWhole"],
  ["severalFiles", "map.heading.selectKeptSeveral"],
  ["nobody", "map.heading.selectKeptNobody"],
];

/**
 * The plots selected on the map (coordinators): how many, those still to assess by person and plot
 * file, those that cannot be given and why, and giving them to someone (after a confirmation that
 * says the numbers): one moveUnfinished call per plot file and person, then the map is read again.
 */
export function MapSelection({ projectId, summary, onGiven }: { projectId: string; summary: SelectionSummary; onGiven: () => void }) {
  const t = useT();
  const { language } = useApp();
  const headingId = useId();
  const n = (value: number) => formatNumber(value, language);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [to, setTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string[] | null>(null);

  useEffect(() => {
    let stopped = false;
    listMembers(projectId).then(
      (list) => !stopped && setMembers(list),
      (e: unknown) => !stopped && setError(e),
    );
    return () => {
      stopped = true;
    };
  }, [projectId]);

  const people = useMemo(() => sortPeople((members ?? []).filter((m) => !m.disabled)), [members]);
  const userIdOf = useMemo(() => new Map((members ?? []).map((m) => [m.username, m.userId])), [members]);
  const target = people.find((m) => m.userId === to) ?? null;
  const plan = useMemo(() => (target ? givePlan(summary, target.username, userIdOf) : null), [summary, target, userIdOf]);

  const give = async () => {
    if (!plan || !target) return;
    setBusy(true);
    setError(null);
    let sum: GiveResult = { moved: 0, notMoved: 0, droppedChecks: 0, done: 0 };
    try {
      for (const move of plan.moves) {
        const result = await moveUnfinished(projectId, move.fileId, move.fromUserId, target.userId, { plots: move.plots });
        sum = addResult(sum, result);
      }
    } catch (e) {
      setError(e);
    } finally {
      const lines = [t("divide.moved", { count: n(sum.moved), to: target.username })];
      if (sum.notMoved > 0) lines.push(t("map.heading.selectKeptBack", { count: n(sum.notMoved), to: target.username }));
      if (sum.droppedChecks > 0) lines.push(t("divide.movedDropped", { count: n(sum.droppedChecks), to: target.username }));
      if (sum.done < plan.moves.length) lines.push(t("map.heading.selectStopped", { done: n(sum.done), total: n(plan.moves.length) }));
      setNotice(lines);
      setBusy(false);
      setConfirming(false);
      if (sum.done > 0) onGiven();
    }
  };

  return (
    <Paper variant="outlined" component="section" aria-labelledby={headingId} sx={{ p: 2 }}>
      <Typography variant="h3" id={headingId} sx={{ fontSize: "1.1rem", fontWeight: 500, mb: 1 }}>
        {t("map.heading.selectTitle")}
      </Typography>
      <Box role="status">
        <Typography variant="body2">
          {summary.total === 0 ? t("map.heading.selectNone") : t("map.heading.selectCount", { n: n(summary.total), left: n(summary.toAssess), movable: n(summary.movable) })}
        </Typography>
      </Box>
      {summary.movable > 0 && (
        <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap", mt: 1 }}>
          <Table size="small" sx={{ width: "auto", minWidth: 220 }} aria-label={t("map.heading.selectByPerson")}>
            <TableHead>
              <TableRow>
                <TableCell>{t("map.col.people")}</TableCell>
                <TableCell align="right">{t("map.heading.selectToAssess")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.byHolder.map((row) => (
                <TableRow key={row.holder}>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                    {row.holder}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {n(row.plots)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Table size="small" sx={{ width: "auto", minWidth: 220 }} aria-label={t("map.heading.selectByFile")}>
            <TableHead>
              <TableRow>
                <TableCell>{t("map.file")}</TableCell>
                <TableCell align="right">{t("map.heading.selectToAssess")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.byFile.map((row) => (
                <TableRow key={row.fileId}>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                    {row.filename}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {n(row.plots)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      {summary.keptTotal > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body2">
            {t("map.heading.selectKept", { n: n(summary.keptTotal) })}
            <MoreInfo text={t("map.heading.selectKeptMore")} />
          </Typography>
          <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 3 }}>
            {KEPT.filter(([k]) => summary.kept[k] > 0).map(([k, key]) => (
              <li key={k}>
                <Typography variant="body2">{t(key, { n: n(summary.kept[k]) })}</Typography>
              </li>
            ))}
          </Box>
        </Box>
      )}
      {summary.movable > 0 && (
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-start", mt: 2 }}>
          <TextField
            select
            size="small"
            label={t("map.heading.selectTo")}
            name="to"
            value={target ? to : ""}
            onChange={(e) => setTo(e.target.value)}
            disabled={members === null || busy}
            helperText={plan && plan.plots === 0 ? t("map.heading.selectAllTheirs", { to: target!.username }) : undefined}
            sx={{ width: { xs: 1, sm: 260 } }}
          >
            {people.map((m) => (
              <MenuItem key={m.userId} value={m.userId}>
                {m.username}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="contained" disabled={!plan || plan.plots === 0 || busy} onClick={() => setConfirming(true)}>
            {t("map.heading.selectGive")}
          </Button>
        </Box>
      )}
      <Box sx={{ mt: 1.5 }}>
        <ErrorAlert error={error} />
      </Box>
      {notice && (
        <Alert severity="success" role="status" sx={{ mt: 1.5 }} onClose={() => setNotice(null)}>
          {notice.map((line) => (
            <Box key={line}>{line}</Box>
          ))}
        </Alert>
      )}
      <Dialog open={confirming && plan !== null && target !== null} onClose={() => !busy && setConfirming(false)}>
        <DialogTitle>{plan && target && t("map.heading.selectConfirmTitle", { n: n(plan.plots), to: target.username })}</DialogTitle>
        <DialogContent>
          {plan && target && (
            <>
              <DialogContentText>
                {t("map.heading.selectConfirmText", {
                  n: n(plan.plots),
                  to: target.username,
                  from: plan.from.join(", "),
                  files: n(new Set(plan.moves.map((m) => m.fileId)).size),
                })}
              </DialogContentText>
              <DialogContentText sx={{ mt: 1 }}>{t("map.heading.selectConfirmStays", { submitted: n(summary.kept.submitted), other: n(summary.keptTotal - summary.kept.submitted) })}</DialogContentText>
              {plan.theirs > 0 && <DialogContentText sx={{ mt: 1 }}>{t("map.heading.selectConfirmTheirs", { n: n(plan.theirs), to: target.username })}</DialogContentText>}
              {plan.unknown > 0 && <DialogContentText sx={{ mt: 1 }}>{t("map.heading.selectConfirmGone", { n: n(plan.unknown) })}</DialogContentText>}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void give()} disabled={busy}>
            {t("map.heading.selectConfirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
