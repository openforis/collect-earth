import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { getPerson, moveUnfinished, type PersonRow } from "../api";
import { useApp } from "../appContext";
import { movedText } from "../division";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { fileLeft, finishPhrase, moveCount, sortWorkload, workloadOf } from "../peopleView";
import { browserTimeZone, dayText } from "../progressView";
import { useLoad } from "../useLoad";
import { ErrorAlert } from "./ErrorAlert";
import { MoreInfo } from "./Explain";
import { Loading } from "./Loading";

/**
 * "Move plots…" from a person's row of the workload board: one of their plot files (with what they have left in
 * each), how many plots (a number, or all of them) and to whom (with what each has left); then a confirmation with
 * the numbers before anything changes. Mounted while open: it loads the person's files when it opens.
 */
export function MovePlotsDialog({
  projectId,
  from,
  people,
  today,
  onClose,
  onMoved,
}: {
  projectId: string;
  from: PersonRow;
  /** The project's people (the board's rows), to give plots to. */
  people: readonly PersonRow[];
  today: string;
  onClose: () => void;
  /** After a move: what happened, in words (the caller reloads). */
  onMoved: (message: string) => void;
}) {
  const t = useT();
  const { language } = useApp();
  const n = (v: number) => formatNumber(v, language);
  const day = (date: string) => dayText(date, language);
  const timeZone = browserTimeZone();
  const person = useLoad(["project", projectId, "getPerson", from.userId, timeZone], () => getPerson(projectId, from.userId, timeZone));
  const files = (person.data?.files ?? []).filter((f) => fileLeft(f) > 0);
  const others = sortWorkload(
    people.filter((p) => p.userId !== from.userId && p.status.kind !== "disabled").map((p) => workloadOf(p, today)),
    "finish",
    "asc",
  );
  const [fileId, setFileId] = useState("");
  const [all, setAll] = useState(false);
  const [countText, setCountText] = useState("");
  const [toId, setToId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // The first file is chosen once they are loaded, with half of its plots left.
  const file = files.find((f) => f.csvFileId === fileId) ?? files[0] ?? null;
  const left = file ? fileLeft(file) : 0;
  const shownCount = file && fileId !== file.csvFileId ? String(Math.ceil(left / 2)) : countText;
  const count = all ? left : moveCount(shownCount, left);
  const to = others.find((w) => w.userId === toId) ?? null;
  const toRow = people.find((p) => p.userId === toId) ?? null;
  const ready = file !== null && to !== null && count !== null;

  const chooseFile = (id: string) => {
    const f = files.find((x) => x.csvFileId === id);
    setFileId(id);
    setCountText(f ? String(Math.ceil(fileLeft(f) / 2)) : "");
  };
  const typeCount = (value: string) => {
    if (file && fileId !== file.csvFileId) setFileId(file.csvFileId);
    setCountText(value);
  };

  const move = async () => {
    if (!ready || !file || !to) return;
    setBusy(true);
    setError(null);
    try {
      const result = await moveUnfinished(projectId, file.csvFileId, from.userId, to.userId, all ? {} : { count: count as number });
      onMoved(movedText(t, result, from.username, to.username, language));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const fromAfter = workloadOf(from, today, Math.max(0, from.plots.remaining - (count ?? 0)));
  const toAfter = toRow ? workloadOf(toRow, today, toRow.plots.remaining + (count ?? 0)) : null;

  return (
    <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="sm" aria-labelledby="move-plots-title">
      {!confirming ? (
        <>
          <DialogTitle id="move-plots-title">{t("divide.moveButton.dialogTitle", { from: from.username })}</DialogTitle>
          <DialogContent>
            {person.loading && !person.data ? (
              <Loading />
            ) : !person.data ? (
              <ErrorAlert error={person.error} onRetry={person.reload} />
            ) : files.length === 0 ? (
              <Alert severity="info">{t("divide.moveButton.noFiles", { from: from.username })}</Alert>
            ) : others.length === 0 ? (
              <Alert severity="info">{t("divide.moveButton.noOthers")}</Alert>
            ) : (
              <Stack spacing={2.5} sx={{ pt: 0.5 }}>
                <DialogContentText>{t("divide.moveButton.dialogIntro", { from: from.username, left: n(from.plots.remaining) })}</DialogContentText>
                <FormControl fullWidth>
                  <InputLabel id="move-plots-file">{t("divide.moveButton.file")}</InputLabel>
                  <Select labelId="move-plots-file" label={t("divide.moveButton.file")} value={file?.csvFileId ?? ""} onChange={(e) => chooseFile(e.target.value)}>
                    {files.map((f) => (
                      <MenuItem key={f.csvFileId} value={f.csvFileId} sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                        {t("divide.moveButton.fileOption", { file: f.filename, n: n(fileLeft(f)) })}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl>
                  <FormLabel id="move-plots-how-many">{t("divide.moveButton.howMany")}</FormLabel>
                  <RadioGroup aria-labelledby="move-plots-how-many" value={all ? "all" : "some"} onChange={(e) => setAll(e.target.value === "all")}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
                      <FormControlLabel value="some" control={<Radio />} label={t("divide.moveButton.some")} sx={{ mt: { sm: 1 } }} />
                      <TextField
                        size="small"
                        label={t("divide.moveButton.count")}
                        value={all ? String(left) : shownCount}
                        disabled={all}
                        onChange={(e) => typeCount(e.target.value)}
                        error={!all && count === null}
                        helperText={!all && count === null ? t("divide.moveButton.countBad", { max: n(left) }) : t("divide.moveButton.countHelp", { max: n(left) })}
                        slotProps={{ htmlInput: { inputMode: "numeric", min: 1, max: left } }}
                        sx={{ maxWidth: { sm: 260 } }}
                      />
                    </Stack>
                    <FormControlLabel value="all" control={<Radio />} label={t("divide.moveButton.all", { n: n(left) })} />
                  </RadioGroup>
                </FormControl>
                <FormControl fullWidth>
                  <InputLabel id="move-plots-to">{t("divide.moveButton.to")}</InputLabel>
                  <Select labelId="move-plots-to" label={t("divide.moveButton.to")} value={toId} onChange={(e) => setToId(e.target.value)}>
                    {others.map((w) => (
                      <MenuItem key={w.userId} value={w.userId} sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>
                        {t("divide.moveButton.toOption", { name: w.username, n: n(w.left), finish: finishPhrase(t, w, day) })}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button variant="contained" disabled={!ready} onClick={() => setConfirming(true)}>
              {t("divide.moveButton.next")}
            </Button>
          </DialogActions>
        </>
      ) : (
        file &&
        to &&
        toAfter && (
          <>
            <DialogTitle id="move-plots-title">{t("divide.moveButton.confirmTitle", { from: from.username, to: to.username })}</DialogTitle>
            <DialogContent>
              <Stack spacing={1.5}>
                <DialogContentText>
                  {all
                    ? t("divide.moveButton.confirmAll", { from: from.username, to: to.username, left: n(left), file: file.filename })
                    : t("divide.moveButton.confirmCount", { from: from.username, to: to.username, left: n(left), count: n(count ?? 0), file: file.filename })}
                </DialogContentText>
                <DialogContentText>
                  {t("divide.moveButton.confirmAfter", {
                    from: from.username,
                    fromLeft: n(fromAfter.left),
                    fromFinish: finishPhrase(t, fromAfter, day),
                    to: to.username,
                    toLeft: n(toAfter.left),
                    toFinish: finishPhrase(t, toAfter, day),
                  })}
                </DialogContentText>
                <DialogContentText>
                  {t("divide.moveButton.confirmStay", { from: from.username, to: to.username })}
                  <MoreInfo text={t("divide.moveText", { from: from.username, to: to.username })} />
                </DialogContentText>
                {!file.divided && <DialogContentText>{t("person.moveWhole", { file: file.filename })}</DialogContentText>}
                <ErrorAlert error={error} />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirming(false)} disabled={busy}>
                {t("divide.moveButton.back")}
              </Button>
              <Button variant="contained" onClick={() => void move()} disabled={busy}>
                {t("divide.move")}
              </Button>
            </DialogActions>
          </>
        )
      )}
    </Dialog>
  );
}
