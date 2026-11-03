import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Add from "@mui/icons-material/Add";
import { useState } from "react";
import { createGuidanceNote, deleteGuidanceNote, updateGuidanceNote, type AnswerOptions, type GuidanceNote, type GuidanceNoteInput, type QualityData } from "../api";
import { ErrorAlert } from "../components/ErrorAlert";
import { useT } from "../i18n";
import { answerText, labelMap, labelsOf, withQuestionLabels } from "../qualityView";

/** A note being written: a new one (no id) or an existing one. */
export type NoteDraft = GuidanceNoteInput & { id?: string };

const MAX_NOTE = 2000;

/** What a note is about: the question and, for a mix-up, "first → check" (answers by their label). */
function NoteAbout({ note, label, options }: { note: GuidanceNoteInput; label: (key: string) => string; options: AnswerOptions }) {
  const t = useT();
  const pair = note.firstValue !== null || note.checkValue !== null;
  const answer = (value: string | null) => (value === null ? t("quality.anyAnswer") : answerText(t, note.questionKey, value, options));
  return (
    <Typography sx={{ fontWeight: 500, wordBreak: "break-word" }}>
      {label(note.questionKey)}
      {pair && (
        <Box component="span" sx={{ fontWeight: 400, color: "text.secondary" }}>
          {" · "}
          {t("quality.noteAbout", { first: answer(note.firstValue), check: answer(note.checkValue) })}
        </Box>
      )}
    </Typography>
  );
}

/** Writes a new note or changes one: the question, optionally the two answers, and the text. */
export function NoteDialog({
  projectId,
  data,
  draft,
  onClose,
  onSaved,
}: {
  projectId: string;
  data: QualityData;
  draft: NoteDraft;
  onClose: () => void;
  onSaved: (note: GuidanceNote) => void;
}) {
  const t = useT();
  const label = labelMap(data.questions);
  const [questionKey, setQuestionKey] = useState(draft.questionKey || data.questions[0]?.key || "");
  const [firstValue, setFirstValue] = useState(draft.firstValue ?? "");
  const [checkValue, setCheckValue] = useState(draft.checkValue ?? "");
  const [text, setText] = useState(draft.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // The questions of the figures, plus the note's own when the figures no longer list it.
  const keys = data.questions.map((q) => q.key);
  if (questionKey && !keys.includes(questionKey)) keys.unshift(questionKey);
  const ready = questionKey !== "" && text.trim() !== "" && text.trim().length <= MAX_NOTE;

  const save = async () => {
    setBusy(true);
    setError(null);
    const input: GuidanceNoteInput = {
      questionKey,
      firstValue: firstValue.trim() || null,
      checkValue: checkValue.trim() || null,
      text: text.trim(),
    };
    try {
      onSaved(draft.id ? await updateGuidanceNote(projectId, draft.id, input) : await createGuidanceNote(projectId, input));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="note-dialog-title">
      <Box component="form" onSubmit={(e) => (e.preventDefault(), ready && void save())}>
        <DialogTitle id="note-dialog-title">{draft.id ? t("quality.noteEdit") : t("quality.noteNew")}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <FormControl fullWidth>
              <InputLabel id="note-question">{t("quality.question")}</InputLabel>
              <Select labelId="note-question" label={t("quality.question")} value={questionKey} onChange={(e) => setQuestionKey(e.target.value)}>
                {keys.map((k) => (
                  <MenuItem key={k} value={k} sx={{ whiteSpace: "normal" }}>
                    {label(k)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label={t("quality.noteFirst")}
              value={firstValue}
              onChange={(e) => setFirstValue(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
            />
            <TextField
              label={t("quality.noteCheck")}
              value={checkValue}
              onChange={(e) => setCheckValue(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
            />
            <TextField
              label={t("quality.noteText")}
              value={text}
              onChange={(e) => setText(e.target.value)}
              multiline
              minRows={3}
              autoFocus
              required
              slotProps={{ htmlInput: { maxLength: MAX_NOTE } }}
              helperText={t("quality.noteHelp")}
            />
            <ErrorAlert error={error} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="contained" disabled={!ready || busy}>
            {t("common.save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

function NoteItem({
  projectId,
  note,
  label,
  labels,
  options,
  onEdit,
  onDeleted,
}: {
  projectId: string;
  note: GuidanceNote;
  label: (key: string) => string;
  labels: ReadonlyMap<string, string>;
  options: AnswerOptions;
  onEdit: (draft: NoteDraft) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteGuidanceNote(projectId, note.id);
      onDeleted(note.id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Paper variant="outlined" component="li" sx={{ p: { xs: 1.5, sm: 2 }, listStyle: "none" }}>
      <Stack spacing={1}>
        <NoteAbout note={note} label={label} options={options} />
        {/* Shown with question labels for keys (a draft of the assistant may hold one); edited as written. */}
        <Typography sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{withQuestionLabels(note.text, labels)}</Typography>
        {confirm ? (
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="body2">{t("quality.noteDeleteConfirm")}</Typography>
            <Button size="small" color="error" variant="contained" onClick={() => void remove()} disabled={busy}>
              {t("quality.deleteNote")}
            </Button>
            <Button size="small" onClick={() => setConfirm(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={() => onEdit({ ...note })}>
              {t("quality.editNote")}
            </Button>
            <Button size="small" color="error" onClick={() => setConfirm(true)}>
              {t("quality.deleteNote")}
            </Button>
          </Stack>
        )}
        <ErrorAlert error={error} />
      </Stack>
    </Paper>
  );
}

/** Section 7: guidance notes for collectors, with add, edit and delete. */
export function QualityNotes({
  projectId,
  data,
  onEdit,
  onDeleted,
}: {
  projectId: string;
  data: QualityData;
  onEdit: (draft: NoteDraft) => void;
  onDeleted: (id: string) => void;
}) {
  const t = useT();
  const label = labelMap(data.questions);
  const labels = labelsOf(data.questions);
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section">
      <Stack spacing={2}>
        <Typography variant="h2">{t("quality.notesTitle")}</Typography>
        <Typography color="text.secondary">{t("quality.notesExplain")}</Typography>
        {data.notes.length === 0 ? (
          <Alert severity="info">{t("quality.noNotes")}</Alert>
        ) : (
          <Stack component="ul" spacing={1.5} sx={{ m: 0, p: 0 }}>
            {data.notes.map((note) => (
              <NoteItem key={note.id} projectId={projectId} note={note} label={label} labels={labels} options={data.options} onEdit={onEdit} onDeleted={onDeleted} />
            ))}
          </Stack>
        )}
        <Box>
          <Button
            variant="outlined"
            startIcon={<Add />}
            onClick={() => onEdit({ questionKey: data.questions[0]?.key ?? "", firstValue: null, checkValue: null, text: "" })}
            disabled={data.questions.length === 0 && data.notes.length === 0}
          >
            {t("quality.addNote")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
