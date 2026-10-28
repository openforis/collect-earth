import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState, type FormEvent } from "react";
import { renameProject } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { useT } from "../i18n";

export function SettingsTab({ projectId, name, onRenamed }: { projectId: string; name: string; onRenamed: (name: string) => void }) {
  const t = useT();
  const { refreshMe } = useApp();
  const [value, setValue] = useState(name);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    const next = value.trim();
    if (!next) {
      setEmpty(true);
      return;
    }
    setBusy(true);
    try {
      await renameProject(projectId, next);
      onRenamed(next);
      setDone(true);
      void refreshMe();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack component="form" spacing={2} onSubmit={submit} noValidate>
        <Typography variant="h2">{t("settings.title")}</Typography>
        <TextField
          label={t("settings.nameLabel")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setEmpty(false);
            setDone(false);
          }}
          error={empty}
          helperText={empty ? t("error.required") : t("settings.nameHelp")}
          required
        />
        {done && (
          <Alert severity="success" role="status">
            {t("settings.renamed")}
          </Alert>
        )}
        <ErrorAlert error={error} />
        <Box>
          <Button type="submit" variant="contained" disabled={busy || value.trim() === name}>
            {t("common.save")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
