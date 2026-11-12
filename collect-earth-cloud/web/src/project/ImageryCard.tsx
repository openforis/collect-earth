import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { getImagery, setImagery } from "../api";
import { ErrorAlert } from "../components/ErrorAlert";
import { CardFrame } from "../components/FoldingCard";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { useT, type MessageKey } from "../i18n";
import { useLoad } from "../useLoad";
import { extraMapWarning, imageryChanges, imageryErrors, isShown, planetMonths, shownImagery, type ImageryValues } from "./imageryView";

/** The imagery windows of the project file (Collect Earth's Settings > Imagery), which Collect Earth applies by itself. */
export function ImageryCard({ projectId }: { projectId: string }) {
  const t = useT();
  const loaded = useLoad(() => getImagery(projectId), [projectId]);
  if (loaded.error) return <ErrorAlert error={loaded.error} onRetry={loaded.reload} />;
  if (!loaded.data) return <Loading />;
  const shown = shownImagery(loaded.data.imagery);
  const on = (["open_gee_app", "open_earth_map", "open_esri_wayback"] as const).filter((k) => shown[k] === "true").map((k) => t(`file.imagery.${k}` as MessageKey));
  return (
    <CardFrame title={t("file.imagery.title")} fold={on.length > 0 ? on.join(" · ") : t("fold.noImagery")}>
      <Explain sx={{ mb: 2 }} text={t("file.imagery.explain")} />
      <ImageryForm projectId={projectId} stored={loaded.data.imagery} onSaved={loaded.reload} />
    </CardFrame>
  );
}

function ImageryForm({ projectId, stored, onSaved }: { projectId: string; stored: ImageryValues; onSaved: () => void }) {
  const t = useT();
  const initial = useMemo(() => shownImagery(stored), [stored]);
  const today = useMemo(() => new Date(), []);
  const months = useMemo(() => planetMonths(today), [today]);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const errors = imageryErrors(values, today);
  const changes = imageryChanges(initial, values);
  const warning = extraMapWarning(values.extra_map_url);
  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setImagery(projectId, changes);
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) => (
    <FormControlLabel control={<Switch checked={values[key] === "true"} onChange={(e) => set(key, String(e.target.checked))} />} label={t(`file.imagery.${key}` as MessageKey)} />
  );
  const date = (key: string) => (
    <TextField fullWidth type="date" label={t(`file.imagery.${key}` as MessageKey)} value={values[key]} onChange={(e) => set(key, e.target.value)}
      error={!!errors[key]} helperText={errors[key] ? t(errors[key]) : t("file.imagery.dateHint")} slotProps={{ inputLabel: { shrink: true } }} />
  );
  const month = (key: string, blank: MessageKey) => {
    // A mosaic the list does not have (a file edited elsewhere) is kept as a choice
    const options = months.some((m) => m.value === values[key]) || values[key] === "" ? months : [{ value: values[key], label: values[key] }, ...months];
    return (
      <TextField select fullWidth label={t(`file.imagery.${key}` as MessageKey)} value={values[key]} onChange={(e) => set(key, e.target.value)}>
        <MenuItem value="">{t(blank)}</MenuItem>
        {options.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
      </TextField>
    );
  };

  return (
    <Stack spacing={2}>
      {toggle("open_gee_app")}
      {isShown("geeapp_date_from", values) && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          {date("geeapp_date_from")}
          {date("geeapp_date_to")}
        </Stack>
      )}
      {toggle("open_earth_map")}
      {toggle("open_esri_wayback")}
      {toggle("planet_maps_use_tfo")}
      <Typography variant="body2" color="text.secondary">{t("file.imagery.planetNote")}</Typography>
      {isShown("planet_tfo_date_from", values) && (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          {month("planet_tfo_date_from", "file.imagery.firstAvailable")}
          {month("planet_tfo_date_to", "file.imagery.latestAvailable")}
        </Stack>
      )}
      <TextField fullWidth label={t("file.imagery.extra_map_url")} value={values.extra_map_url} onChange={(e) => set("extra_map_url", e.target.value)}
        error={!!errors.extra_map_url} helperText={errors.extra_map_url ? t(errors.extra_map_url) : t(warning ?? "file.imagery.extraHint")} />
      <ErrorAlert error={error} />
      {saved && <Alert severity="success" role="status">{t("file.imagery.saved")}</Alert>}
      <Box>
        <Button variant="contained" disabled={busy || Object.keys(errors).length > 0 || Object.keys(changes).length === 0} onClick={() => void save()}>
          {t("common.save")}
        </Button>
      </Box>
    </Stack>
  );
}
