import {
  type FocusEvent, type HTMLAttributes, type Key, type ReactElement, cloneElement, createContext, memo, useContext, useEffect, useRef,
  useState,
} from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { type Translate, useT } from "../i18n";
import { type PressedKey, choiceKey, focusMovedByKey, isKeyboardClick } from "../shortcuts";
import {
  type CodeItem, type Field, type FieldInfo, clickCode, coordinateFromInput, coordinateToInput, dateFromInput,
  dateToInput, normalizeNumber, parseCodes, plainMessage, qualify, rangeFromInput, rangeToInput, requiredMessage, selectCodes,
  timeToInput,
} from "./model";
import { TYPING_DELAY } from "./store";

export interface FieldProps {
  field: Field;
  value: string;
  info: FieldInfo | undefined;
  /** the parent code field's selection decides the items: passed so the memo re-renders on it */
  items: CodeItem[];
  parentLabel?: string;
  onChange: (name: string, value: string, delay?: number) => void;
  /** in a table cell: no label above the control */
  dense?: boolean;
  /** not answered yet, and Submit not pressed: its error (the answer is required) is not shown yet */
  quiet?: boolean;
  /** an answer is needed before the plot can be submitted: marked on the label from the start */
  required?: boolean;
}

/** The message under a field in error: what to do when it is not answered yet, else the server's. */
export function errorText(t: Translate, field: Field, value: string, message: string | null | undefined): string {
  // a calculated field is not answered: the server's message says what is wrong with what it was calculated from
  const required = value.trim() === "" && !field.readOnly ? requiredMessage(field) : null;
  return required ? t(required) : plainMessage(message);
}

/**
 * Told the name of a single-choice question answered from the keyboard (a number key, Enter or Space): the form moves
 * the focus on to the next question to answer. Not after a click: the mouse may be on its way elsewhere.
 */
export const AnsweredByKey = createContext<(name: string) => void>(() => {});

/** The key pressed last in the page, for focusMovedByKey */
let lastKey: PressedKey | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => { lastKey = { key: e.key, at: performance.now() }; }, true);
}

/**
 * The description of an answer, in a tooltip: on hover, and on focus only when the user moved the focus there from the
 * keyboard (Tab, the arrows), so that it stays within reach of the keyboard; not when the form focuses the question
 * itself (a plot opened, the one before answered), where it covered the label of the next question.
 */
function Description({ title, children }: { title: string; children: ReactElement<{ onFocus?: (e: FocusEvent) => void; onBlur?: (e: FocusEvent) => void }> }) {
  const [hovered, setHovered] = useState(false);
  const [byKey, setByKey] = useState(false);
  const { onFocus, onBlur } = children.props;
  return (
    // describeChild: the answer keeps its label as its name, the description is its description
    <Tooltip title={title} open={hovered || byKey} disableFocusListener describeChild
      onOpen={() => setHovered(true)} onClose={() => { setHovered(false); setByKey(false); }}>
      {cloneElement(children, {
        onFocus: (e: FocusEvent) => { onFocus?.(e); setByKey(focusMovedByKey(lastKey, performance.now())); },
        onBlur: (e: FocusEvent) => { onBlur?.(e); setByKey(false); },
      })}
    </Tooltip>
  );
}

/** The id of the message under a field, which its control is described by */
const errorId = (field: Field) => `${field.name}-error`;

function ErrorMessage({ field, text }: { field: Field; text: string | null }) {
  if (!text || !text.trim()) return null;
  return (
    <FormHelperText error id={errorId(field)} data-testid="entry-field-error"
      sx={{ mx: 0, mt: 0.5, display: "flex", alignItems: "flex-start", gap: 0.5, fontWeight: 500 }}>
      <ErrorOutlineIcon sx={{ fontSize: 15, mt: "1px", flex: "none" }} />
      <span>{text}</span>
    </FormHelperText>
  );
}

/** Label, description, control and the error message of one field. */
export const FieldView = memo(function FieldView(props: FieldProps) {
  const t = useT();
  const { field, info, value, dense, quiet, required } = props;
  if (info?.visible === false) return null;
  // " ": in error, with nothing to say, the control is still outlined in red
  const error = info?.inError && !quiet ? errorText(t, field, value, info.errorMessage) || " " : null;
  // Nothing to answer: the value goes on the label's line, one row instead of two
  if (field.readOnly && !dense) {
    return (
      <Box data-field={field.name} data-error={error ? "true" : undefined} sx={{ minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: "baseline", flexWrap: "wrap", columnGap: 1.25, rowGap: 0.25 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }} title={field.description}>{field.label}</Typography>
          <ReadOnlyValue {...props} />
        </Stack>
        <ErrorMessage field={field} text={error} />
      </Box>
    );
  }
  return (
    <Box data-field={field.name} data-error={error ? "true" : undefined} sx={{ minWidth: 0 }}>
      {!dense && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 0.75 }}>
          <Typography component="label" htmlFor={field.name} variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {field.label}
            {required && <RequiredMark />}
          </Typography>
          {field.description && (
            <Tooltip title={field.description}>
              <InfoOutlinedIcon fontSize="small" color="action" sx={{ fontSize: 16, cursor: "help" }} aria-label={field.description} />
            </Tooltip>
          )}
        </Stack>
      )}
      <Control {...props} error={!!error} describedBy={error?.trim() ? errorId(field) : undefined} />
      <ErrorMessage field={field} text={error} />
    </Box>
  );
});

/**
 * A question that needs an answer: a discreet star after its label, for the eyes only (its tooltip for the mouse); a
 * screen reader hears it from the control, which says aria-required.
 */
function RequiredMark() {
  const t = useT();
  return (
    <Tooltip title={t("entry.requiredMark")}>
      <Box component="span" aria-hidden data-testid="entry-required"
        sx={{ ml: 0.5, color: "text.secondary", fontWeight: 400, cursor: "help" }}>*</Box>
    </Tooltip>
  );
}

/** error: outlined in red; describedBy: the id of its error message */
type ControlProps = FieldProps & { error: boolean; describedBy?: string };

function Control(props: ControlProps) {
  const { field } = props;
  if (field.readOnly) return <ReadOnlyValue {...props} />;
  switch (field.type) {
    case "code": return (
      <>
        {field.code?.layout === "dropdown" ? <CodeSelect {...props} /> : <CodeButtons {...props} />}
        <Qualifiers {...props} />
      </>
    );
    case "boolean": return <BooleanInput {...props} />;
    case "integer":
    case "real": return <TextInput {...props} numeric />;
    case "text": return <TextInput {...props} />;
    case "memo": return <TextInput {...props} multiline />;
    case "date": return <DateTimeInput {...props} kind="date" />;
    case "time": return <DateTimeInput {...props} kind="time" />;
    case "coordinate": return <CoordinateInput {...props} />;
    case "integerRange":
    case "realRange": return <RangeInput {...props} />;
    default: return <UnsupportedNotice />;
  }
}

function UnsupportedNotice() {
  const t = useT();
  return <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>{t("entry.unsupported")}</Typography>;
}

function ReadOnlyValue({ field, value, info, dense }: FieldProps) {
  const t = useT();
  let text = value;
  if (field.type === "code" && field.code) {
    text = parseCodes(value).map(({ code: c, qualifier }) => (field.code!.items.find((i) => i.code === c)?.label
      ?? info?.possibleCodedItems?.find((i) => i.code === c)?.label ?? c) + (qualifier ? `: ${qualifier}` : "")).join(", ");
  } else if (field.type === "boolean") {
    text = value === "true" ? t("entry.yes") : value === "false" ? t("entry.no") : "";
  }
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
      <Typography variant="body1" sx={{ fontWeight: 500 }}>{text || "—"}{text && field.unit ? ` ${field.unit}` : ""}</Typography>
      {/* in a table, the column says it once */}
      {field.calculated && !dense && <Typography variant="caption" color="text.secondary">{t("entry.calculated")}</Typography>}
    </Stack>
  );
}

/**
 * Items as chips that wrap: every option visible at once, one click to answer (the balloon's buttons). A single choice
 * stays chosen when clicked again; the × after it (for the mouse), or Delete or Backspace on its buttons, clears it.
 * The question is one Tab stop: the arrows go from answer to answer, Space or Enter picks one, and 1 to 9 the n-th.
 */
function CodeButtons({ field, value, items, parentLabel, onChange, error, describedBy, required }: ControlProps) {
  const t = useT();
  const answeredByKey = useContext(AnsweredByKey);
  const group = useRef<HTMLDivElement>(null);
  // the code of the answer focused, which keeps the question's Tab stop while the focus is among the answers
  const [focused, setFocused] = useState<string | null>(null);
  const selected = parseCodes(value).map((c) => c.code);
  if (!items.length) {
    return <Typography variant="body2" color="text.secondary">{parentLabel ? t("entry.chooseParent", { parent: parentLabel }) : t("entry.noOptions")}</Typography>;
  }
  // The Tab stop: the answer focused, else the one chosen (Tab lands on it), else the first
  const focusedAt = items.findIndex((i) => i.code === focused);
  const stop = focusedAt >= 0 ? focusedAt : Math.max(0, items.findIndex((i) => selected.includes(i.code)));
  const pick = (code: string, byKey: boolean) => {
    const codes = clickCode(selected, code, !!field.multiple);
    if (codes) onChange(field.name, selectCodes(value, codes));
    // a single choice made from the keyboard is done with, even when it was the answer already chosen
    if (byKey && !field.multiple) answeredByKey(field.name);
  };
  const clearable = !field.multiple && selected.length > 0;
  // the × goes once the answer is cleared: the focus goes to the question, not to the page
  const clear = () => {
    onChange(field.name, selectCodes(value, []));
    group.current?.querySelector<HTMLElement>("[role=radio]")?.focus();
  };
  // The × beside the answers, out of their group, and wrapping after them: it never moves them when it comes and goes
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}
      onKeyDown={(e) => {
        if (clearable && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); clear(); return; }
        const chips = [...(group.current?.querySelectorAll<HTMLElement>("[data-code]") ?? [])];
        const at = chips.indexOf(e.target as HTMLElement);
        // the ×, focused by a click, is no answer: its keys are its own
        if (at < 0) return;
        const action = choiceKey(e, at, items.length);
        if (!action) return;
        e.preventDefault();
        if ("focus" in action) {
          chips[action.focus]?.focus();
        } else {
          chips[action.pick]?.focus();
          pick(items[action.pick].code, true);
        }
      }}>
      <Box ref={group} role={field.multiple ? "group" : "radiogroup"} aria-label={field.label} id={field.name}
        aria-invalid={error || undefined} aria-describedby={describedBy} aria-required={required || undefined}
        // the focus gone elsewhere, Tab comes back to the answer chosen
        onBlur={(e) => { if (!group.current?.contains(e.relatedTarget as Node | null)) setFocused(null); }}
        sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, ...KEY_HINTS_SX, ...(error && { p: 0.5, borderRadius: 2, outline: 1, outlineColor: "error.main" }) }}>
        {items.map((item, i) => {
          const on = selected.includes(item.code);
          const chip = (
            <Chip key={item.id} label={<>{item.label}<KeyHint index={i} /></>} clickable
              onClick={(e) => pick(item.code, isKeyboardClick(e))} onFocus={() => setFocused(item.code)} tabIndex={i === stop ? 0 : -1}
              icon={on ? <CheckIcon /> : undefined}
              role={field.multiple ? "checkbox" : "radio"} aria-checked={on} data-code={item.code}
              sx={on ? CODE_ON_SX : CODE_SX} />
          );
          return item.description ? <Description key={item.id} title={item.description}>{chip}</Description> : chip;
        })}
      </Box>
      {clearable && <ClearButton onClear={clear} />}
    </Box>
  );
}

/** The × after the answers, for the mouse: the keyboard has Delete on the answers, so it is not in the Tab order */
function ClearButton({ onClear }: { onClear: () => void }) {
  const t = useT();
  return (
    <Tooltip title={t("entry.clear")}>
      <IconButton size="small" tabIndex={-1} aria-label={t("entry.clear")} data-testid="entry-clear" onClick={onClear}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

/**
 * The number key of the answer at `index`, in a corner of its button: shown only while the question has the keyboard's
 * focus (see KEY_HINTS_SX), so the mouse never sees it, and over the button, so it moves nothing when it shows.
 */
function KeyHint({ index }: { index: number }) {
  if (index >= 9) return null;
  return <Box component="span" aria-hidden className="ce-key-hint" sx={KEY_HINT_SX}>{index + 1}</Box>;
}

/** On the answers of a question: their number keys shown while one of them has the keyboard's focus */
const KEY_HINTS_SX = {
  "& .ce-key-hint": { display: "none" },
  "&:has(.Mui-focusVisible) .ce-key-hint": { display: "block" },
} as const;
const KEY_HINT_SX = {
  position: "absolute", top: -6, left: -5, minWidth: 14, height: 14, px: "3px", borderRadius: 7, pointerEvents: "none",
  fontSize: 10, fontWeight: 700, lineHeight: "12px", textAlign: "center",
  bgcolor: "background.paper", color: "text.secondary", border: 1, borderColor: "divider",
} as const;

// The balloon's code buttons: cyan Bootstrap "info" buttons, dark teal once chosen
const CODE_SX = {
  position: "relative", height: "auto", minHeight: 32, py: 0.5, borderRadius: 1, border: 1, fontWeight: 500,
  bgcolor: "balloon.code", borderColor: "balloon.codeBorder", color: "balloon.codeText",
  "& .MuiChip-label": { whiteSpace: "normal" },
  "&:hover, &.Mui-focusVisible": { bgcolor: "balloon.codeHover" },
} as const;
const CODE_ON_SX = {
  ...CODE_SX, fontWeight: 600,
  bgcolor: "balloon.codeOn", borderColor: "balloon.codeOnBorder", color: "balloon.codeOnText",
  "& .MuiChip-icon": { color: "inherit", fontSize: 18 },
  "&:hover, &.Mui-focusVisible": { bgcolor: "balloon.codeOn", filter: "brightness(1.1)" },
} as const;
const TOGGLE_SX = {
  ...CODE_SX, px: 2.5, fontWeight: 600, minHeight: 0, py: 0.75,
  "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "balloon.codeOn", borderColor: "balloon.codeOnBorder", color: "balloon.codeOnText" },
} as const;

/** Long lists: a searchable dropdown. */
function CodeSelect({ field, value, items, parentLabel, onChange, error, dense, describedBy, required }: ControlProps) {
  const t = useT();
  const codes = parseCodes(value).map((c) => c.code);
  const byCode = (c: string) => items.find((i) => i.code === c) ?? { id: -1, code: c, label: c };
  const placeholder = !items.length && parentLabel ? t("entry.chooseParent", { parent: parentLabel }) : t("entry.select");
  const common = {
    id: field.name,
    options: items,
    size: "small" as const,
    disabled: !items.length && !codes.length,
    getOptionLabel: (o: CodeItem) => o.label,
    isOptionEqualToValue: (a: CodeItem, b: CodeItem) => a.code === b.code,
    noOptionsText: t("entry.noOptions"),
    // Typing part of a label then Enter picks the first match
    autoHighlight: true,
    renderOption: (p: HTMLAttributes<HTMLLIElement> & { key: Key }, o: CodeItem) => {
      const { key, ...rest } = p;
      return <li key={key} {...rest} title={o.description} data-code={o.code}>{o.label}</li>;
    },
    // in a table: wide enough to read the item, narrower in a narrow form, so the table fits without scrolling
    sx: dense ? { minWidth: 220, "@media (max-width: 480px)": { minWidth: 136 } } : undefined,
  };
  if (field.multiple) {
    return (
      <Autocomplete multiple {...common} value={codes.map(byCode)} disableCloseOnSelect
        onChange={(_, v) => onChange(field.name, selectCodes(value, v.map((i) => i.code)))}
        renderInput={(params) => <TextField {...params} error={error} placeholder={codes.length ? undefined : placeholder} slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": field.label, "aria-describedby": describedBy, "aria-required": required || undefined } }} />} />
    );
  }
  return (
    <Autocomplete {...common} value={codes.length ? byCode(codes[0]) : null}
      onChange={(_, v) => onChange(field.name, selectCodes(value, v ? [v.code] : []))}
      renderInput={(params) => <TextField {...params} error={error} placeholder={placeholder} slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": field.label, "aria-describedby": describedBy, "aria-required": required || undefined } }} />} />
  );
}

/** "Other, specify": the text of each selected item that is qualifiable */
function Qualifiers({ field, value, items, onChange, dense }: ControlProps) {
  const t = useT();
  const qualifiable = parseCodes(value).filter((c) => items.find((i) => i.code === c.code)?.qualifiable
    ?? field.code?.items.find((i) => i.code === c.code)?.qualifiable);
  if (!qualifiable.length) return null;
  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {qualifiable.map((c) => {
        const item = field.code!.items.find((i) => i.code === c.code);
        return <QualifierInput key={c.code} label={t("entry.specify", { item: item?.label ?? c.code })} name={field.name}
          qualifier={c.qualifier} dense={dense} onChange={(q, delay) => onChange(field.name, qualify(value, c.code, q), delay)} />;
      })}
    </Stack>
  );
}

function QualifierInput({ label, name, qualifier, dense, onChange }: { label: string; name: string; qualifier: string; dense?: boolean;
  onChange: (qualifier: string, delay: number) => void }) {
  const [draft, setDraft] = useDraft(qualifier, (d, v) => d.trim() === v.trim());
  const typing = useRef(false);
  return (
    <TextField size="small" label={label} value={draft} fullWidth={!dense} data-qualifier-of={name}
      onChange={(e) => { setDraft(e.target.value); typing.current = true; onChange(e.target.value, TYPING_DELAY); }}
      onBlur={() => { if (typing.current) { typing.current = false; onChange(draft, 0); } }} />
  );
}

/**
 * Yes and No, as the answers of a single choice: the one chosen stays chosen when clicked or pressed again, and the ×
 * after them (for the mouse), or Delete or Backspace on them, clears it.
 */
function BooleanInput({ field, value, onChange, error, describedBy, required }: ControlProps) {
  const t = useT();
  const answeredByKey = useContext(AnsweredByKey);
  const group = useRef<HTMLDivElement>(null);
  if (field.affirmativeOnly) {
    return <FormControlLabel control={<Checkbox id={field.name} checked={value === "true"} slotProps={{ input: { "aria-describedby": describedBy, "aria-required": required || undefined } }} onChange={(e) => onChange(field.name, e.target.checked ? "true" : "")} />} label={t("entry.yes")} />;
  }
  const clear = () => {
    onChange(field.name, "");
    group.current?.querySelector<HTMLElement>("button")?.focus();
  };
  // The group moves the focus with the arrows itself; 1 answers Yes and 2 No, as the n-th answer of a list
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
      <ToggleButtonGroup ref={group} exclusive size="small" value={value || null} id={field.name} aria-label={field.label}
        aria-describedby={describedBy} aria-required={required || undefined}
        onChange={(e, v: string | null) => {
          // null: the answer chosen, clicked or pressed again, which keeps it
          if (v) onChange(field.name, v);
          if (isKeyboardClick(e as unknown as { detail: number })) answeredByKey(field.name);
        }}
        onKeyDown={(e) => {
          if (value && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); clear(); return; }
          const action = choiceKey(e, 0, BOOLEAN_VALUES.length);
          if (!action || !("pick" in action)) return;
          e.preventDefault();
          group.current?.querySelectorAll<HTMLElement>("button")[action.pick]?.focus();
          // the same answer again changes nothing (a plot submitted stays so), but goes on to the next question
          if (value !== BOOLEAN_VALUES[action.pick]) onChange(field.name, BOOLEAN_VALUES[action.pick]);
          answeredByKey(field.name);
        }}
        sx={{ ...KEY_HINTS_SX, ...(error && { outline: 1, outlineColor: "error.main", borderRadius: 1 }) }}>
        <ToggleButton value="true" sx={TOGGLE_SX}>{t("entry.yes")}<KeyHint index={0} /></ToggleButton>
        <ToggleButton value="false" sx={TOGGLE_SX}>{t("entry.no")}<KeyHint index={1} /></ToggleButton>
      </ToggleButtonGroup>
      {value && <ClearButton onClear={clear} />}
    </Box>
  );
}
const BOOLEAN_VALUES = ["true", "false"] as const;

/**
 * Keeps what is typed locally while the debounced save runs, so the caret never jumps: a value coming
 * back from the store replaces the draft only when it is a different value (not "1,5" saved as "1.5").
 */
function useDraft(value: string, same: (draft: string, value: string) => boolean = (a, b) => a === b): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft((d) => (same(d, value) ? d : value)), [value]);
  return [draft, setDraft];
}

function TextInput({ field, value, onChange, error, describedBy, required, dense, numeric, multiline }: ControlProps & { numeric?: boolean; multiline?: boolean }) {
  const [draft, setDraft] = useDraft(value, numeric ? (d, v) => normalizeNumber(d) === v : undefined);
  // typed but still waiting for the typing pause: leaving the field saves at once
  const typing = useRef(false);
  const commit = (v: string, delay: number) => onChange(field.name, numeric ? normalizeNumber(v) : v, delay);
  return (
    <TextField id={field.name} size="small" fullWidth={!dense} value={draft} error={error} multiline={multiline} minRows={multiline ? 3 : undefined}
      onChange={(e) => { setDraft(e.target.value); typing.current = true; commit(e.target.value, TYPING_DELAY); }}
      onBlur={() => { if (typing.current) { typing.current = false; commit(draft, 0); } }}
      slotProps={{
        htmlInput: { inputMode: numeric ? (field.type === "integer" ? "numeric" : "decimal") : undefined, "aria-label": field.label, "aria-describedby": describedBy, "aria-required": required || undefined },
        input: field.unit ? { endAdornment: <InputAdornment position="end">{field.unit}</InputAdornment> } : undefined,
      }}
      sx={numeric && !dense ? { maxWidth: 240 } : undefined} />
  );
}

function DateTimeInput({ field, value, onChange, error, describedBy, required, kind }: ControlProps & { kind: "date" | "time" }) {
  const shown = kind === "date" ? dateToInput(value) : timeToInput(value);
  return (
    <TextField id={field.name} size="small" type={kind} value={shown} error={error} sx={{ maxWidth: 220 }}
      slotProps={{ htmlInput: { "aria-label": field.label, "aria-describedby": describedBy, "aria-required": required || undefined } }}
      onChange={(e) => onChange(field.name, kind === "date" ? dateFromInput(e.target.value) : e.target.value)} />
  );
}

function RangeInput({ field, value, onChange, error, describedBy, required }: ControlProps) {
  const t = useT();
  const [from, to] = rangeToInput(value);
  const sameNumber = (d: string, v: string) => normalizeNumber(d) === v;
  const [dFrom, setFrom] = useDraft(from, sameNumber);
  const [dTo, setTo] = useDraft(to, sameNumber);
  const typing = useRef(false);
  const commit = (a: string, b: string, delay: number) => {
    typing.current = delay > 0;
    onChange(field.name, rangeFromInput(normalizeNumber(a), normalizeNumber(b)), delay);
  };
  // as in a text box, leaving one of the two saves at once what was typed
  const onBlur = () => { if (typing.current) commit(dFrom, dTo, 0); };
  const inputMode = field.type === "integerRange" ? "numeric" : "decimal";
  const unit = field.unit ? { endAdornment: <InputAdornment position="end">{field.unit}</InputAdornment> } : undefined;
  return (
    <Stack direction="row" spacing={1} sx={{ maxWidth: 360, pt: 0.75 }}>
      <TextField id={field.name} size="small" label={t("entry.from")} value={dFrom} error={error}
        slotProps={{ htmlInput: { inputMode, "aria-label": `${field.label} - ${t("entry.from")}`, "aria-describedby": describedBy, "aria-required": required || undefined }, input: unit }}
        onChange={(e) => { setFrom(e.target.value); commit(e.target.value, dTo, TYPING_DELAY); }} onBlur={onBlur} />
      <TextField size="small" label={t("entry.to")} value={dTo} error={error}
        slotProps={{ htmlInput: { inputMode, "aria-label": `${field.label} - ${t("entry.to")}`, "aria-describedby": describedBy, "aria-required": required || undefined }, input: unit }}
        onChange={(e) => { setTo(e.target.value); commit(dFrom, e.target.value, TYPING_DELAY); }} onBlur={onBlur} />
    </Stack>
  );
}

function CoordinateInput({ field, value, onChange, error, describedBy, required }: ControlProps) {
  const t = useT();
  const [lat, lon] = coordinateToInput(value);
  const sameNumber = (d: string, v: string) => normalizeNumber(d) === v;
  const [dLat, setLat] = useDraft(lat, sameNumber);
  const [dLon, setLon] = useDraft(lon, sameNumber);
  const typing = useRef(false);
  const commit = (a: string, b: string, delay: number) => {
    typing.current = delay > 0;
    onChange(field.name, coordinateFromInput(normalizeNumber(a), normalizeNumber(b)), delay);
  };
  const onBlur = () => { if (typing.current) commit(dLat, dLon, 0); };
  return (
    <Stack direction="row" spacing={1} sx={{ pt: 0.75 }}>
      <TextField size="small" label={t("entry.latitude")} value={dLat} error={error} slotProps={{ htmlInput: { inputMode: "decimal", "aria-describedby": describedBy, "aria-required": required || undefined } }}
        onChange={(e) => { setLat(e.target.value); commit(e.target.value, dLon, TYPING_DELAY); }} onBlur={onBlur} />
      <TextField size="small" label={t("entry.longitude")} value={dLon} error={error} slotProps={{ htmlInput: { inputMode: "decimal", "aria-describedby": describedBy, "aria-required": required || undefined } }}
        onChange={(e) => { setLon(e.target.value); commit(dLat, e.target.value, TYPING_DELAY); }} onBlur={onBlur} />
    </Stack>
  );
}

