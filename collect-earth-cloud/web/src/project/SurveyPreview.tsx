// The survey's preview (docs/plans/2026-11-18-survey-designer.md, stage 6): the form page by page as a person
// collecting meets it, answered here to try it. Questions show and hide by their conditions, required marks follow
// theirs, and rules say when an answer breaks them, as the form does (surveyPreviewView.ts). Nothing is saved.

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormGroup from "@mui/material/FormGroup";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { Theme } from "@mui/material/styles";
import { useId, useMemo, useState } from "react";
import type { DesignQuestion, DesignTable } from "../api";
import { ruleWords, textIn, type Words } from "./surveyDesignView";
import { answerOf, brokenRules, columnTotal, isRequired, isShown, noAnswers, optionsOf, typesOf, type Answer, type Answers, type Place } from "./surveyPreviewView";

/** At most so many answers of a list as buttons; more in a list to pick from */
const MAX_BUTTONS = 8;

export function SurveyPreview({ w, onClose }: { w: Words; onClose: () => void }) {
  const { t, design } = w;
  const titleId = useId();
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down("sm"));
  const [answers, setAnswers] = useState<Answers>(noAnswers);
  const [tab, setTab] = useState(0);
  const typeOf = useMemo(() => typesOf(design), [design]);
  const page = design.pages[Math.min(tab, design.pages.length - 1)];
  const set = (q: DesignQuestion, place: Place, value: Answer) =>
    setAnswers((before) => {
      if (place.table && place.row !== undefined) {
        const table = before.rows[place.table.name] ?? {};
        return { ...before, rows: { ...before.rows, [place.table.name]: { ...table, [place.row]: { ...(table[place.row] ?? {}), [q.name]: value } } } };
      }
      return { ...before, plot: { ...before.plot, [q.name]: value } };
    });
  const field = (q: DesignQuestion, place: Place, compact = false) => (
    <PreviewField key={q.name} w={w} q={q} place={place} answers={answers} typeOf={typeOf} compact={compact} onChange={(v) => set(q, place, v)} />
  );
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="md" fullWidth fullScreen={phone}>
      <DialogTitle id={titleId}>{t("survey.preview.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("survey.preview.note")}
        </Typography>
        {design.pages.length > 1 && (
          <Tabs value={Math.min(tab, design.pages.length - 1)} onChange={(_, v: number) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}>
            {design.pages.map((p) => (
              <Tab key={p.name} label={textIn(p.label, w.language, design.languages) || p.name} />
            ))}
          </Tabs>
        )}
        {page && (
          <Stack spacing={2.5}>
            {page.items.map((item) =>
              !isShown(item, answers, {}, typeOf) ? null : item.kind === "table" ? (
                <PreviewTable key={item.name} w={w} table={item} answers={answers} field={field} />
              ) : (
                field(item, {})
              ),
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setAnswers(noAnswers())}>{t("survey.preview.reset")}</Button>
        <Button variant="contained" onClick={onClose}>
          {t("common.close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** A table: one row per answer of its list, its columns' fields in each, the totals under them */
function PreviewTable({ w, table, answers, field }: {
  w: Words;
  table: DesignTable;
  answers: Answers;
  field: (q: DesignQuestion, place: Place, compact?: boolean) => React.ReactNode;
}) {
  const { t, design } = w;
  const rows = table.rowsList ? (w.lists.get(table.rowsList)?.items ?? []) : [];
  const columns = table.columns.filter((c) => !c.key && !c.hidden && !c.formulas);
  const totals = columns.filter((c) => c.rules.some((r) => r.kind === "total"));
  return (
    <Box>
      <Typography sx={{ fontWeight: 600 }}>{textIn(table.label, w.language, design.languages) || table.name}</Typography>
      {table.layout === "group" || rows.length === 0 ? (
        <Stack spacing={1.5} sx={{ mt: 1 }}>{columns.map((c) => field(c, { table, row: "" }, true))}</Stack>
      ) : (
        <Stack spacing={1} sx={{ mt: 1 }}>
          {rows.map((r) => (
            <Box key={r.code} sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
                {textIn(r.label, w.language, design.languages) || r.code}
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                {columns.map((c) => (isShown(c, answers, { table, row: r.code }, typesOf(design)) ? field(c, { table, row: r.code }, true) : null))}
              </Stack>
            </Box>
          ))}
          {totals.map((c) => (
            <Typography key={c.name} variant="body2" color="text.secondary">
              {textIn(c.label, w.language, design.languages) || c.name}: {t("survey.preview.total", { total: columnTotal(table, c.name, answers) })}
            </Typography>
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** One question: its label (marked when required now), its help, its field, and what it breaks */
function PreviewField({ w, q, place, answers, typeOf, compact, onChange }: {
  w: Words;
  q: DesignQuestion;
  place: Place;
  answers: Answers;
  typeOf: (name: string) => DesignQuestion["type"] | undefined;
  compact: boolean;
  onChange: (value: Answer) => void;
}) {
  const { t, design } = w;
  if (q.hidden || q.formulas || q.key) return null;
  if (!isShown(q, answers, place, typeOf)) return null;
  const label = textIn(q.label, w.language, design.languages) || q.name;
  const help = textIn(q.help, w.language, design.languages);
  const value = answerOf(answers, q.name, place);
  const required = isRequired(q, answers, place, typeOf);
  const missing = required && (value === undefined || (Array.isArray(value) ? value.length === 0 : value.trim() === ""));
  const broken = brokenRules(q, answers, place, typeOf);
  const text = typeof value === "string" ? value : "";
  const shownLabel = `${label}${required ? " *" : ""}`;
  let input: React.ReactNode;
  switch (q.type) {
    case "choice":
    case "choices": {
      const options = optionsOf(q, w.lists.get(q.list ?? "")?.items ?? [], answers, place);
      const name = (code: string) => textIn(options.find((o) => o.code === code)?.label ?? {}, w.language, design.languages) || code;
      if (q.type === "choices") {
        const chosen = Array.isArray(value) ? value : [];
        input = (
          <FormGroup row>
            {options.map((o) => (
              <FormControlLabel key={o.code} label={name(o.code)}
                control={<Checkbox size="small" checked={chosen.includes(o.code)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.code] : chosen.filter((c) => c !== o.code))} />} />
            ))}
          </FormGroup>
        );
      } else if (q.layout === "dropdown" || options.length > MAX_BUTTONS || compact) {
        input = (
          <TextField select size="small" value={options.some((o) => o.code === text) ? text : ""} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 200 }}
            slotProps={{ htmlInput: { "aria-label": label } }}>
            <MenuItem value="">—</MenuItem>
            {options.map((o) => (
              <MenuItem key={o.code} value={o.code}>
                {name(o.code)}
              </MenuItem>
            ))}
          </TextField>
        );
      } else {
        input = (
          <ToggleButtonGroup size="small" exclusive value={text || null} onChange={(_, v: string | null) => onChange(v ?? "")} aria-label={label} sx={{ flexWrap: "wrap" }}>
            {options.map((o) => (
              <ToggleButton key={o.code} value={o.code}>
                {name(o.code)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        );
      }
      break;
    }
    case "yesNo":
      input = (
        <ToggleButtonGroup size="small" exclusive value={text || null} onChange={(_, v: string | null) => onChange(v ?? "")} aria-label={label}>
          <ToggleButton value="true">{t("survey.yes")}</ToggleButton>
          <ToggleButton value="false">{t("survey.no")}</ToggleButton>
        </ToggleButtonGroup>
      );
      break;
    case "integer":
    case "decimal":
      input = <TextField size="small" value={text} onChange={(e) => onChange(e.target.value)} slotProps={{ htmlInput: { inputMode: q.type === "integer" ? "numeric" : "decimal", "aria-label": label } }} sx={{ maxWidth: 200 }} />;
      break;
    case "text":
    case "memo":
      input = <TextField size="small" value={text} multiline={q.type === "memo"} minRows={q.type === "memo" ? 3 : undefined} onChange={(e) => onChange(e.target.value)} fullWidth={!compact} slotProps={{ htmlInput: { "aria-label": label, lang: w.language } }} />;
      break;
    case "date":
      input = <TextField size="small" type="date" value={text} onChange={(e) => onChange(e.target.value)} slotProps={{ htmlInput: { "aria-label": label } }} />;
      break;
    default:
      input = <Typography variant="body2" color="text.secondary">{t("survey.preview.notHere")}</Typography>;
  }
  return (
    <Box>
      <Typography variant={compact ? "body2" : "body1"} sx={{ fontWeight: compact ? 400 : 600, mb: 0.5 }}>
        {shownLabel}
      </Typography>
      {help && !compact && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5, whiteSpace: "pre-line" }}>
          {help}
        </Typography>
      )}
      {input}
      {missing && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {t("survey.preview.required")}
        </Typography>
      )}
      {broken.map((r, i) => (
        <Alert key={i} severity={r.flag === "warning" ? "warning" : "error"} sx={{ mt: 0.5, py: 0 }}>
          {textIn(r.message, w.language, design.languages) || ruleWords(w, r)}
        </Alert>
      ))}
    </Box>
  );
}
