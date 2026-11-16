import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent } from "react";
import { takePlots, type CsvColumns, type DistributionSummary } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { columnLabel } from "../division";
import { formatNumber } from "../format";
import { useT } from "../i18n";

/**
 * The coordinator takes plots of the project to assess themselves (docs/plans/2026-11-16-plots-from-the-server.md): with
 * hundreds of thousands of plots, they choose how many, of one value of a column if they like, rather than getting them
 * all. Plots nobody holds and nobody has submitted; they reach the coordinator's Collect Earth with their other plots.
 */
export function TakePlots({ projectId, columns, onTaken }: { projectId: string; columns: CsvColumns; onTaken: (summary: DistributionSummary) => void }) {
  const t = useT();
  const { language } = useApp();
  const [count, setCount] = useState("50");
  const [column, setColumn] = useState<number | "">("");
  const [value, setValue] = useState("");
  const [badCount, setBadCount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  // the columns whose values are few enough to choose from (not the id)
  const choices = columns.columns.filter((c) => c.index > 0 && c.values !== null && c.values.length > 0);
  const values = column === "" ? [] : (choices.find((c) => c.index === column)?.values ?? []);
  const n = (v: number) => formatNumber(v, language);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    setError(null);
    const wanted = Number(count);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > 20000) {
      setBadCount(true);
      return;
    }
    setBusy(true);
    try {
      const result = await takePlots(projectId, wanted, column === "" ? undefined : { column, value });
      setNotice(result.taken === 0 ? t("projectPlots.take.none") : t("projectPlots.take.done", { count: n(result.taken), free: n(result.free) }));
      onTaken(result);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} data-testid="take-plots">
      <Typography variant="h2">{t("projectPlots.take.title")}</Typography>
      <Typography color="text.secondary">{t("projectPlots.take.help")}</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label={t("projectPlots.take.count")}
          type="number"
          value={count}
          onChange={(e) => {
            setCount(e.target.value);
            setBadCount(false);
          }}
          error={badCount}
          helperText={badCount ? t("projectPlots.take.countBad") : undefined}
          slotProps={{ htmlInput: { min: 1, max: 20000, inputMode: "numeric" } }}
          sx={{ minWidth: 160 }}
        />
        {choices.length > 0 && (
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel id="take-column">{t("projectPlots.take.column")}</InputLabel>
            <Select
              labelId="take-column"
              label={t("projectPlots.take.column")}
              value={column}
              onChange={(e) => {
                const raw = e.target.value as number | string;
                const next = raw === "" ? "" : Number(raw);
                setColumn(next);
                setValue(next === "" ? "" : (choices.find((c) => c.index === next)?.values?.[0]?.value ?? ""));
              }}
            >
              <MenuItem value="">{t("projectPlots.take.anyPlot")}</MenuItem>
              {choices.map((c) => (
                <MenuItem key={c.index} value={c.index}>
                  {columnLabel(c, t)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {column !== "" && (
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel id="take-value">{t("projectPlots.take.value")}</InputLabel>
            <Select labelId="take-value" label={t("projectPlots.take.value")} value={value} onChange={(e) => setValue(String(e.target.value))}>
              {values.map((v) => (
                <MenuItem key={v.value} value={v.value}>
                  {v.value === "" ? t("divide.emptyValue") : v.value} ({n(v.count)})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Stack>
      <Stack direction="row">
        <Button type="submit" variant="contained" disabled={busy}>
          {t("projectPlots.take.submit")}
        </Button>
      </Stack>
      {notice && <Alert severity="success">{notice}</Alert>}
      {error !== null && <ErrorAlert error={error} />}
    </Stack>
  );
}
