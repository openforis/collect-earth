import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { ApiError, getPeople, rebalance, type DistributionSummary, type Member, type PersonRow, type RebalancePlan } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { browserTimeZone } from "../progressView";
import {
  holdersOf,
  initialShareForm,
  moveLines,
  paceText,
  pacesOf,
  percentSum,
  planRows,
  shareCandidates,
  sharedText,
  shareRequest,
  toggleChosen,
  type ShareForm,
  type ShareHow,
} from "../rebalanceView";

// "Share again what is left" on a divided plot file's page: the people ticked share the plots not submitted yet,
// equally, by percentage or by pace. Preview shows the plan (nothing saved), Apply asks first, then moves the plots.

interface Preview {
  plan: RebalancePlan;
  /** The request and the division it was made for: a change to either drops it. */
  key: string;
  state: DistributionSummary;
}

export function RebalanceCard({
  projectId,
  fileId,
  members,
  current,
  onApplied,
}: {
  projectId: string;
  fileId: string;
  members: Member[];
  current: DistributionSummary;
  onApplied: (state: DistributionSummary) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const people = useMemo(() => shareCandidates(members, current), [members, current]);
  const names = useMemo(() => new Map([...current.people.map((p) => [p.userId, p.username] as const), ...members.map((m) => [m.userId, m.username] as const)]), [members, current]);
  const [form, setForm] = useState<ShareForm>(() => initialShareForm(members, current));
  // The People tab's rows, for the pace (loaded when "By pace" is first chosen).
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [rowsError, setRowsError] = useState<unknown>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problemShown, setProblemShown] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  // The division a 409 answered for (the file was made whole meanwhile).
  const [wholeFor, setWholeFor] = useState<DistributionSummary | null>(null);
  const [paceTry, setPaceTry] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (form.how !== "pace" || rows !== null) return;
    let live = true;
    setRowsError(null);
    getPeople(projectId, browserTimeZone()).then(
      (data) => live && setRows(data.people),
      (err: unknown) => live && setRowsError(err),
    );
    return () => {
      live = false;
    };
  }, [form.how, rows, projectId, paceTry]);

  if (current.distribution === null || wholeFor === current) {
    return <Typography color="text.secondary">{t("divide.move.shareWhole")}</Typography>;
  }

  const holders = holdersOf(current);
  const paces = rows ? pacesOf(form.chosen, rows) : null;
  const paceWaiting = form.how === "pace" && rows === null;
  const request = paceWaiting ? null : shareRequest(form, holders, paces);
  const requestKey = request?.people ? JSON.stringify(request.people) : null;
  const shown = preview && preview.key === requestKey && preview.state === current ? preview : null;

  const change = (next: ShareForm) => {
    setForm(next);
    setNotice(null);
    setError(null);
    setProblemShown(false);
  };

  const failed = (err: unknown) => {
    // The file was made whole meanwhile: nothing to share (the page shows the note).
    if (err instanceof ApiError && err.status === 409) setWholeFor(current);
    else setError(err);
  };

  /** Preview: the plan only. `thenConfirm`: Apply's first step when there is no preview of this request yet. */
  const showPlan = async (thenConfirm: boolean) => {
    setNotice(null);
    setError(null);
    if (!request?.people || !requestKey) {
      setProblemShown(true);
      return;
    }
    if (thenConfirm && shown) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const plan = await rebalance(projectId, fileId, request.people, true);
      setPreview({ plan, key: requestKey, state: current });
      if (thenConfirm) setConfirming(true);
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!request?.people) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rebalance(projectId, fileId, request.people, false);
      setPreview(null);
      if (result.saved) {
        setNotice(sharedText(t, result, language));
        onApplied({ distribution: result.distribution, plotCount: result.plotCount, unassigned: result.unassigned, people: result.people });
      }
    } catch (err) {
      failed(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const ways: { id: ShareHow; label: string; help: string }[] = [
    { id: "equal", label: t("divide.move.shareEqual"), help: t("divide.move.shareEqualHelp") },
    { id: "percent", label: t("divide.move.sharePercent"), help: t("divide.move.sharePercentHelp") },
    { id: "pace", label: t("divide.move.sharePace"), help: t("divide.move.sharePaceHelp") },
  ];
  const order = people.map((p) => p.userId);
  const lines = shown ? moveLines(t, shown.plan, names, language) : [];
  const moving = shown ? shown.plan.moves.reduce((sum, m) => sum + m.count, 0) : 0;
  const problem = problemShown && request?.problem ? request.problem : null;

  return (
    <Stack spacing={3}>
      <Explain text={t("divide.move.shareIntro.short")} more={t("divide.move.shareIntro")} />

      <FormControl>
        <FormLabel id="share-how">{t("divide.move.shareHow")}</FormLabel>
        <RadioGroup aria-labelledby="share-how" value={form.how} onChange={(e) => change({ ...form, how: e.target.value as ShareHow })}>
          {ways.map((way) => (
            <FormControlLabel
              key={way.id}
              value={way.id}
              control={<Radio />}
              sx={{ alignItems: "flex-start", mt: 1, "& .MuiRadio-root": { pt: 0.5 } }}
              label={
                <span>
                  {way.label}
                  <Typography variant="body2" color="text.secondary" component="span" sx={{ display: "block" }}>
                    {way.help}
                  </Typography>
                </span>
              }
            />
          ))}
        </RadioGroup>
      </FormControl>

      <FormControl component="fieldset" variant="standard">
        <FormLabel component="legend">{t("divide.move.sharePeople")}</FormLabel>
        <FormHelperText sx={{ mt: 0, mb: 1 }}>{t("divide.move.sharePeopleHelp")}</FormHelperText>
        <Stack spacing={1}>
          {people.map((person) => {
            const ticked = form.chosen.includes(person.userId);
            const pace = form.how === "pace" && ticked && paces ? paceText(t, paces.get(person.userId), language) : "";
            return (
              <Stack key={person.userId} direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 2 }} sx={{ alignItems: { sm: "center" } }}>
                <FormControlLabel
                  control={<Checkbox checked={ticked} onChange={() => change(toggleChosen(form, person.userId))} />}
                  label={
                    <span>
                      {`${person.username} (${t(`role.${person.role}`)}${person.disabled ? `, ${t("checks.disabled")}` : ""})`}
                      {pace && (
                        <Typography variant="body2" color="text.secondary" component="span" sx={{ display: "block" }}>
                          {pace}
                        </Typography>
                      )}
                    </span>
                  }
                  sx={{ wordBreak: "break-word", mr: 0, flex: { sm: "1 1 auto" } }}
                />
                {form.how === "percent" && ticked && (
                  <TextField
                    label={t("divide.percentOf", { name: person.username })}
                    type="number"
                    size="small"
                    value={form.percents[person.userId] ?? ""}
                    onChange={(e) => change({ ...form, percents: { ...form.percents, [person.userId]: e.target.value } })}
                    slotProps={{ htmlInput: { min: 0, max: 100, inputMode: "numeric" } }}
                    sx={{ width: { xs: "100%", sm: 220 }, flexShrink: 0, ml: { xs: 4, sm: 0 } }}
                  />
                )}
              </Stack>
            );
          })}
        </Stack>
        {form.how === "percent" && (
          <Typography variant="body2" color={percentSum(form) === 100 ? "text.secondary" : "warning.main"} role="status" sx={{ mt: 1.5 }}>
            {t("divide.percentsTotal", { total: formatNumber(percentSum(form), language) })}
          </Typography>
        )}
        {paceWaiting && !rowsError && (
          <Typography variant="body2" color="text.secondary" role="status" sx={{ mt: 1.5 }}>
            {t("divide.move.sharePaceLoading")}
          </Typography>
        )}
      </FormControl>
      {form.how === "pace" && <ErrorAlert error={rowsError} onRetry={() => setPaceTry((n) => n + 1)} />}

      {problem && (
        <Alert severity="warning" role="alert">
          {t(problem)}
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button variant="outlined" onClick={() => void showPlan(false)} disabled={busy || paceWaiting}>
          {t("divide.preview")}
        </Button>
        <Button variant="contained" onClick={() => void showPlan(true)} disabled={busy || paceWaiting}>
          {t("divide.apply")}
        </Button>
      </Stack>
      <ErrorAlert error={error} />
      {notice && (
        <Alert severity="success" role="status">
          {notice}
        </Alert>
      )}

      {shown && (
        <Box>
          <Typography variant="h3" gutterBottom>
            {t("divide.move.sharePreviewTitle")}
          </Typography>
          <Stack spacing={1.5} role="status">
            <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("divide.person")}</TableCell>
                    <TableCell align="right">{t("divide.move.shareLeftNow")}</TableCell>
                    <TableCell align="right">{t("divide.move.shareLeftAfter")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {planRows(shown.plan, names, order).map((row) => (
                    <TableRow key={row.userId}>
                      <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
                        {row.name}
                      </TableCell>
                      <TableCell align="right">{formatNumber(row.before, language)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: row.after !== row.before ? 600 : undefined }}>
                        {formatNumber(row.after, language)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {lines.length === 0 ? (
              <Typography color="text.secondary">{t("divide.move.shareNothing")}</Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 3 }}>
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </Box>
            )}
          </Stack>
        </Box>
      )}

      <Dialog open={confirming && shown !== null} onClose={() => !busy && setConfirming(false)}>
        <DialogTitle>{t("divide.move.shareConfirmTitle")}</DialogTitle>
        <DialogContent>
          {lines.length === 0 ? (
            <DialogContentText>{t("divide.move.shareNothing")}</DialogContentText>
          ) : (
            <>
              <Box component="ul" sx={{ mt: 0, pl: 3 }}>
                {lines.map((line) => (
                  <li key={line}>
                    <Typography>{line}</Typography>
                  </li>
                ))}
              </Box>
              <DialogContentText>{t("divide.move.shareConfirmText")}</DialogContentText>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="contained" onClick={() => void apply()} disabled={busy || moving === 0}>
            {t("divide.move")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
