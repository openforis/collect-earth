// The survey designer's logic builder (docs/plans/2026-11-18-survey-designer.md, stage 4): when a question or table is
// shown, when a question is required, and its rules, made from rows and limits; the server writes Collect's
// expressions from them. View logic in surveyLogicView.ts.

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Add from "@mui/icons-material/Add";
import Close from "@mui/icons-material/Close";
import EditOutlined from "@mui/icons-material/EditOutlined";
import { createContext, useContext, useEffect, useId, useMemo, useState } from "react";
import { useDraft, useSubmit, type AddResult } from "./surveyDialogs";
import type { MessageKey } from "../i18n";
import { useApp } from "../appContext";
import { ToolButton } from "./ToolButton";
import type { ConditionRows, DesignCondition, DesignQuestion, DesignRule, ExpressionCheckAnswer, ExpressionCheckInput, NewFormula, NewRule, TotalTest } from "../api";
import { conditionWords, languageNames, questionLabel, ruleWords, TEST_KEYS, textIn, type Words } from "./surveyDesignView";
import { DescribeRule } from "./SurveyHelp";
import {
  draftOf,
  expressionExample,
  listOptions,
  needsValue,
  newRow,
  numberQuestions,
  ruleDraftOf,
  ruleOf,
  rowsOf,
  surveyTranslator,
  testsFor,
  type ConditionDraft,
  type LimitDraft,
  type RowDraft,
  type RuleDraft,
  type RuleKind,
} from "./surveyLogicView";

const byName = (questions: readonly DesignQuestion[]) => new Map(questions.map((q) => [q.name, q]));

/** A question as the rows name it: its label and its name in the data */
const optionLabel = (w: Words, q: DesignQuestion) => `${textIn(q.label, w.language, w.design.languages) || q.name} (${q.name})`;

/** The rows of a condition: question, test, answer; all or any of them */
export function ConditionEditor({ w, candidates, draft, onChange }: {
  w: Words;
  /** The questions a row can name */
  candidates: readonly DesignQuestion[];
  draft: ConditionDraft;
  onChange: (draft: ConditionDraft) => void;
}) {
  const { t } = w;
  const questions = useMemo(() => byName(candidates), [candidates]);
  if (candidates.length === 0) return <Typography color="text.secondary">{t("survey.logic.noQuestions")}</Typography>;
  const setRow = (i: number, row: RowDraft) => onChange({ ...draft, rows: draft.rows.map((r, j) => (j === i ? row : r)) });
  return (
    <Stack spacing={1.5}>
      {draft.rows.length > 1 && (
        <ToggleButtonGroup size="small" exclusive value={draft.kind} onChange={(_, kind) => kind && onChange({ ...draft, kind })} aria-label={t("survey.logic.test")}>
          <ToggleButton value="all">{t("survey.logic.all")}</ToggleButton>
          <ToggleButton value="any">{t("survey.logic.any")}</ToggleButton>
        </ToggleButtonGroup>
      )}
      {draft.rows.map((row, i) => {
        const q = questions.get(row.question);
        const tests = q ? testsFor(q.type) : [];
        return (
          <Stack key={i} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "flex-start" }, p: { xs: 1, sm: 0 }, border: { xs: 1, sm: 0 }, borderColor: "divider", borderRadius: 1 }}>
            <TextField select size="small" label={t("survey.logic.question")} value={q ? row.question : ""} sx={{ flex: 2, minWidth: 0 }}
              onChange={(e) => setRow(i, newRow(questions.get(e.target.value)))}>
              {candidates.map((c) => (
                <MenuItem key={c.name} value={c.name}>
                  {optionLabel(w, c)}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label={t("survey.logic.test")} value={tests.includes(row.test) ? row.test : ""} sx={{ flex: 1.5, minWidth: 0 }} disabled={!q}
              onChange={(e) => setRow(i, { ...row, test: e.target.value as RowDraft["test"] })}>
              {tests.map((test) => (
                <MenuItem key={test} value={test}>
                  {t(TEST_KEYS[test], { question: "…", value: "…" })}
                </MenuItem>
              ))}
            </TextField>
            {q && needsValue(row.test) && <ValueField w={w} q={q} value={row.value} onChange={(value) => setRow(i, { ...row, value })} />}
            <Tooltip title={t("survey.logic.removeRow")}>
              <IconButton aria-label={t("survey.logic.removeRow")} onClick={() => onChange({ ...draft, rows: draft.rows.filter((_, j) => j !== i) })} sx={{ alignSelf: { xs: "flex-end", sm: "center" } }}>
                <Close fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        );
      })}
      <Box>
        <Button size="small" startIcon={<Add />} onClick={() => onChange({ ...draft, rows: [...draft.rows, newRow(candidates[0])] })}>
          {t("survey.logic.addRow")}
        </Button>
      </Box>
    </Stack>
  );
}

/** The answer a row compares with: one of the list's, yes or no, a number, a text */
function ValueField({ w, q, value, onChange }: { w: Words; q: DesignQuestion; value: string; onChange: (value: string) => void }) {
  const { t } = w;
  const sx = { flex: 1.5, minWidth: 0 };
  if (q.type === "choice" || q.type === "choices") {
    const items = listOptions(w.lists.get(q.list ?? "")?.items ?? []);
    return (
      <TextField select size="small" label={t("survey.logic.value")} value={items.some((i) => i.code === value) ? value : ""} onChange={(e) => onChange(e.target.value)} sx={sx}>
        {items.map((i) => (
          <MenuItem key={i.code} value={i.code}>
            {textIn(i.label, w.language, w.design.languages) || i.code} ({i.code})
          </MenuItem>
        ))}
      </TextField>
    );
  }
  if (q.type === "yesNo") {
    return (
      <TextField select size="small" label={t("survey.logic.value")} value={value} onChange={(e) => onChange(e.target.value)} sx={sx}>
        <MenuItem value="true">{t("survey.yes")}</MenuItem>
        <MenuItem value="false">{t("survey.no")}</MenuItem>
      </TextField>
    );
  }
  const number = q.type === "integer" || q.type === "decimal";
  return (
    <TextField size="small" label={t("survey.logic.value")} value={value} onChange={(e) => onChange(e.target.value)} sx={sx}
      slotProps={{ htmlInput: number ? { inputMode: "decimal" } : { lang: w.language } }} />
  );
}

/**
 * When a question or table is shown (always, or only when the rows hold), or when a question is required (the rows,
 * `allowAlways` false); with `onApplyText`, also written as an expression (stage 7). A condition the rows cannot say
 * opens as the expression written.
 */
export function ConditionDialog({ w, title, initial, candidates, allowAlways, node, onClose, onApply, onApplyText }: {
  w: Words;
  title: string;
  initial: DesignCondition | null;
  candidates: readonly DesignQuestion[];
  allowAlways: boolean;
  /** The question or table it belongs to: an expression is checked from its place */
  node?: number;
  onClose: () => void;
  /** Saved: the dialog closes once it is, and keeps what was chosen when it is not */
  onApply: (rows: ConditionRows | null) => Promise<AddResult>;
  onApplyText?: (text: string) => Promise<AddResult>;
}) {
  const { t } = w;
  const titleId = useId();
  const start = draftOf(initial);
  const advanced = initial?.kind === "advanced" ? initial.text : null;
  const [mode, setMode] = useState<"always" | "rows" | "text">(advanced !== null && onApplyText ? "text" : allowAlways && initial === null ? "always" : "rows");
  const [draft, setDraft] = useState<ConditionDraft>(start ?? { kind: "all", rows: [newRow(candidates[0])] });
  const [text, setText] = useState(advanced ?? "");
  const [bad, setBad] = useState(false);
  const submit = useSubmit(onClose);
  const questions = useMemo(() => byName(candidates), [candidates]);
  const rows = rowsOf(draft, questions);
  const ready = mode === "always" || (mode === "rows" && rows !== null) || (mode === "text" && text.trim() !== "" && !bad);
  useDraft(text.trim() !== (advanced ?? "").trim());
  const choices = [...(allowAlways ? (["always"] as const) : []), "rows" as const, ...(onApplyText ? (["text"] as const) : [])];
  return (
    <Dialog open onClose={submit.busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="md" fullWidth>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {initial && !start && initial.kind !== "never" && !onApplyText && <Alert severity="info">{t("survey.logic.advanced", { condition: conditionWords(w, initial) })}</Alert>}
          {choices.length > 1 && (
            <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              {allowAlways && <FormControlLabel value="always" control={<Radio />} label={t("survey.logic.always")} />}
              <FormControlLabel value="rows" control={<Radio />} label={t("survey.logic.onlyWhen")} />
              {onApplyText && <FormControlLabel value="text" control={<Radio />} label={t("survey.logic.written")} />}
            </RadioGroup>
          )}
          {mode === "rows" && <ConditionEditor w={w} candidates={candidates} draft={draft} onChange={setDraft} />}
          {mode === "rows" && (rows ? (
            <Typography variant="body2" color="text.secondary">{t("survey.logic.inWords", { text: conditionWords(w, rows) })}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">{t("survey.logic.incomplete")}</Typography>
          ))}
          {mode === "text" && node !== undefined && <ExpressionField w={w} node={node} kind="boolean" label={t("survey.logic.condition")} value={text} onChange={setText} onBad={setBad} />}
          {submit.problem}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submit.busy}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!ready || submit.busy}
          onClick={() => void submit.run(mode === "text" && onApplyText ? onApplyText(text.trim()) : onApply(mode === "rows" ? rows : null))}>
          {t("survey.logic.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** How the designer checks an expression as it is typed (POST /survey/check); null where it cannot (no project file) */
export const ExpressionCheckContext = createContext<((input: ExpressionCheckInput) => Promise<ExpressionCheckAnswer>) | null>(null);

/**
 * An expression of Collect's language typed (a condition, a rule, a formula), checked as Collect checks it from the
 * place of its question, half a second after the typing stops
 */
export function ExpressionField({ w, node, kind, label, value, onChange, helperText, onBad }: {
  w: Words;
  node: number;
  kind: "boolean" | "value";
  label: string;
  value: string;
  onChange: (text: string) => void;
  helperText?: string;
  /** Told whether the check found the text as it is now wrong (Apply then waits for it to be put right) */
  onBad?: (bad: boolean) => void;
}) {
  const { t } = w;
  const check = useContext(ExpressionCheckContext);
  // null answer: it could not be checked now (no connection); the save checks it again
  const [verdict, setVerdict] = useState<{ text: string; answer: ExpressionCheckAnswer | null } | null>(null);
  useEffect(() => {
    const text = value.trim();
    if (!check || text === "") return;
    let stale = false;
    const timer = setTimeout(() => {
      check({ id: node, kind, text })
        .then((answer) => {
          if (!stale) setVerdict({ text, answer });
        })
        .catch(() => {
          if (!stale) setVerdict({ text, answer: null });
        });
    }, 500);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [check, node, kind, value]);
  const checked = verdict && verdict.text === value.trim() ? verdict : null;
  const current = checked?.answer ?? null;
  const bad = value.trim() !== "" && current !== null && !current.ok;
  useEffect(() => onBad?.(bad), [bad, onBad]);
  const words =
    value.trim() === ""
      ? helperText
      : checked && current === null
        ? t("survey.check.failed")
        : current === null
          ? (check ? t("survey.check.checking") : helperText)
          : current.ok
            ? t("survey.check.ok")
            : t(`surveyCheck.${current.code}` as MessageKey, current.values);
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      multiline
      error={bad}
      helperText={words}
      slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: "monospace" } }, formHelperText: { role: "status" } as object }}
    />
  );
}

/** Required: not, always, or when the rows hold */
export function RequiredControl({ w, q, candidates, busy, onChange, onWhen, onText }: {
  w: Words;
  q: DesignQuestion;
  candidates: readonly DesignQuestion[];
  busy: boolean;
  /** Required always, or never */
  onChange: (required: boolean) => void;
  /** Required when the rows hold: the dialog closes once it is saved */
  onWhen: (rows: ConditionRows) => Promise<AddResult>;
  /** Required when an expression holds (stage 7) */
  onText?: (text: string) => Promise<AddResult>;
}) {
  const { t } = w;
  const [asking, setAsking] = useState(false);
  const value = q.required === "always" ? "always" : q.required === "never" ? "never" : "when";
  const label = textIn(q.label, w.language, w.design.languages) || q.name;
  return (
    <>
      <TextField select size="small" label={t("survey.required")} value={value} disabled={busy} sx={{ width: 210, flex: "none", ml: 0.5 }}
        // The name goes on the select a screen reader meets (MUI's input is hidden): which question it is about
        slotProps={{ select: { SelectDisplayProps: { "aria-label": `${t("survey.required")}: ${label}`, "aria-labelledby": undefined } } }}
        onChange={(e) => {
          if (e.target.value === "when") setAsking(true);
          else onChange(e.target.value === "always");
        }}>
        <MenuItem value="never">{t("survey.logic.requiredNever")}</MenuItem>
        <MenuItem value="always">{t("survey.logic.requiredAlways")}</MenuItem>
        <MenuItem value="when">{t("survey.logic.requiredWhen")}</MenuItem>
      </TextField>
      {value === "when" && (
        <ToolButton title={t("survey.logic.requiredChange")} label={`${t("survey.logic.requiredChange")}: ${label}`} disabled={busy} onClick={() => setAsking(true)}>
          <EditOutlined fontSize="small" />
        </ToolButton>
      )}
      {asking && (
        <ConditionDialog
          w={w}
          title={t("survey.logic.requiredTitle", { question: label })}
          initial={typeof q.required === "object" ? q.required.when : null}
          candidates={candidates}
          allowAlways={false}
          node={q.id}
          onClose={() => setAsking(false)}
          onApply={(rows) => (rows ? onWhen(rows) : Promise.resolve({ saved: false }))}
          onApplyText={onText}
        />
      )}
    </>
  );
}

const KIND_KEYS: Record<RuleKind, MessageKey> = {
  range: "survey.logic.kind.range",
  length: "survey.logic.kind.length",
  total: "survey.logic.kind.total",
  expression: "survey.logic.kind.expression",
};
const TOTAL_KEYS: Record<TotalTest, MessageKey> = { atLeast: "survey.logic.total.atLeast", atMost: "survey.logic.total.atMost", exactly: "survey.logic.total.exactly" };

/** A rule of a question, new or to change: its limits, error or warning, when it applies, its message */
export function RuleDialog({ w, q, rule, kinds, candidates, onClose, onApply }: {
  w: Words;
  q: DesignQuestion;
  /** The rule changed; null for a new one */
  rule: DesignRule | null;
  kinds: readonly RuleKind[];
  /** The questions its condition can name */
  candidates: readonly DesignQuestion[];
  onClose: () => void;
  /** Saved: the dialog closes once it is, and keeps what was chosen when it is not */
  onApply: (rule: NewRule) => Promise<AddResult>;
}) {
  const { t } = w;
  const titleId = useId();
  const [initial] = useState<RuleDraft>(() => ruleDraftOf(rule, kinds, rule ? (rule.message[w.language] ?? "") : ""));
  const [draft, setDraft] = useState<RuleDraft>(initial);
  const [badExpression, setBadExpression] = useState(false);
  const [badWhen, setBadWhen] = useState(false);
  const submit = useSubmit(onClose);
  useDraft(JSON.stringify(draft) !== JSON.stringify(initial));
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const questions = useMemo(() => byName(candidates), [candidates]);
  const made = ruleOf(draft.kind === "expression" ? { ...draft, onlyWhen: false } : draft, questions);
  const words = made ? ruleWords(w, made as DesignRule) : null;
  const numbers = numberQuestions(candidates).filter((c) => c.name !== q.name);
  const label = textIn(q.label, w.language, w.design.languages) || q.name;
  const { language: uiLanguage } = useApp();
  const names = useMemo(() => languageNames(uiLanguage), [uiLanguage]);
  // The message saved when none is typed: the rule in words, in the survey's language when the dashboard has it
  const surveyT = useMemo(() => surveyTranslator(w.language), [w.language]);
  const generated = made && surveyT ? ruleWords({ ...w, t: surveyT }, { ...made, flag: "error" } as DesignRule) : null;
  const apply = () => {
    if (!made || !words) return;
    // The message a person collecting reads: the rule in words, without saying it is a warning (the form shows that),
    // in the survey's language when the dashboard has it; else no message
    const message = draft.message.trim() || (generated ?? "");
    void submit.run(onApply({ ...made, message: { [w.language]: message } }));
  };
  // An expression the check found wrong is put right before it is applied
  const bad = draft.kind === "expression" && (badExpression || badWhen);
  const example = expressionExample(q, w.lists, w.language, w.design.languages);
  return (
    <Dialog open onClose={submit.busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="md" fullWidth>
      <DialogTitle id={titleId}>{t("survey.logic.ruleTitle", { question: label })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <DescribeRule w={w} question={q.id} onRule={(made) => setDraft(ruleDraftOf(made as DesignRule, kinds, made.message[w.language] ?? ""))} />
          {kinds.length > 1 && (
            <TextField select label={t("survey.logic.kind")} value={draft.kind} onChange={(e) => set({ kind: e.target.value as RuleKind })}>
              {kinds.map((k) => (
                <MenuItem key={k} value={k}>
                  {t(KIND_KEYS[k])}
                </MenuItem>
              ))}
            </TextField>
          )}
          {draft.kind === "range" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <LimitField w={w} label={t("survey.logic.min")} limit={draft.min} numbers={numbers} onChange={(min) => set({ min })} />
              <LimitField w={w} label={t("survey.logic.max")} limit={draft.max} numbers={numbers} onChange={(max) => set({ max })} />
            </Stack>
          )}
          {draft.kind === "length" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label={t("survey.logic.minChars")} value={draft.minChars} onChange={(e) => set({ minChars: e.target.value })} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
              <TextField label={t("survey.logic.maxChars")} value={draft.maxChars} onChange={(e) => set({ maxChars: e.target.value })} slotProps={{ htmlInput: { inputMode: "numeric" } }} />
            </Stack>
          )}
          {draft.kind === "total" && (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label={t("survey.logic.totalTest")} value={draft.totalTest} onChange={(e) => set({ totalTest: e.target.value as TotalTest })} sx={{ minWidth: 160 }}>
                {(Object.keys(TOTAL_KEYS) as TotalTest[]).map((k) => (
                  <MenuItem key={k} value={k}>
                    {t(TOTAL_KEYS[k])}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label={t("survey.logic.number")} value={draft.total} onChange={(e) => set({ total: e.target.value })} slotProps={{ htmlInput: { inputMode: "decimal" } }} />
            </Stack>
          )}
          {draft.kind === "expression" && (
            <>
              <ExpressionField w={w} node={q.id} kind="boolean" label={t("survey.logic.expression")} value={draft.expressionText} onChange={(expressionText) => set({ expressionText })}
                helperText={example?.kind === "list" ? t("survey.logic.expressionHelpList", { code: example.code, label: example.label }) : example?.kind === "text" ? t("survey.logic.expressionHelpText") : t("survey.logic.expressionHelp")} onBad={setBadExpression} />
              <ExpressionField w={w} node={q.id} kind="boolean" label={t("survey.logic.expressionWhen")} value={draft.whenText} onChange={(whenText) => set({ whenText })} onBad={setBadWhen} />
            </>
          )}
          <RadioGroup value={draft.flag} onChange={(e) => set({ flag: e.target.value as RuleDraft["flag"] })}>
            <FormControlLabel value="error" control={<Radio />} label={t("survey.logic.flag.error")} />
            <FormControlLabel value="warning" control={<Radio />} label={t("survey.logic.flag.warning")} />
          </RadioGroup>
          {draft.kind !== "expression" && (
            <FormControlLabel
              control={<Checkbox checked={draft.onlyWhen} onChange={(e) => set({ onlyWhen: e.target.checked, when: draft.when.rows.length > 0 ? draft.when : { kind: "all", rows: [newRow(candidates[0])] } })} />}
              label={t("survey.logic.ruleOnlyWhen")}
            />
          )}
          {draft.kind !== "expression" && draft.onlyWhen && <ConditionEditor w={w} candidates={candidates} draft={draft.when} onChange={(when) => set({ when })} />}
          <TextField label={t("survey.logic.message", { language: names(w.language) })} value={draft.message} onChange={(e) => set({ message: e.target.value })} multiline
            placeholder={generated ?? undefined} helperText={t("survey.logic.messageHelp")} slotProps={{ htmlInput: { lang: w.language } }} />
          {words ? (
            <Typography variant="body2" color="text.secondary">{t("survey.logic.inWords", { text: words })}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {draft.kind === "expression"
                ? t("survey.logic.expressionIncomplete")
                : draft.onlyWhen
                  ? t("survey.logic.incomplete")
                  : draft.kind === "total"
                    ? t("survey.logic.totalIncomplete")
                    : t("survey.logic.ruleIncomplete")}
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary">{t("survey.logic.tried")}</Typography>
          {submit.problem}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submit.busy}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!made || bad || submit.busy} onClick={apply}>
          {t("survey.logic.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A limit of a range: none, a number, or another question's answer; the limit itself allowed or not */
function LimitField({ w, label, limit, numbers, onChange }: {
  w: Words;
  label: string;
  limit: LimitDraft;
  numbers: readonly DesignQuestion[];
  onChange: (limit: LimitDraft) => void;
}) {
  const { t } = w;
  return (
    <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
      <TextField select label={label} value={limit.mode} onChange={(e) => onChange({ ...limit, mode: e.target.value as LimitDraft["mode"] })}>
        <MenuItem value="none">{t("survey.logic.limit.none")}</MenuItem>
        <MenuItem value="number">{t("survey.logic.limit.number")}</MenuItem>
        {numbers.length > 0 && <MenuItem value="question">{t("survey.logic.limit.question")}</MenuItem>}
      </TextField>
      {limit.mode === "number" && (
        <TextField size="small" label={t("survey.logic.number")} value={limit.number} onChange={(e) => onChange({ ...limit, number: e.target.value })} slotProps={{ htmlInput: { inputMode: "decimal", "aria-label": `${label}: ${t("survey.logic.number")}` } }} />
      )}
      {limit.mode === "question" && (
        <TextField select size="small" label={t("survey.logic.question")} value={limit.question} onChange={(e) => onChange({ ...limit, question: e.target.value })}>
          {numbers.map((q) => (
            <MenuItem key={q.name} value={q.name}>
              {questionLabel(w, q.name)} ({q.name})
            </MenuItem>
          ))}
        </TextField>
      )}
      {limit.mode !== "none" && (
        <FormControlLabel control={<Checkbox size="small" checked={limit.inclusive} onChange={(e) => onChange({ ...limit, inclusive: e.target.checked })} />} label={<Typography variant="body2">{t("survey.logic.inclusive")}</Typography>} />
      )}
    </Stack>
  );
}


interface FormulaDraft {
  mode: "value" | "expression";
  text: string;
  when: string;
}

/**
 * A calculated value's formulas as text (stage 7): each a value or an expression, with its condition; the form gives
 * the value of the first whose condition holds. Every expression checked as it is typed, all of them again when saved.
 */
export function FormulasDialog({ w, q, onClose, onApply }: { w: Words; q: DesignQuestion; onClose: () => void; onApply: (formulas: NewFormula[]) => Promise<AddResult> }) {
  const { t } = w;
  const titleId = useId();
  const [initial] = useState<FormulaDraft[]>(() =>
    (q.formulas ?? []).map((f) => (f.expression !== null ? { mode: "expression", text: f.expression, when: f.when ?? "" } : { mode: "value", text: f.value ?? "", when: f.when ?? "" })),
  );
  const [rows, setRows] = useState<FormulaDraft[]>(initial);
  /** The fields the check found wrong, by "row:part" */
  const [bad, setBad] = useState<ReadonlySet<string>>(new Set());
  const badField = (key: string) => (b: boolean) => setBad((all) => (all.has(key) === b ? all : b ? new Set([...all, key]) : new Set([...all].filter((k) => k !== key))));
  const submit = useSubmit(onClose);
  useDraft(JSON.stringify(rows) !== JSON.stringify(initial));
  const setRow = (i: number, patch: Partial<FormulaDraft>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const label = textIn(q.label, w.language, w.design.languages) || q.name;
  const wrong = rows.some((r, i) => (r.mode === "expression" && bad.has(`${i}:text`)) || bad.has(`${i}:when`));
  const ready = rows.length > 0 && rows.every((r) => r.text.trim() !== "") && !wrong;
  return (
    <Dialog open onClose={submit.busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="md" fullWidth>
      <DialogTitle id={titleId}>{t("survey.formulas.title", { question: label })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">{t("survey.formulas.explain")}</Typography>
          {rows.map((r, i) => (
            <Stack key={i} spacing={1} sx={{ p: 1.5, border: 1, borderColor: "divider", borderRadius: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{t("survey.formulas.number", { number: i + 1 })}</Typography>
                <ToggleButtonGroup size="small" exclusive value={r.mode} onChange={(_, mode) => mode && setRow(i, { mode })}>
                  <ToggleButton value="value">{t("survey.formulas.value")}</ToggleButton>
                  <ToggleButton value="expression">{t("survey.formulas.expression")}</ToggleButton>
                </ToggleButtonGroup>
                <Tooltip title={t("survey.formulas.remove")}>
                  <IconButton aria-label={`${t("survey.formulas.remove")} ${i + 1}`} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setBad(new Set()); }}>
                    <Close fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {r.mode === "expression" ? (
                <ExpressionField w={w} node={q.id} kind="value" label={t("survey.formulas.expression")} value={r.text} onChange={(text) => setRow(i, { text })} onBad={badField(`${i}:text`)} />
              ) : (
                <TextField label={t("survey.formulas.value")} value={r.text} onChange={(e) => setRow(i, { text: e.target.value })} helperText={q.list ? t("survey.formulas.valueCode") : undefined} />
              )}
              <ExpressionField w={w} node={q.id} kind="boolean" label={t("survey.formulas.when")} value={r.when} onChange={(when) => setRow(i, { when })} onBad={badField(`${i}:when`)} />
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<Add />} onClick={() => setRows([...rows, { mode: "expression", text: "", when: "" }])}>
              {t("survey.formulas.add")}
            </Button>
          </Box>
          {submit.problem}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submit.busy}>{t("common.cancel")}</Button>
        <Button
          variant="contained"
          disabled={!ready || submit.busy}
          onClick={() =>
            void submit.run(onApply(rows.map((r) => ({ ...(r.mode === "expression" ? { expression: r.text.trim() } : { value: r.text.trim() }), ...(r.when.trim() !== "" ? { when: r.when.trim() } : {}) }))))
          }>
          {t("survey.logic.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
