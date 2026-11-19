// The AI assistant's help in the survey designer (docs/plans/2026-11-18-survey-designer.md, stage 4b): a rule written
// from the coordinator's words, rules suggested, a message translated, an advanced condition or formula explained. The
// server sends the model the survey's structure only and checks every rule it answers; nothing here is saved without
// the coordinator's "Add" or "Apply".

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AutoAwesome from "@mui/icons-material/AutoAwesomeOutlined";
import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { DesignRule, NewRule, SuggestedRule, SurveyHelpAnswer, SurveyHelpInput, SurveyOperation } from "../api";
import { ErrorAlert } from "../components/ErrorAlert";
import { useApp } from "../appContext";
import { languageNames, ruleWords, textIn, type Words } from "./surveyDesignView";

/** The assistant's help, when it is switched on for the project; null otherwise */
export interface SurveyHelp {
  ask: (input: SurveyHelpInput) => Promise<SurveyHelpAnswer>;
  /** The dashboard's language: the explanations are written in it */
  language: string;
}

export const HelpContext = createContext<SurveyHelp | null>(null);

/** What a call is doing: waiting, its answer, or its error */
function useCall<T>() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (call: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await call();
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** "Tried on the plots collected: …" */
export function flagsWords(w: Words, flagged: number, checked: number): string {
  return checked === 0 ? w.t("survey.help.flagsNone") : w.t("survey.help.flags", { count: flagged, checked });
}

/** In the rule dialog: the rule described in words, written by the assistant into the dialog's fields */
export function DescribeRule({ w, question, onRule }: { w: Words; question: number; onRule: (rule: NewRule) => void }) {
  const help = useContext(HelpContext);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState<Extract<SurveyHelpAnswer, { task: "describe" }> | null>(null);
  const call = useCall<SurveyHelpAnswer>();
  if (!help) return null;
  const { t } = w;
  const write = async () => {
    const out = await call.run(() => help.ask({ task: "describe", question, text: text.trim(), language: help.language, surveyLanguage: w.language }));
    if (out?.task !== "describe") return;
    setAnswer(out);
    if (out.rule) onRule(out.rule);
  };
  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" } }}>
        <TextField size="small" label={t("survey.help.describe")} value={text} onChange={(e) => setText(e.target.value)} multiline sx={{ flex: 1 }}
          helperText={t("survey.help.describeHelp")} slotProps={{ htmlInput: { maxLength: 600 } }} />
        <Button variant="outlined" startIcon={call.busy ? <CircularProgress size={16} /> : <AutoAwesome />} disabled={call.busy || text.trim() === ""} onClick={() => void write()}>
          {t("survey.help.write")}
        </Button>
      </Stack>
      {call.error !== null && <ErrorAlert error={call.error} />}
      {answer && (
        <Alert severity={answer.rule ? "info" : "warning"} sx={{ mt: 1 }}>
          {answer.rule ? t("survey.help.written", { why: answer.why }) : t("survey.help.cannot", { why: answer.why })}
          {answer.rule && <Box>{flagsWords(w, answer.flagged, answer.checked)}</Box>}
        </Alert>
      )}
    </Box>
  );
}

/**
 * Rules the assistant suggests for the survey, each tried on the plots collected, added one by one: one save at a
 * time, marked Added once saved; a save that fails says so here
 */
export function SuggestRulesDialog({ w, onClose, onAdd }: {
  w: Words;
  onClose: () => void;
  onAdd: (ops: SurveyOperation[]) => Promise<{ saved: boolean; problem?: ReactNode }>;
}) {
  const help = useContext(HelpContext);
  const titleId = useId();
  const [suggestions, setSuggestions] = useState<SuggestedRule[] | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  /** The suggestion being saved */
  const [saving, setSaving] = useState<number | null>(null);
  const [problem, setProblem] = useState<{ index: number; node: ReactNode } | null>(null);
  const add = async (i: number, s: SuggestedRule) => {
    setSaving(i);
    setProblem(null);
    const result = await onAdd([{ op: "addRule", id: s.question, rule: s.rule }]);
    setSaving(null);
    if (result.saved) setAdded((before) => new Set([...before, i]));
    else if (result.problem) setProblem({ index: i, node: result.problem });
  };
  const call = useCall<SurveyHelpAnswer>();
  const { t } = w;
  useEffect(() => {
    if (!help) return;
    void call.run(() => help.ask({ task: "suggest", language: help.language, surveyLanguage: w.language })).then((out) => {
      if (out?.task === "suggest") setSuggestions(out.suggestions);
    });
    // Asked once, when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const label = (name: string) => {
    const q = w.questions.get(name);
    return (q && textIn(q.label, w.language, w.design.languages)) || name;
  };
  return (
    <Dialog open onClose={saving !== null ? undefined : onClose} aria-labelledby={titleId} maxWidth="md" fullWidth>
      <DialogTitle id={titleId}>{t("survey.help.suggestTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">{t("survey.help.note")}</Typography>
          {call.busy && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }} role="status">
              <CircularProgress size={20} />
              <Typography>{t("survey.help.working")}</Typography>
            </Stack>
          )}
          {call.error !== null && <ErrorAlert error={call.error} />}
          {suggestions && suggestions.length === 0 && <Typography>{t("survey.help.suggestNone")}</Typography>}
          {suggestions?.map((s, i) => (
            <Box key={i} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{label(s.questionName)}</Typography>
              <Typography variant="body2">{ruleWords(w, s.rule as DesignRule)}</Typography>
              {s.why && <Typography variant="body2" color="text.secondary">{s.why}</Typography>}
              <Typography variant="body2" color="text.secondary">{flagsWords(w, s.flagged, s.checked)}</Typography>
              <Button size="small" sx={{ mt: 0.5 }} variant={added.has(i) ? "text" : "outlined"} disabled={added.has(i) || saving !== null}
                startIcon={saving === i ? <CircularProgress size={14} /> : undefined}
                onClick={() => void add(i, s)}>
                {added.has(i) ? t("survey.help.added") : t("survey.help.add")}
              </Button>
              {problem?.index === i && <Box sx={{ mt: 1 }}>{problem.node}</Box>}
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving !== null}>{t("survey.edit.done")}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** A rule's message in the survey's other languages: the assistant's translations, changed if needed, then saved */
export function TranslateDialog({ w, message, onClose, onApply }: {
  w: Words;
  /** The message by language */
  message: Record<string, string>;
  onClose: () => void;
  onApply: (texts: Record<string, string>) => void;
}) {
  const help = useContext(HelpContext);
  const titleId = useId();
  const from = message[w.language] ? w.language : (w.design.languages.find((l) => message[l]) ?? w.language);
  const to = w.design.languages.filter((l) => l !== from);
  const [texts, setTexts] = useState<Record<string, string>>(() => Object.fromEntries(to.map((l) => [l, message[l] ?? ""])));
  const call = useCall<SurveyHelpAnswer>();
  const { t } = w;
  const { language: uiLanguage } = useApp();
  const names = useMemo(() => languageNames(uiLanguage), [uiLanguage]);
  useEffect(() => {
    if (!help || !message[from]) return;
    void call.run(() => help.ask({ task: "translate", text: message[from], from, to, language: help.language })).then((out) => {
      if (out?.task === "translate") setTexts((before) => ({ ...before, ...out.translations }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth>
      <DialogTitle id={titleId}>{t("survey.help.translateTitle")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2">“{message[from]}” ({names(from)})</Typography>
          {call.busy && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }} role="status">
              <CircularProgress size={20} />
              <Typography>{t("survey.help.working")}</Typography>
            </Stack>
          )}
          {call.error !== null && <ErrorAlert error={call.error} />}
          {to.map((l) => (
            <TextField key={l} label={names(l)} value={texts[l] ?? ""} multiline onChange={(e) => setTexts({ ...texts, [l]: e.target.value })} slotProps={{ htmlInput: { lang: l } }} />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={call.busy} onClick={() => onApply(Object.fromEntries(Object.entries(texts).filter(([l, v]) => v.trim() !== "" && v !== (message[l] ?? ""))))}>
          {t("survey.logic.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** "Explain": an advanced condition, rule or formula of a question, in the assistant's plain words */
export function ExplainButton({ w, question, which, index }: { w: Words; question: number; which: "shownWhen" | "required" | "rule" | "formula"; index?: number }) {
  const help = useContext(HelpContext);
  const [text, setText] = useState<string | null>(null);
  const call = useCall<SurveyHelpAnswer>();
  if (!help) return null;
  return (
    <Box component="span" sx={{ display: "block" }}>
      {text === null && (
        <Button size="small" startIcon={call.busy ? <CircularProgress size={14} /> : <AutoAwesome fontSize="small" />} disabled={call.busy} sx={{ py: 0 }}
          onClick={() =>
            void call.run(() => help.ask({ task: "explain", question, which, ...(index !== undefined ? { index } : {}), language: help.language })).then((out) => {
              if (out?.task === "explain") setText(out.text);
            })
          }>
          {w.t("survey.help.explain")}
        </Button>
      )}
      {text !== null && (
        <Typography component="span" variant="body2" sx={{ display: "block", fontStyle: "italic" }}>
          {text}
        </Typography>
      )}
      {call.error !== null && <ErrorAlert error={call.error} />}
    </Box>
  );
}
