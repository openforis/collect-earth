import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Add from "@mui/icons-material/Add";
import FilterAlt from "@mui/icons-material/FilterAlt";
import Search from "@mui/icons-material/Search";
import { useEffect, useMemo, useState } from "react";
import { filterValues, withRangeFilter, withValuesFilter, type Filter } from "../../analysisQuestion";
import type { Cube, CubeColumn } from "../../analysisView";
import { formatNumber } from "../../format";
import { useApp } from "../../appContext";
import { useT } from "../../i18n";
import { ErrorAlert } from "../ErrorAlert";
import { fieldOptions } from "./QuestionBar";

/** A field's values with how many rows have each (the other filters applied), from DuckDB. */
export type LoadValues = (column: string, filters: Filter[]) => Promise<{ value: unknown; n: number }[]>;

const show = (v: unknown) => (v === true ? "✓" : v === false ? "✗" : String(v));

/** A filter in a few words, for its chip: "Land use: Forest, Cropland", "Trees (%) ≥ 10". */
export function filterText(column: string, filters: readonly Filter[], t: ReturnType<typeof useT>): string {
  // Perspective adds empty values for the total rows of a cell it was clicked in: they say nothing
  const values = filterValues(filters, column)?.filter((v) => v !== null && v !== undefined) ?? null;
  if (values) {
    const shown = values.slice(0, 3).map(show).join(", ");
    return values.length > 3 ? t("analysis.f.chipMore", { field: column, values: shown, more: values.length - 3 }) : `${column}: ${shown}`;
  }
  const from = filters.find(([c, op]) => c === column && op === ">=")?.[2];
  const to = filters.find(([c, op]) => c === column && op === "<=")?.[2];
  if (from !== undefined && to !== undefined) return `${column}: ${show(from)} – ${show(to)}`;
  if (from !== undefined) return `${column} ≥ ${show(from)}`;
  if (to !== undefined) return `${column} ≤ ${show(to)}`;
  return filters
    .filter(([c]) => c === column)
    .map(([c, op, v]) => `${c} ${op} ${v === null || v === undefined ? "" : show(v)}`.trim())
    .join(" · ");
}

/**
 * The filters, as chips over the pivot (Saiku's filter axis): each field filtered once, by a list of its values or
 * by a range; clicking a chip opens its values again. Filters made in Perspective's own panel show here too.
 */
export function FilterBar({ cube, filters, onChange, loadValues, disabled }: { cube: Cube; filters: Filter[]; onChange: (f: Filter[]) => void; loadValues: LoadValues; disabled?: boolean }) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const columns = [...new Set(filters.map(([c]) => c))];
  const fields = fieldOptions(cube);
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }} role="group" aria-label={t("analysis.f.label")}>
      <FilterAlt fontSize="small" color="action" />
      {columns.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("analysis.f.none")}
        </Typography>
      )}
      {columns.map((c) => (
        <Chip
          key={c}
          label={filterText(c, filters, t)}
          onClick={cube.columns.some((x) => x.name === c) ? () => setEditing(c) : undefined}
          onDelete={() => onChange(filters.filter(([x]) => x !== c))}
          disabled={disabled}
          color="primary"
          variant="outlined"
          sx={{ maxWidth: 420 }}
        />
      ))}
      {choosing ? (
        <Autocomplete
          size="small"
          openOnFocus
          autoHighlight
          options={fields.map((f) => f.name)}
          groupBy={(n) => t(`analysis.group.${fields.find((f) => f.name === n)?.group ?? "survey"}`)}
          onChange={(_, v) => {
            setChoosing(false);
            if (v) setEditing(v);
          }}
          onBlur={() => setChoosing(false)}
          renderInput={(params) => <TextField {...params} autoFocus label={t("analysis.f.which")} />}
          sx={{ width: 300 }}
        />
      ) : (
        <Button size="small" startIcon={<Add />} onClick={() => setChoosing(true)} disabled={disabled}>
          {t("analysis.f.add")}
        </Button>
      )}
      {editing && (
        <FilterDialog
          column={cube.columns.find((x) => x.name === editing)!}
          filters={filters}
          loadValues={loadValues}
          onClose={() => setEditing(null)}
          onApply={(next) => {
            setEditing(null);
            onChange(next);
          }}
        />
      )}
    </Box>
  );
}

/** The values of one field to tick (with a search and their counts), or a range for a number or a date. */
function FilterDialog({ column, filters, loadValues, onClose, onApply }: { column: CubeColumn; filters: Filter[]; loadValues: LoadValues; onClose: () => void; onApply: (f: Filter[]) => void }) {
  const t = useT();
  const { language } = useApp();
  const range = column.kind === "number" || column.kind === "date";
  const [values, setValues] = useState<{ value: unknown; n: number }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const initial = filterValues(filters, column.name);
  const [picked, setPicked] = useState<Set<string>>(() => new Set((initial ?? []).map((v) => JSON.stringify(v))));
  const [from, setFrom] = useState(String(filters.find(([c, op]) => c === column.name && op === ">=")?.[2] ?? ""));
  const [to, setTo] = useState(String(filters.find(([c, op]) => c === column.name && op === "<=")?.[2] ?? ""));

  useEffect(() => {
    if (range) return;
    let live = true;
    loadValues(column.name, filters).then(
      (v) => live && setValues(v),
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
    // the list is read once, when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.name]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (values ?? []).filter((v) => !q || show(v.value).toLowerCase().includes(q));
  }, [values, search]);
  const toggle = (key: string) => setPicked((p) => (p.has(key) ? new Set([...p].filter((x) => x !== key)) : new Set([...p, key])));
  const apply = () => {
    if (range) {
      const v = (x: string) => (x.trim() === "" ? null : column.kind === "number" ? Number(x) : x);
      onApply(withRangeFilter(filters, column.name, v(from), v(to)));
    } else {
      onApply(withValuesFilter(filters, column.name, [...picked].map((k) => JSON.parse(k) as unknown)));
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t("analysis.f.title", { field: column.name })}</DialogTitle>
      <DialogContent dividers>
        {range ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t("analysis.f.rangeHelp")}
            </Typography>
            <TextField label={t("analysis.f.from")} type={column.kind === "date" ? "date" : "number"} value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label={t("analysis.f.to")} type={column.kind === "date" ? "date" : "number"} value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
        ) : (
          <Stack spacing={1}>
            <ErrorAlert error={error} />
            {!values && !error && <LinearProgress />}
            {values && (
              <>
                <TextField
                  size="small"
                  placeholder={t("analysis.f.search")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
                />
                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <Button size="small" onClick={() => setPicked(new Set([...picked, ...shown.map((v) => JSON.stringify(v.value))]))}>
                    {t("analysis.f.all")}
                  </Button>
                  <Button size="small" onClick={() => setPicked(new Set())}>
                    {t("analysis.f.clear")}
                  </Button>
                  <Typography variant="body2" color="text.secondary" sx={{ ml: "auto" }}>
                    {picked.size ? t("analysis.f.picked", { count: picked.size }) : t("analysis.f.everything")}
                  </Typography>
                </Box>
                {values.length === 0 && <Typography color="text.secondary">{t("analysis.f.noValues")}</Typography>}
                <List dense sx={{ maxHeight: 360, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1 }}>
                  {shown.map((v) => {
                    const key = JSON.stringify(v.value);
                    return (
                      <ListItemButton key={key} onClick={() => toggle(key)} dense>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox edge="start" size="small" checked={picked.has(key)} tabIndex={-1} disableRipple />
                        </ListItemIcon>
                        <ListItemText primary={show(v.value)} />
                        <Typography variant="body2" color="text.secondary">
                          {formatNumber(v.n, language)}
                        </Typography>
                      </ListItemButton>
                    );
                  })}
                </List>
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="contained" onClick={apply} disabled={!range && !values}>
          {t("analysis.f.apply")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
