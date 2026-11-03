import { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { choiceLabel, fieldLabel, type Field, type Values } from "../../settings";
import { chooseFile } from "../../settingsApi";
import { serverText, type Texts } from "../../serverTexts";

export interface SettingFieldProps {
  field: Field;
  value: string;
  /** All the values, for the label and the description that depend on them */
  values: Values;
  texts: Texts | null;
  error?: string;
  warning?: string;
  changed: boolean;
  onChange: (value: string) => void;
  /** For the tests and the native dialog: how a file or folder is picked; the API's dialog by default */
  pickFile?: typeof chooseFile;
}

/**
 * One setting as a field of its type: text, a password with its eye, a number within its range, a switch, a choice,
 * a path with Browse, or a date. Under it the tooltip, or the error or the warning of the last validation in its
 * place; a setting only a new server reads carries a Restart chip, as applying it restarts Collect Earth.
 */
export function SettingField({ field, value, values, texts, error, warning, changed, onChange, pickFile = chooseFile }: SettingFieldProps) {
  const s = (key: string) => serverText(texts, key);
  const [shown, setShown] = useState(false);
  const label = s(fieldLabel(field, values));
  const tooltip = field.tooltip ? s(field.tooltip) : "";
  const hint = field.type === "date" ? [tooltip, s("SettingsPage.date.hint")].filter(Boolean).join(". ") : tooltip;
  const description = field.type === "choice" ? field.choices?.find((c) => c.value === value)?.description : undefined;
  const message = error ?? warning ?? hint;
  const helper = (
    <FormHelperText component="div" error={!!error} sx={{ mx: 0, color: !error && warning ? "warning.main" : undefined, whiteSpace: "pre-line" }}>
      {message}
      {description && <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 0.5 }}>{s(description)}</Typography>}
    </FormHelperText>
  );
  const chip = field.restart ? <Chip label={s("SettingsPage.restartBadge")} size="small" variant="outlined" color="warning" /> : null;
  const fieldLabelNode = (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
      <Typography variant="body2" component="label" htmlFor={"setting-" + field.key} sx={{ fontWeight: changed ? 700 : 500 }}>
        {label}{field.required && " *"}
      </Typography>
      {chip}
    </Stack>
  );
  const id = "setting-" + field.key;
  const common = {
    id, fullWidth: true, size: "small" as const, value, error: !!error,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    slotProps: { input: { "aria-describedby": id + "-help" } },
  };

  let control: React.ReactNode;
  switch (field.type) {
    case "boolean":
      return (
        <FormControl component="fieldset" data-testid={"field-" + field.key} data-changed={changed || undefined}>
          <FormControlLabel control={<Switch id={id} checked={value === "true"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />}
            label={<Stack direction="row" spacing={1} sx={{ alignItems: "center" }}><span style={{ fontWeight: changed ? 700 : 500 }}>{label}</span>{chip}</Stack>} />
          {helper}
        </FormControl>
      );
    case "password":
      control = (
        <TextField {...common} type={shown ? "text" : "password"} autoComplete="off"
          slotProps={{ input: { "aria-describedby": id + "-help", endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => setShown(!shown)} aria-label={s(shown ? "SettingsPage.hidePassword" : "SettingsPage.showPassword")}>
                {shown ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </InputAdornment>) } }} />
      );
      break;
    case "integer":
      control = <TextField {...common} type="number" slotProps={{ htmlInput: { min: field.min, max: field.max, step: 1 }, input: { "aria-describedby": id + "-help" } }} />;
      break;
    case "choice":
      control = (
        <TextField {...common} select>
          {(field.choices ?? []).map((c) => <MenuItem key={c.value} value={c.value}>{choiceLabel(c, texts)}</MenuItem>)}
        </TextField>
      );
      break;
    case "file":
    case "folder":
      control = (
        <Stack direction="row" spacing={1}>
          <TextField {...common} />
          <Button variant="outlined" size="small" sx={{ flexShrink: 0 }} onClick={async () => {
            const path = await pickFile(field.type === "folder" ? "FOLDER" : "OPEN", field.extensions ?? [], value || undefined).catch(() => null);
            if (path) onChange(path);
          }}>
            {s("OptionWizard.50")}
          </Button>
        </Stack>
      );
      break;
    case "date":
      control = <TextField {...common} type="date" slotProps={{ htmlInput: { min: "2000-01-01" }, input: { "aria-describedby": id + "-help" } }} />;
      break;
    default:
      control = <TextField {...common} />;
  }
  return (
    <Box data-testid={"field-" + field.key} data-changed={changed || undefined}>
      {fieldLabelNode}
      {control}
      <Box id={id + "-help"}>{helper}</Box>
    </Box>
  );
}
