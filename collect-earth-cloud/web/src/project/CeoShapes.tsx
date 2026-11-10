import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import { useEffect, useRef, useState } from "react";
import { ApiError, getCeoShapes, stepCeoShapes, type CeoShapesProgress } from "../api";
import { useT } from "../i18n";

/** Another tab or person is reading them: look again after this long. */
const BUSY_WAIT_MS = 5_000;

/**
 * The copy of a CEO project's plot and sample shapes (src/routes/ceoShapes.ts), run while the project is open: it asks
 * the server for one step after another and shows how far it is. When it stops (CEO not answering, the page closed), it
 * goes on from there the next time the project is opened, or with Continue.
 */
export function CeoShapes({ projectId }: { projectId: string }) {
  const t = useT();
  const [progress, setProgress] = useState<CeoShapesProgress | null>(null);
  const [stopped, setStopped] = useState(false);
  const [finished, setFinished] = useState(false);
  const [run, setRun] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let seenReading = false;
    (async () => {
      setStopped(false);
      try {
        let now = await getCeoShapes(projectId);
        while (alive.current && now.state === "reading") {
          seenReading = true;
          setProgress(now);
          try {
            now = await stepCeoShapes(projectId);
          } catch (err) {
            if (!(err instanceof ApiError && err.code === "busy")) throw err;
            await new Promise((resolve) => setTimeout(resolve, BUSY_WAIT_MS));
            now = await getCeoShapes(projectId);
            continue;
          }
          if (now.state === "reading" && now.error) {
            setProgress(now);
            setStopped(true);
            return;
          }
        }
        if (!alive.current) return;
        setProgress(now);
        if (now.state === "done" && seenReading) setFinished(true);
      } catch {
        if (alive.current) setStopped(true);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [projectId, run]);

  if (!progress || progress.state === "none") return null;
  if (progress.state === "done") {
    if (!finished) return null;
    return (
      <Alert severity="success" onClose={() => setFinished(false)} sx={{ mb: 2 }}>
        {progress.missing > 0
          ? t("ceoShapes.doneMissing", { total: String(progress.total), missing: String(progress.missing) })
          : t("ceoShapes.done", { total: String(progress.total) })}
      </Alert>
    );
  }
  const percent = progress.total > 0 ? (100 * progress.done) / progress.total : 0;
  return (
    <Alert
      severity={stopped ? "warning" : "info"}
      sx={{ mb: 2, "& .MuiAlert-message": { flex: 1 } }}
      action={
        stopped ? (
          <Button color="inherit" size="small" onClick={() => setRun(run + 1)}>
            {t("ceoShapes.continue")}
          </Button>
        ) : undefined
      }
    >
      {stopped ? t("ceoShapes.stopped", { done: String(progress.done), total: String(progress.total) }) : t("ceoShapes.reading", { done: String(progress.done), total: String(progress.total) })}
      <LinearProgress variant="determinate" value={percent} aria-label={t("ceoShapes.label")} sx={{ mt: 1 }} />
    </Alert>
  );
}
