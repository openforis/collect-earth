// "Design the survey here" (docs/plans/2026-11-18-survey-designer.md, stage 5): a project without a project file
// starts from one of Collect Earth's templates or a blank survey, with its title, the language it is written in and,
// for the templates with a list of years, its years. The server makes the project file; the survey then opens in the
// designer.

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import { useState } from "react";
import { startSurvey, type SurveyDesignAnswer, type SurveyTemplate } from "../api";
import { ErrorAlert } from "../components/ErrorAlert";
import { useT, type MessageKey } from "../i18n";
import { COMMON_LANGUAGES } from "./surveyEditView";

const TEMPLATES: Array<{ id: SurveyTemplate; name: MessageKey; help: MessageKey; years: boolean }> = [
  { id: "blank", name: "survey.new.blank", help: "survey.new.blankHelp", years: false },
  { id: "basic", name: "survey.new.basic", help: "survey.new.basicHelp", years: false },
  { id: "multipurpose", name: "survey.new.multipurpose", help: "survey.new.multipurposeHelp", years: true },
  { id: "ipcc", name: "survey.new.ipcc", help: "survey.new.ipccHelp", years: true },
];

/** The years first offered: from 2000 to last year */
const LAST_YEAR = new Date().getFullYear() - 1;

export function NewSurvey({ projectId, language, names, onMade }: {
  projectId: string;
  /** The dashboard's language: the survey's first offered */
  language: string;
  names: (code: string) => string;
  onMade: (answer: SurveyDesignAnswer) => void;
}) {
  const t = useT();
  const [template, setTemplate] = useState<SurveyTemplate>("blank");
  const [title, setTitle] = useState("");
  const [written, setWritten] = useState(language);
  const [first, setFirst] = useState("2000");
  const [last, setLast] = useState(String(LAST_YEAR));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const chosen = TEMPLATES.find((x) => x.id === template)!;
  const years = { first: Number(first), last: Number(last) };
  const yearsOk = !chosen.years || (/^\d{4}$/.test(first) && /^\d{4}$/.test(last) && years.first <= years.last && years.first >= 1900 && years.last <= 2100);
  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      onMade(await startSurvey(projectId, { template, title: title.trim(), language: written, ...(chosen.years ? { years } : {}) }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h3" gutterBottom>
        {t("survey.new.title")}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t("survey.new.explain")}
      </Typography>
      <Stack spacing={2}>
        <RadioGroup value={template} onChange={(e) => setTemplate(e.target.value as SurveyTemplate)} aria-label={t("survey.new.template")}>
          {TEMPLATES.map((x) => (
            <FormControlLabel
              key={x.id}
              value={x.id}
              control={<Radio />}
              sx={{ alignItems: "flex-start", mb: 1, "& .MuiRadio-root": { pt: 0.5 } }}
              label={
                <Box>
                  <Typography>{t(x.name)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t(x.help)}
                  </Typography>
                </Box>
              }
            />
          ))}
        </RadioGroup>
        <TextField label={t("survey.new.surveyTitle")} value={title} onChange={(e) => setTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 200, lang: written } }} />
        <TextField select label={t("survey.new.language")} value={written} onChange={(e) => setWritten(e.target.value)} helperText={t("survey.new.languageHelp")}>
          {[...new Set([language, ...COMMON_LANGUAGES])].map((code) => (
            <MenuItem key={code} value={code}>
              {names(code)} ({code})
            </MenuItem>
          ))}
        </TextField>
        {chosen.years && (
          <Box>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField label={t("survey.new.firstYear")} value={first} onChange={(e) => setFirst(e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 4 } }} />
              <TextField label={t("survey.new.lastYear")} value={last} onChange={(e) => setLast(e.target.value)} slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 4 } }} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t("survey.new.yearsHelp")}
            </Typography>
          </Box>
        )}
        {error !== null && <ErrorAlert error={error} />}
        <Box>
          <Button variant="contained" disabled={busy || title.trim() === "" || !yearsOk} onClick={() => void make()}>
            {t("survey.new.make")}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
}
