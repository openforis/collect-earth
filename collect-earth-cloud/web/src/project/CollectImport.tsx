import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { importCollectData, previewCollectImport, type CollectImportPreview, type CollectImportResult } from "../api";
import { useApp } from "../appContext";
import { collectImportQuery } from "../collectImportView";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FileDrop } from "../components/FileDrop";
import { formatNumber } from "../format";
import { useT } from "../i18n";

/**
 * The Data tab's import of a Collect Earth export (XML zip): the records collected before the project moved to the
 * cloud become its records. The file is read first (nothing stored), then imported on the coordinator's word.
 */
export function CollectImport({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const n = (value: number) => formatNumber(value, language);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CollectImportPreview | null>(null);
  const [result, setResult] = useState<CollectImportResult | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const read = (files: File[]) => {
    const chosen = files[0];
    setFile(chosen);
    setPreview(null);
    setResult(null);
    setAccounts({});
    void run(async () => setPreview(await previewCollectImport(projectId, chosen, "")));
  };
  const confirm = () => {
    if (file) void run(async () => setResult(await importCollectData(projectId, file, collectImportQuery(accounts))));
  };
  const again = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Typography variant="h2">{t("import.title")}</Typography>
        <Explain text={t("import.explain.short")} more={t("import.explain")} />
        <Typography variant="body2" color="text.secondary">
          {t("import.desktop")}
        </Typography>
        {!preview && !result && (
          <FileDrop label={t("import.drop")} buttonLabel={t("import.choose")} accept=".zip,application/zip" disabled={busy} onFiles={read} />
        )}
        {busy && !preview && <Typography role="status">{t("import.reading")}</Typography>}
        {preview && !result && (
          <Stack spacing={1}>
            <Typography>{t("import.summary", { records: n(preview.records), submitted: n(preview.submitted), drafts: n(preview.drafts) })}</Typography>
            <Typography>{t("import.new", { count: n(preview.newRecords) })}</Typography>
            {preview.olderThere > 0 && <Typography>{t("import.older", { count: n(preview.olderThere) })}</Typography>}
            {preview.newerThere > 0 && <Typography>{t("import.newer", { count: n(preview.newerThere) })}</Typography>}
            {preview.problemCount > 0 && (
              <Alert severity="warning">
                {t("import.problems", { count: n(preview.problemCount) })}
                <Box component="ul" sx={{ m: 0, pl: 3 }}>
                  {preview.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </Box>
              </Alert>
            )}
            {preview.operators.length > 0 && (
              <>
                <Typography variant="h3" sx={{ pt: 1 }}>
                  {t("import.people")}
                </Typography>
                {preview.operators.map((o) => (
                  <Stack key={o.name} direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "center" } }}>
                    <Typography sx={{ minWidth: 220 }}>
                      {t("import.personRecords", { name: o.name, count: n(o.records) })}
                      {o.member && ` (${t("import.inProject")})`}
                    </Typography>
                    {!o.member && (
                      <TextField
                        size="small"
                        label={t("import.account")}
                        helperText={t("import.accountHelp")}
                        value={accounts[o.name] ?? ""}
                        onChange={(e) => setAccounts({ ...accounts, [o.name]: e.target.value })}
                        disabled={busy}
                      />
                    )}
                  </Stack>
                ))}
              </>
            )}
            <Stack direction="row" spacing={2} sx={{ pt: 1 }}>
              <Button variant="contained" onClick={confirm} disabled={busy || preview.records === 0}>
                {busy ? t("import.importing") : t("import.confirm")}
              </Button>
              <Button onClick={again} disabled={busy}>
                {t("common.cancel")}
              </Button>
            </Stack>
          </Stack>
        )}
        {result && (
          <>
            <Alert severity="success" role="status">
              {t("import.done", { stored: n(result.stored), kept: n(result.kept) })}
            </Alert>
            <Box>
              <Button variant="outlined" onClick={again}>
                {t("import.again")}
              </Button>
            </Box>
          </>
        )}
        <ErrorAlert error={error} />
      </Stack>
    </Paper>
  );
}
