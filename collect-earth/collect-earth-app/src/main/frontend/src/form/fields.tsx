import { type HTMLAttributes, type Key, memo, useEffect, useRef, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useT } from "../i18n";
import {
  type CodeItem, type Field, type FieldInfo, coordinateFromInput, coordinateToInput, dateFromInput,
  dateToInput, normalizeNumber, parseCodes, qualify, rangeFromInput, rangeToInput, selectCodes, timeToInput,
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
}

/** Label, description, control and the server's error message of one field. */
export const FieldView = memo(function FieldView(props: FieldProps) {
  const { field, info, dense } = props;
  if (info?.visible === false) return null;
  const error = info?.inError ? info.errorMessage || " " : null;
  return (
    <Box data-field={field.name} data-error={error ? "true" : undefined} sx={{ minWidth: 0 }}>
      {!dense && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 0.75 }}>
          <Typography component="label" htmlFor={field.name} variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
            {field.label}
          </Typography>
          {field.description && (
            <Tooltip title={field.description}>
              <InfoOutlinedIcon fontSize="small" color="action" sx={{ fontSize: 16, cursor: "help" }} aria-label={field.description} />
            </Tooltip>
          )}
        </Stack>
      )}
      <Control {...props} error={!!error} />
      {error && error.trim() && <FormHelperText error sx={{ mx: 0, mt: 0.5 }}>{error}</FormHelperText>}
    </Box>
  );
});

function Control(props: FieldProps & { error: boolean }) {
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

function ReadOnlyValue({ field, value, info }: FieldProps) {
  const t = useT();
  let text = value;
  if (field.type === "code" && field.code) {
    text = parseCodes(value).map(({ code: c, qualifier }) => (field.code!.items.find((i) => i.code === c)?.label
      ?? info?.possibleCodedItems?.find((i) => i.code === c)?.label ?? c) + (qualifier ? `: ${qualifier}` : "")).join(", ");
  } else if (field.type === "boolean") {
    text = value === "true" ? t("entry.yes") : value === "false" ? t("entry.no") : "";
  }
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", minHeight: 32 }}>
      <Typography variant="body1" sx={{ fontWeight: 500 }}>{text || "—"}{text && field.unit ? ` ${field.unit}` : ""}</Typography>
      {field.calculated && <Chip size="small" variant="outlined" label={t("entry.calculated")} />}
    </Stack>
  );
}

/** Items as chips that wrap: every option visible at once, one click to answer (the balloon's buttons). */
function CodeButtons({ field, value, items, parentLabel, onChange, error }: FieldProps & { error: boolean }) {
  const t = useT();
  const selected = parseCodes(value).map((c) => c.code);
  if (!items.length) {
    return <Typography variant="body2" color="text.secondary">{parentLabel ? t("entry.chooseParent", { parent: parentLabel }) : t("entry.noOptions")}</Typography>;
  }
  const toggle = (code: string) => {
    if (field.multiple) {
      onChange(field.name, selectCodes(value, selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]));
    } else {
      onChange(field.name, selectCodes(value, selected[0] === code ? [] : [code]));
    }
  };
  return (
    <Box role={field.multiple ? "group" : "radiogroup"} aria-label={field.label} id={field.name}
      sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, ...(error && { p: 0.5, borderRadius: 2, outline: 1, outlineColor: "error.main" }) }}>
      {items.map((item) => {
        const on = selected.includes(item.code);
        const chip = (
          <Chip key={item.id} label={item.label} clickable onClick={() => toggle(item.code)}
            color={on ? "primary" : "default"} variant={on ? "filled" : "outlined"}
            role={field.multiple ? "checkbox" : "radio"} aria-checked={on} data-code={item.code}
            sx={{ height: "auto", minHeight: 32, py: 0.5, "& .MuiChip-label": { whiteSpace: "normal" }, fontWeight: on ? 600 : 400 }} />
        );
        return item.description ? <Tooltip key={item.id} title={item.description}>{chip}</Tooltip> : chip;
      })}
    </Box>
  );
}

/** Long lists: a searchable dropdown. */
function CodeSelect({ field, value, items, parentLabel, onChange, error, dense }: FieldProps & { error: boolean }) {
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
    renderOption: (p: HTMLAttributes<HTMLLIElement> & { key: Key }, o: CodeItem) => {
      const { key, ...rest } = p;
      return <li key={key} {...rest} title={o.description} data-code={o.code}>{o.label}</li>;
    },
    sx: { minWidth: dense ? 160 : undefined },
  };
  if (field.multiple) {
    return (
      <Autocomplete multiple {...common} value={codes.map(byCode)} disableCloseOnSelect
        onChange={(_, v) => onChange(field.name, selectCodes(value, v.map((i) => i.code)))}
        renderInput={(params) => <TextField {...params} error={error} placeholder={codes.length ? undefined : placeholder} slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": field.label } }} />} />
    );
  }
  return (
    <Autocomplete {...common} value={codes.length ? byCode(codes[0]) : null}
      onChange={(_, v) => onChange(field.name, selectCodes(value, v ? [v.code] : []))}
      renderInput={(params) => <TextField {...params} error={error} placeholder={placeholder} slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, "aria-label": field.label } }} />} />
  );
}

/** "Other, specify": the text of each selected item that is qualifiable */
function Qualifiers({ field, value, items, onChange, dense }: FieldProps & { error: boolean }) {
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

function BooleanInput({ field, value, onChange, error }: FieldProps & { error: boolean }) {
  const t = useT();
  if (field.affirmativeOnly) {
    return <FormControlLabel control={<Checkbox id={field.name} checked={value === "true"} onChange={(e) => onChange(field.name, e.target.checked ? "true" : "")} />} label={t("entry.yes")} />;
  }
  return (
    <ToggleButtonGroup exclusive size="small" value={value || null} id={field.name} aria-label={field.label}
      onChange={(_, v: string | null) => onChange(field.name, v ?? "")}
      sx={error ? { outline: 1, outlineColor: "error.main", borderRadius: 1 } : undefined}>
      <ToggleButton value="true" color="primary" sx={{ px: 2.5 }}>{t("entry.yes")}</ToggleButton>
      <ToggleButton value="false" color="primary" sx={{ px: 2.5 }}>{t("entry.no")}</ToggleButton>
    </ToggleButtonGroup>
  );
}

/**
 * Keeps what is typed locally while the debounced save runs, so the caret never jumps: a value coming
 * back from the store replaces the draft only when it is a different value (not "1,5" saved as "1.5").
 */
function useDraft(value: string, same: (draft: string, value: string) => boolean = (a, b) => a === b): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft((d) => (same(d, value) ? d : value)), [value]);
  return [draft, setDraft];
}

function TextInput({ field, value, onChange, error, dense, numeric, multiline }: FieldProps & { error: boolean; numeric?: boolean; multiline?: boolean }) {
  const [draft, setDraft] = useDraft(value, numeric ? (d, v) => normalizeNumber(d) === v : undefined);
  // typed but still waiting for the typing pause: leaving the field saves at once
  const typing = useRef(false);
  const commit = (v: string, delay: number) => onChange(field.name, numeric ? normalizeNumber(v) : v, delay);
  return (
    <TextField id={field.name} size="small" fullWidth={!dense} value={draft} error={error} multiline={multiline} minRows={multiline ? 3 : undefined}
      onChange={(e) => { setDraft(e.target.value); typing.current = true; commit(e.target.value, TYPING_DELAY); }}
      onBlur={() => { if (typing.current) { typing.current = false; commit(draft, 0); } }}
      slotProps={{
        htmlInput: { inputMode: numeric ? (field.type === "integer" ? "numeric" : "decimal") : undefined, "aria-label": field.label },
        input: field.unit ? { endAdornment: <InputAdornment position="end">{field.unit}</InputAdornment> } : undefined,
      }}
      sx={numeric && !dense ? { maxWidth: 240 } : undefined} />
  );
}

function DateTimeInput({ field, value, onChange, error, kind }: FieldProps & { error: boolean; kind: "date" | "time" }) {
  const shown = kind === "date" ? dateToInput(value) : timeToInput(value);
  return (
    <TextField id={field.name} size="small" type={kind} value={shown} error={error} sx={{ maxWidth: 220 }}
      slotProps={{ htmlInput: { "aria-label": field.label } }}
      onChange={(e) => onChange(field.name, kind === "date" ? dateFromInput(e.target.value) : e.target.value)} />
  );
}

function RangeInput({ field, value, onChange, error }: FieldProps & { error: boolean }) {
  const t = useT();
  const [from, to] = rangeToInput(value);
  const sameNumber = (d: string, v: string) => normalizeNumber(d) === v;
  const [dFrom, setFrom] = useDraft(from, sameNumber);
  const [dTo, setTo] = useDraft(to, sameNumber);
  const commit = (a: string, b: string, delay: number) => onChange(field.name, rangeFromInput(normalizeNumber(a), normalizeNumber(b)), delay);
  const inputMode = field.type === "integerRange" ? "numeric" : "decimal";
  const unit = field.unit ? { endAdornment: <InputAdornment position="end">{field.unit}</InputAdornment> } : undefined;
  return (
    <Stack direction="row" spacing={1} sx={{ maxWidth: 360, pt: 0.75 }}>
      <TextField id={field.name} size="small" label={t("entry.from")} value={dFrom} error={error}
        slotProps={{ htmlInput: { inputMode, "aria-label": `${field.label} - ${t("entry.from")}` }, input: unit }}
        onChange={(e) => { setFrom(e.target.value); commit(e.target.value, dTo, TYPING_DELAY); }} />
      <TextField size="small" label={t("entry.to")} value={dTo} error={error}
        slotProps={{ htmlInput: { inputMode, "aria-label": `${field.label} - ${t("entry.to")}` }, input: unit }}
        onChange={(e) => { setTo(e.target.value); commit(dFrom, e.target.value, TYPING_DELAY); }} />
    </Stack>
  );
}

function CoordinateInput({ field, value, onChange, error }: FieldProps & { error: boolean }) {
  const t = useT();
  const [lat, lon] = coordinateToInput(value);
  const sameNumber = (d: string, v: string) => normalizeNumber(d) === v;
  const [dLat, setLat] = useDraft(lat, sameNumber);
  const [dLon, setLon] = useDraft(lon, sameNumber);
  const commit = (a: string, b: string, delay: number) => onChange(field.name, coordinateFromInput(normalizeNumber(a), normalizeNumber(b)), delay);
  return (
    <Stack direction="row" spacing={1} sx={{ pt: 0.75 }}>
      <TextField size="small" label={t("entry.latitude")} value={dLat} error={error} slotProps={{ htmlInput: { inputMode: "decimal" } }}
        onChange={(e) => { setLat(e.target.value); commit(e.target.value, dLon, TYPING_DELAY); }} />
      <TextField size="small" label={t("entry.longitude")} value={dLon} error={error} slotProps={{ htmlInput: { inputMode: "decimal" } }}
        onChange={(e) => { setLon(e.target.value); commit(dLat, e.target.value, TYPING_DELAY); }} />
    </Stack>
  );
}

