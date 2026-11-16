import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Add from "@mui/icons-material/Add";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import OpenInNew from "@mui/icons-material/OpenInNew";
import { useId, useMemo, useState } from "react";
import { EXPLORER_URL, getCatalogue } from "../api/explorer";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { useT, type MessageKey, type Translate } from "../i18n";
import { useLoad } from "../useLoad";
import {
  add, docSize, entryErrors, EXPLORER_CONFIG_MAX, move, parseDoc, previewUrl, remove, serialiseDoc,
  type Catalogue, type Doc, type Entry, type EntryError, type Kind, type ParamSpec,
} from "./explorerConfig";

// shortcut: Preview opens on a fixed forest-edge point in Rondônia, Brazil; the project's own first plot would need a lookup the API does not offer cheaply
const SAMPLE_PLOT = { lat: -9.97, lon: -62.98 };
const SIZE_SHOWN = 1500;
const KINDS: Kind[] = ["layers", "charts"];

/** The message under `key`, or `fallback` where the dashboard has none (a type or parameter newer than its texts). */
const textOr = (t: Translate, key: string, fallback: string) => {
  const text = t(key as MessageKey);
  return text === key ? fallback : text;
};

/**
 * The Imagery card's Explorer section: which layers and charts the Explorer window shows for this project, built from
 * the Explorer's catalogue. `stored` is what the server has, `value` what the form holds now (the section is unmounted
 * while the Earth Engine app is off); `onChange` gets the text to store and whether it may be saved.
 */
export function ExplorerSection({ stored, value, onChange }: { stored: string; value: string; onChange: (text: string, invalid: boolean) => void }) {
  const t = useT();
  const id = useId();
  const loaded = useLoad(["explorer", "catalogue"], getCatalogue);
  return (
    <Stack component="section" aria-labelledby={id} spacing={2}>
      <Box>
        <Typography variant="subtitle1" component="h3" id={id} sx={{ fontWeight: 600 }}>{t("file.explorer.title")}</Typography>
        <Explain variant="body2" text={t("file.explorer.explain")} />
      </Box>
      {loaded.error ? <Alert severity="info">{t("file.explorer.unreachable")}</Alert>
        : !loaded.data ? <Loading />
        : <ExplorerEditor catalogue={loaded.data} stored={stored} value={value} onChange={onChange} />}
    </Stack>
  );
}

function ExplorerEditor({ catalogue, stored, value, onChange }: { catalogue: Catalogue; stored: string; value: string; onChange: (text: string, invalid: boolean) => void }) {
  const t = useT();
  const thisYear = new Date().getFullYear();
  const unknown = useMemo(() => parseDoc(stored, catalogue).unknown, [stored, catalogue]);
  const [doc, setDoc] = useState(() => parseDoc(value, catalogue).doc);
  const size = docSize(doc, catalogue);
  const typeName = (kind: Kind, type: string) => textOr(t, `file.explorer.type.${type}`, catalogue[kind][type].title);

  const update = (next: Doc) => {
    setDoc(next);
    const invalid = docSize(next, catalogue) > EXPLORER_CONFIG_MAX
      || KINDS.some((kind) => next[kind].some((e) => Object.keys(entryErrors(kind, e, catalogue, thisYear)).length > 0));
    onChange(serialiseDoc(next, catalogue), invalid);
  };
  const setList = (kind: Kind, list: Entry[]) => update({ ...doc, [kind]: list });

  return (
    <Stack spacing={3}>
      {unknown && <Alert severity="warning">{t("file.explorer.unknown")}</Alert>}
      {KINDS.map((kind) => (
        <Stack key={kind} spacing={1.5}>
          <Typography variant="subtitle2" component="h4">{t(`file.explorer.${kind}`)}</Typography>
          {doc[kind].map((entry, index) => (
            <EntryCard key={index} kind={kind} entry={entry} index={index} count={doc[kind].length} catalogue={catalogue} thisYear={thisYear} typeName={typeName}
              onChange={(e) => setList(kind, doc[kind].map((old, i) => (i === index ? e : old)))}
              onMove={(delta) => setList(kind, move(doc[kind], index, delta))}
              onRemove={() => setList(kind, remove(doc[kind], index))} />
          ))}
          <AddMenu label={t(kind === "layers" ? "file.explorer.addLayer" : "file.explorer.addChart")}
            types={Object.keys(catalogue[kind]).map((type) => [type, typeName(kind, type)])} onAdd={(type) => setList(kind, add(doc[kind], type))} />
        </Stack>
      ))}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <Button variant="outlined" startIcon={<OpenInNew />} href={previewUrl(EXPLORER_URL, doc, catalogue, SAMPLE_PLOT)} target="_blank" rel="noopener noreferrer">
          {t("file.explorer.preview")}
        </Button>
        <Button onClick={() => update(parseDoc("", catalogue).doc)}>{t("file.explorer.reset")}</Button>
        {size > SIZE_SHOWN && (
          <Typography variant="body2" color={size > EXPLORER_CONFIG_MAX ? "error" : "text.secondary"}>
            {t(size > EXPLORER_CONFIG_MAX ? "file.explorer.sizeOver" : "file.explorer.size", { n: size.toLocaleString(), max: EXPLORER_CONFIG_MAX.toLocaleString() })}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

function EntryCard({ kind, entry, index, count, catalogue, thisYear, typeName, onChange, onMove, onRemove }: {
  kind: Kind; entry: Entry; index: number; count: number; catalogue: Catalogue; thisYear: number; typeName: (kind: Kind, type: string) => string;
  onChange: (entry: Entry) => void; onMove: (delta: number) => void; onRemove: () => void;
}) {
  const t = useT();
  const specs = catalogue[kind][entry.type].params;
  const errors = entryErrors(kind, entry, catalogue, thisYear);
  const setParam = (name: string, value: unknown) => onChange({ ...entry, params: { ...entry.params, [name]: value } });
  // A new type keeps the values its parameters share with the old one (a label, the years)
  const setType = (type: string) => onChange({ type, params: Object.fromEntries(Object.entries(entry.params).filter(([name]) => Object.hasOwn(catalogue[kind][type].params, name))) });
  return (
    <Paper variant="outlined" role="group" aria-label={`${index + 1}. ${typeName(kind, entry.type)}`} sx={{ p: 2 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 2 }}>
        <TextField select size="small" label={t("file.explorer.type")} value={entry.type} onChange={(e) => setType(e.target.value)} sx={{ flex: 1, minWidth: 0 }}>
          {Object.keys(catalogue[kind]).map((type) => <MenuItem key={type} value={type}>{typeName(kind, type)}</MenuItem>)}
        </TextField>
        <IconButton aria-label={t("file.explorer.moveUp")} disabled={index === 0} onClick={() => onMove(-1)}><ArrowUpward /></IconButton>
        <IconButton aria-label={t("file.explorer.moveDown")} disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDownward /></IconButton>
        {/* The map always needs one imagery layer (the Explorer shows the standard ones without) */}
        <IconButton aria-label={t("file.explorer.remove")} disabled={kind === "layers" && count === 1} onClick={onRemove}><DeleteOutline /></IconButton>
      </Stack>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
        {Object.entries(specs).map(([name, spec]) => (
          <ParamField key={name} name={name} spec={spec} value={entry.params[name]} error={errors[name]} thisYear={thisYear}
            bands={catalogue.bands[entry.type] ?? []} onChange={(v) => setParam(name, v)} />
        ))}
      </Box>
    </Paper>
  );
}

/** One parameter's field, as its catalogue spec says. Blank means "not set": the default applies and nothing is stored. */
function ParamField({ name, spec, value, error, thisYear, bands, onChange }: {
  name: string; spec: ParamSpec; value: unknown; error?: EntryError; thisYear: number; bands: string[]; onChange: (value: unknown) => void;
}) {
  const t = useT();
  const id = useId();
  const label = textOr(t, `file.explorer.param.${name}`, name);
  const max = spec.type === "year" || spec.type === "yearRange" ? thisYear : spec.max;
  const message = error ? t(`file.explorer.error.${error}` as MessageKey, { min: spec.min ?? "", max: max ?? "" }) : undefined;
  const toNumber = (text: string) => (text === "" ? undefined : Number(text));
  const shown = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const common = { fullWidth: true, size: "small" as const, label, error: !!error, helperText: message };
  const number = { type: "number", htmlInput: { min: spec.min, max, step: 1 } };

  switch (spec.type) {
    case "choice": {
      const current = value === undefined || value === "" ? shown(spec.default) : shown(value);
      // A value the catalogue does not list (a document edited elsewhere) stays a choice, marked as an error
      const options = spec.values!.includes(current) || current === "" ? spec.values! : [current, ...spec.values!];
      return (
        <TextField select {...common} value={current} onChange={(e) => onChange(e.target.value)}>
          {options.map((v) => <MenuItem key={v} value={v}>{textOr(t, `file.explorer.choice.${v}`, v)}</MenuItem>)}
        </TextField>
      );
    }
    case "bool":
      return (
        <Box>
          <FormControlLabel label={label} control={<Switch checked={(value ?? spec.default) === true} onChange={(e) => onChange(e.target.checked)}
            slotProps={{ input: { "aria-describedby": error ? `${id}-error` : undefined } }} />} />
          {error && <FormHelperText error id={`${id}-error`}>{message}</FormHelperText>}
        </Box>
      );
    case "int":
    case "year":
      return (
        <TextField {...common} type={number.type} value={shown(value)} placeholder={shown(spec.default)} onChange={(e) => onChange(toNumber(e.target.value))}
          slotProps={{ htmlInput: number.htmlInput, inputLabel: { shrink: true } }} />
      );
    case "yearRange": {
      const [from, to] = Array.isArray(value) ? value : [undefined, undefined];
      const set = (a: unknown, b: unknown) => onChange(a === undefined && b === undefined ? undefined : [a, b]);
      return (
        <Box role="group" aria-labelledby={`${id}-label`}>
          <Typography variant="caption" color="text.secondary" component="div" id={`${id}-label`} sx={{ mb: 1 }}>{label}</Typography>
          <Stack direction="row" spacing={1}>
            <TextField fullWidth size="small" type="number" label={t("file.explorer.from")} error={!!error} value={shown(from)} onChange={(e) => set(toNumber(e.target.value), to)}
              slotProps={{ htmlInput: { ...number.htmlInput, "aria-describedby": error ? `${id}-to-helper-text` : undefined }, inputLabel: { shrink: true } }} />
            <TextField fullWidth size="small" type="number" id={`${id}-to`} label={t("file.explorer.to")} error={!!error} helperText={message} value={shown(to)}
              onChange={(e) => set(from, toNumber(e.target.value))} slotProps={{ htmlInput: number.htmlInput, inputLabel: { shrink: true } }} />
          </Stack>
        </Box>
      );
    }
    case "date":
      return <TextField {...common} type="date" value={shown(value)} onChange={(e) => onChange(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />;
    case "text":
      return <TextField {...common} value={shown(value)} onChange={(e) => onChange(e.target.value)} slotProps={{ htmlInput: { maxLength: spec.max } }} />;
    case "formula":
      return (
        <Box sx={{ gridColumn: "1 / -1" }}>
          <TextField {...common} value={shown(value)} onChange={(e) => onChange(e.target.value)} helperText={message ?? t("file.explorer.formulaHint", { bands: bands.join(", ") })}
            slotProps={{ htmlInput: { maxLength: spec.max, spellCheck: false, style: { fontFamily: "monospace" } } }} />
        </Box>
      );
    default:
      return null; // a parameter type newer than this dashboard: left as stored
  }
}

function AddMenu({ label, types, onAdd }: { label: string; types: string[][]; onAdd: (type: string) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const id = useId();
  return (
    <Box>
      <Button startIcon={<Add />} aria-haspopup="menu" aria-controls={anchor ? id : undefined} aria-expanded={!!anchor} onClick={(e) => setAnchor(e.currentTarget)}>{label}</Button>
      <Menu id={id} anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {types.map(([type, name]) => <MenuItem key={type} onClick={() => { onAdd(type); setAnchor(null); }}>{name}</MenuItem>)}
      </Menu>
    </Box>
  );
}
