import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import MenuBook from "@mui/icons-material/MenuBook";
import OpenInNew from "@mui/icons-material/OpenInNew";
import { useState, type FormEvent } from "react";
import { getSurveyGuide, linkSurveyGuide, removeSurveyGuide, uploadSurveyGuide, type SurveyGuideAnswer } from "../api";
import { useApp } from "../appContext";
import { megabytes } from "../backupImportView";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { FileDrop } from "../components/FileDrop";
import { CardFrame } from "../components/FoldingCard";
import { Loading } from "../components/Loading";
import { formatBytes } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

/** The largest PDF the server keeps (src/surveyGuide.ts MAX_GUIDE_BYTES). */
export const MAX_GUIDE_BYTES = 25 * 1024 * 1024;
const guideKey = (projectId: string) => ["project", projectId, "getSurveyGuide"];

/**
 * The project's survey guide in Setup › Survey form: the PDF the server keeps, or a link to one kept elsewhere. The
 * project file carries only its address, and Collect Earth shows it beside the form.
 */
export function SurveyGuideCard({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const { data, error, loading, reload, setData } = useLoad(guideKey(projectId), () => getSurveyGuide(projectId));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [removing, setRemoving] = useState(false);

  const run = async (work: () => Promise<SurveyGuideAnswer | null>, done: string) => {
    setBusy(true);
    setFailure(null);
    setMessage(null);
    setProblem(null);
    try {
      const answer = await work();
      if (answer) setData(() => answer);
      else reload();
      setMessage(done);
      setLink("");
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(false);
      setProgress(null);
      setRemoving(false);
    }
  };
  const take = ([file]: File[]) => {
    setMessage(null);
    if (!file.name.toLowerCase().endsWith(".pdf")) return setProblem(t("guide.notPdf"));
    if (file.size > MAX_GUIDE_BYTES) return setProblem(t("guide.tooLarge", { size: megabytes(file.size), max: megabytes(MAX_GUIDE_BYTES) }));
    setProgress(0);
    void run(() => uploadSurveyGuide(projectId, file, setProgress), t("guide.saved"));
  };
  const useLink = (event: FormEvent) => {
    event.preventDefault();
    if (link.trim() !== "") void run(() => linkSurveyGuide(projectId, link.trim()), t("guide.saved"));
  };
  const guide = data?.guide ?? null;

  return (
    <CardFrame title={t("guide.title")}>
      <Stack spacing={2}>
        <Explain text={t("guide.explain.short")} more={t("guide.explain")} />
        {loading && !data && <Loading />}
        {error !== null && error !== undefined && <ErrorAlert error={error} onRetry={reload} />}
        {data && (
          <>
            {guide ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                <MenuBook color="primary" aria-hidden />
                <Typography sx={{ minWidth: 0, overflowWrap: "anywhere", flex: "1 1 240px" }}>
                  {guide.kind === "file" ? t("guide.current.file", { name: guide.filename, size: formatBytes(guide.bytes, language) }) : t("guide.current.link", { url: guide.url })}
                </Typography>
                <Button variant="outlined" component={Link} href={guide.url} target="_blank" rel="noopener noreferrer" endIcon={<OpenInNew />}>
                  {t("guide.open")}
                </Button>
                {removing ? (
                  <Button color="error" variant="contained" disabled={busy} onClick={() => void run(async () => (await removeSurveyGuide(projectId), null), t("guide.removed"))}>
                    {t("guide.removeSure")}
                  </Button>
                ) : (
                  <Button color="error" disabled={busy} onClick={() => setRemoving(true)}>
                    {t("guide.remove")}
                  </Button>
                )}
              </Box>
            ) : (
              <Typography color="text.secondary">{t("guide.none")}</Typography>
            )}
            <FileDrop label={t("guide.drop")} buttonLabel={t("guide.choose")} accept=".pdf,application/pdf" disabled={busy} onFiles={take} />
            {progress !== null && <LinearProgress variant="determinate" value={progress * 100} aria-label={t("guide.title")} />}
            <Box component="form" onSubmit={useLink} sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "flex-start" }}>
              <TextField
                label={t("guide.linkLabel")}
                value={link}
                onChange={(e) => setLink(e.target.value)}
                size="small"
                type="url"
                placeholder="https://"
                sx={{ flex: "1 1 320px" }}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
              <Button type="submit" variant="outlined" disabled={busy || link.trim() === ""}>
                {t("guide.linkSave")}
              </Button>
            </Box>
          </>
        )}
        {problem && <Alert severity="error" role="alert">{problem}</Alert>}
        {message && <Alert severity="success" role="status">{message}</Alert>}
        <ErrorAlert error={failure} />
      </Stack>
    </CardFrame>
  );
}

/** "Survey guide" for a member (a collector's and a reviewer's page): a button that opens it, nothing without a guide. */
export function SurveyGuideButton({ projectId }: { projectId: string }) {
  const t = useT();
  const { data } = useLoad(guideKey(projectId), () => getSurveyGuide(projectId));
  const guide = data?.guide;
  if (!guide) return null;
  return (
    <Button variant="outlined" component={Link} href={guide.url} target="_blank" rel="noopener noreferrer" startIcon={<MenuBook />}>
      {t("guide.title")}
    </Button>
  );
}
