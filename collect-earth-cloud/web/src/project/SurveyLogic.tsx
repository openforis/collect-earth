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
import { useId, useMemo, useState } from "react";
import type { MessageKey } from "../i18n";
import type { ConditionRows, DesignCondition, DesignQuestion, DesignRule, NewRule, TotalTest } from "../api";
import { conditionWords, questionLabel, ruleWords, TEST_KEYS, textIn, type Words } from "./surveyDesignView";
import { DescribeRule } from "./SurveyHelp";
import {
  draftOf,
  listOptions,
  needsValue,
  newRow,
  numberQuestions,
  ruleDraftOf,
  ruleOf,
  rowsOf,
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
 * `allowAlways` false). A condition the rows cannot say is shown as written: what is chosen here replaces it.
 */
export function ConditionDialog({ w, title, initial, candidates, allowAlways, onClose, onApply }: {
  w: Words;
  title: string;
  initial: DesignCondition | null;
  candidates: readonly DesignQuestion[];
  allowAlways: boolean;
  onClose: () => void;
  onApply: (rows: ConditionRows | null) => void;
}) {
  const { t } = w;
  const titleId = useId();
  const start = draftOf(initial);
  const [when, setWhen] = useState(!allowAlways || initial !== null);
  const [draft, setDraft] = useState<ConditionDraft>(start ?? { kind: "all", rows: [newRow(candidates[0])] });
  const questions = useMemo(() => byName(candidates), [candidates]);
  const rows = rowsOf(draft, questions);
  const ready = !when || rows !== null;
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="md" fullWidth>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {initial && !start && initial.kind !== "never" && <Alert severity="info">{t("survey.logic.advanced", { condition: conditionWords(w, initial) })}</Alert>}
          {allowAlways && (
            <RadioGroup row value={when ? "when" : "always"} onChange={(e) => setWhen(e.target.value === "when")}>
              <FormControlLabel value="always" control={<Radio />} label={t("survey.logic.always")} />
              <FormControlLabel value="when" control={<Radio />} label={t("survey.logic.onlyWhen")} />
            </RadioGroup>
          )}
          {when && <ConditionEditor w={w} candidates={candidates} draft={draft} onChange={setDraft} />}
          {when && (rows ? (
            <Typography variant="body2" color="text.secondary">{t("survey.logic.inWords", { text: conditionWords(w, rows) })}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">{t("survey.logic.incomplete")}</Typography>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!ready} onClick={() => onApply(when ? rows : null)}>
          {t("survey.logic.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Required: not, always, or when the rows hold */
export function RequiredControl({ w, q, candidates, busy, onChange }: {
  w: Words;
  q: DesignQuestion;
  candidates: readonly DesignQuestion[];
  busy: boolean;
  onChange: (required: boolean | ConditionRows) => void;
}) {
  const { t } = w;
  const [asking, setAsking] = useState(false);
  const value = q.required === "always" ? "always" : q.required === "never" ? "never" : "when";
  const label = textIn(q.label, w.language, w.design.languages) || q.name;
  return (
    <>
      <TextField select size="small" label={t("survey.required")} value={value} disabled={busy} sx={{ width: 210, flex: "none", ml: 0.5 }}
        slotProps={{ htmlInput: { "aria-label": `${t("survey.required")}: ${label}` } }}
        onChange={(e) => {
          if (e.target.value === "when") setAsking(true);
          else onChange(e.target.value === "always");
        }}>
        <MenuItem value="never">{t("survey.logic.requiredNever")}</MenuItem>
        <MenuItem value="always">{t("survey.logic.requiredAlways")}</MenuItem>
        <MenuItem value="when">{t("survey.logic.requiredWhen")}</MenuItem>
      </TextField>
      {value === "when" && (
        <Tooltip title={t("survey.logic.requiredChange")}>
          <IconButton size="small" aria-label={`${t("survey.logic.requiredChange")}: ${label}`} disabled={busy} onClick={() => setAsking(true)}>
            <EditOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {asking && (
        <ConditionDialog
          w={w}
          title={t("survey.logic.requiredTitle", { question: label })}
          initial={typeof q.required === "object" ? q.required.when : null}
          candidates={candidates}
          allowAlways={false}
          onClose={() => setAsking(false)}
          onApply={(rows) => {
            setAsking(false);
            if (rows) onChange(rows);
          }}
        />
      )}
    </>
  );
}

const KIND_KEYS: Record<RuleKind, MessageKey> = { range: "survey.logic.kind.range", length: "survey.logic.kind.length", total: "survey.logic.kind.total" };
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
  onApply: (rule: NewRule) => void;
}) {
  const { t } = w;
  const titleId = useId();
  const [draft, setDraft] = useState<RuleDraft>(() => ruleDraftOf(rule, kinds, rule ? (rule.message[w.language] ?? "") : ""));
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const questions = useMemo(() => byName(candidates), [candidates]);
  const made = ruleOf(draft, questions);
  const words = made ? ruleWords(w, made as DesignRule) : null;
  const numbers = numberQuestions(candidates).filter((c) => c.name !== q.name);
  const label = textIn(q.label, w.language, w.design.languages) || q.name;
  const apply = () => {
    if (!made || !words) return;
    // The message a person collecting reads: the rule in words, without saying it is a warning (the form shows that)
    onApply({ ...made, message: { [w.language]: draft.message.trim() || ruleWords(w, { ...made, flag: "error" } as DesignRule) } });
  };
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="md" fullWidth>
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
          <RadioGroup value={draft.flag} onChange={(e) => set({ flag: e.target.value as RuleDraft["flag"] })}>
            <FormControlLabel value="error" control={<Radio />} label={t("survey.logic.flag.error")} />
            <FormControlLabel value="warning" control={<Radio />} label={t("survey.logic.flag.warning")} />
          </RadioGroup>
          <FormControlLabel
            control={<Checkbox checked={draft.onlyWhen} onChange={(e) => set({ onlyWhen: e.target.checked, when: draft.when.rows.length > 0 ? draft.when : { kind: "all", rows: [newRow(candidates[0])] } })} />}
            label={t("survey.logic.ruleOnlyWhen")}
          />
          {draft.onlyWhen && <ConditionEditor w={w} candidates={candidates} draft={draft.when} onChange={(when) => set({ when })} />}
          <TextField label={t("survey.logic.message", { language: w.language })} value={draft.message} onChange={(e) => set({ message: e.target.value })} multiline
            placeholder={words ?? undefined} helperText={t("survey.logic.messageHelp")} slotProps={{ htmlInput: { lang: w.language } }} />
          {words ? (
            <Typography variant="body2" color="text.secondary">{t("survey.logic.inWords", { text: words })}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">{draft.onlyWhen ? t("survey.logic.incomplete") : t("survey.logic.ruleIncomplete")}</Typography>
          )}
          <Typography variant="body2" color="text.secondary">{t("survey.logic.tried")}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" disabled={!made} onClick={apply}>
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

