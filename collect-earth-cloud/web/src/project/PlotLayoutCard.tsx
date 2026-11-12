import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { getPlotLayout, setPlotLayout } from "../api";
import { ErrorAlert } from "../components/ErrorAlert";
import { CardFrame } from "../components/FoldingCard";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { useT, type MessageKey } from "../i18n";
import { useLoad } from "../useLoad";
import { PlotShapePreview } from "./PlotShapePreview";
import {
  BUFFER_SHAPES, isShown, layoutChanges, layoutErrors, NUMBER_FIELDS, numberLabel, POINT_COUNTS, SAMPLE_SHAPES, shownLayout, type PlotLayoutValues,
} from "./plotLayoutView";

/** The plot layout of the project file (Collect Earth's Settings > Plot), which Collect Earth applies by itself. */
export function PlotLayoutCard({ projectId }: { projectId: string }) {
  const t = useT();
  const loaded = useLoad(() => getPlotLayout(projectId), [projectId]);
  if (loaded.error) return <ErrorAlert error={loaded.error} onRetry={loaded.reload} />;
  if (!loaded.data) return <Loading />;
  const shown = shownLayout(loaded.data.layout);
  return (
    <CardFrame
      title={t("file.layout.title")}
      fold={`${t(`file.layout.shape.${shown.sample_shape}` as MessageKey)} · ${t("fold.points", { count: shown.number_of_sampling_points_in_plot })}`}
    >
      <Explain sx={{ mb: 2 }} text={t("file.layout.explain")} />
      <LayoutForm projectId={projectId} stored={loaded.data.layout} recordsExist={loaded.data.recordsExist} onSaved={loaded.reload} />
    </CardFrame>
  );
}

function LayoutForm({ projectId, stored, recordsExist, onSaved }: { projectId: string; stored: PlotLayoutValues; recordsExist: boolean; onSaved: () => void }) {
  const t = useT();
  const initial = useMemo(() => shownLayout(stored), [stored]);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const errors = layoutErrors(values);
  const changes = layoutChanges(stored, initial, values);
  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await setPlotLayout(projectId, changes);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const choice = (key: string, options: readonly string[], label: (o: string) => string) => (
    <TextField select fullWidth label={t(`file.layout.${key}` as MessageKey)} value={values[key]} onChange={(e) => set(key, e.target.value)}>
      {options.map((o) => <MenuItem key={o} value={o}>{label(o)}</MenuItem>)}
    </TextField>
  );

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: { md: "flex-start" } }}>
      <Stack spacing={2} sx={{ flex: 1, minWidth: 0 }}>
      {choice("sample_shape", SAMPLE_SHAPES, (o) => t(`file.layout.shape.${o}` as MessageKey))}
      {isShown("number_of_sampling_points_in_plot", values) &&
        choice("number_of_sampling_points_in_plot", POINT_COUNTS, (o) => (o === "0" || o === "1" ? t(`file.layout.points.${o}` as MessageKey) : `${Math.sqrt(Number(o))}x${Math.sqrt(Number(o))}`))}
      {NUMBER_FIELDS.filter((f) => f.key !== "distance_to_buffers" && isShown(f.key, values)).map((f) => <NumberInput key={f.key} field={f.key} values={values} errors={errors} onChange={set} />)}
      {isShown("buffer_shape", values) && choice("buffer_shape", BUFFER_SHAPES, (o) => t(`file.layout.buffer.${o}` as MessageKey))}
      {isShown("distance_to_buffers", values) && <NumberInput field="distance_to_buffers" values={values} errors={errors} onChange={set} />}
      </Stack>
      <Box sx={{ width: { xs: "100%", md: 320 }, flexShrink: 0 }}>
        <PlotShapePreview values={values} />
      </Box>
      </Stack>
      <ErrorAlert error={error} />
      {saved && <Alert severity="success" role="status">{t("file.layout.saved")}</Alert>}
      <Box>
        <Button variant="contained" disabled={busy || Object.keys(errors).length > 0 || Object.keys(changes).length === 0} onClick={() => (recordsExist ? setConfirming(true) : void save())}>
          {t("common.save")}
        </Button>
      </Box>
      <Dialog open={confirming} onClose={() => setConfirming(false)} aria-labelledby="layout-confirm" maxWidth="sm" fullWidth>
        <DialogTitle id="layout-confirm">{t("file.layout.recordsTitle")}</DialogTitle>
        <DialogContent>
          <Typography>{t("file.layout.recordsWarning")}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
          <Button variant="contained" onClick={() => void save()}>{t("file.layout.saveAnyway")}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function NumberInput({ field, values, errors, onChange }: {
  field: string;
  values: PlotLayoutValues;
  errors: ReturnType<typeof layoutErrors>;
  onChange: (key: string, value: string) => void;
}) {
  const t = useT();
  const error = errors[field];
  return (
    <TextField
      fullWidth
      label={t(numberLabel(field, values))}
      value={values[field]}
      onChange={(e) => onChange(field, e.target.value)}
      error={!!error}
      helperText={error ? t(error.key, error.key === "file.layout.range" ? { min: error.min, max: error.max } : { min: error.min }) : " "}
      slotProps={{ htmlInput: { inputMode: "numeric" } }}
    />
  );
}
