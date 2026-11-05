import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBack from "@mui/icons-material/ArrowBack";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getAnalysis, getProject, type AnalysisData } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { translator, useT } from "../i18n";
import { cubeOf, defaultView, parseSavedViews, tableChoices, translateView, withSavedView, type Cube, type SavedView, type ViewConfig } from "../analysisView";
import type { AnalysisEngine, Step, Viewer } from "../analysisEngine";

type EngineModule = typeof import("../analysisEngine");
import { linkProps, pathFor } from "../router";
import { getAnalysisViews, storeAnalysisViews } from "../storage";
import { useLoad } from "../useLoad";

/** The analysis of the collected data: a pivot table and charts over the survey's own tables (what replaces Saiku). */
export function AnalysisPage({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const project = useLoad(() => getProject(projectId), [projectId]);
  const data = useLoad(() => getAnalysis(projectId), [projectId]);

  const back =
    project.data?.role === "admin" ? pathFor({ name: "project", projectId, tab: "data" }) : pathFor({ name: "myWork", projectId });
  return (
    <AppShell wide>
      <Box sx={{ mb: 2, display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
        <Button startIcon={<ArrowBack />} {...linkProps(back)}>
          {project.data?.name ?? t("analysis.back")}
        </Button>
      </Box>
      <Typography variant="h1" sx={{ mb: 1 }}>
        {t("analysis.title")}
      </Typography>
      {data.loading && !data.data ? (
        <Loading />
      ) : data.error ? (
        data.error instanceof ApiError && data.error.status === 404 ? (
          <Paper variant="outlined">
            <EmptyState heading title={t("analysis.noProjectFile")} />
          </Paper>
        ) : (
          <ErrorAlert error={data.error} onRetry={data.reload} />
        )
      ) : data.data && data.data.tables.find((x) => x.name === "plot")?.rows === 0 ? (
        <Paper variant="outlined">
          <EmptyState heading title={t(data.data.scope === "own" ? "analysis.emptyOwn" : "analysis.empty")} />
        </Paper>
      ) : data.data ? (
        <Pivot projectId={projectId} data={data.data} language={language} />
      ) : null}
    </AppShell>
  );
}

function Pivot({ projectId, data, language }: { projectId: string; data: AnalysisData; language: string }) {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<AnalysisEngine | null>(null);
  const engineModule = useRef<EngineModule | null>(null);
  const viewer = useRef<Viewer | null>(null);
  /** What is shown: the cube and the language it is in (to translate the view when either changes). */
  const shown = useRef<{ cube: Cube; language: string } | null>(null);
  /** One change at a time: the engine's calls follow each other. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [step, setStep] = useState<Step | "ready">("database");
  const [error, setError] = useState<unknown>(null);
  const [rows, setRows] = useState<number | null>(null);
  const [table, setTable] = useState("plot");
  const [views, setViews] = useState<SavedView[]>(() => parseSavedViews(getAnalysisViews(projectId)));
  const [viewName, setViewName] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const tables = useMemo(() => tableChoices(data.model, language, t), [data, language, t]);

  const run = (task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch((e: unknown) => {
      console.error("analysis", e);
      setError(e);
    });
    return queue.current;
  };

  /** The language of the code tables' labels in DuckDB. */
  const codesLanguage = useRef(language);

  /**
   * Shows a table with a view: a saved one (translated when it was saved in another language), the default one
   * (`fresh`), or else the one shown, its column names translated (when only the language changed).
   */
  const show = (nextTable: string, saved: SavedView | null, fresh = false) =>
    run(async () => {
      const e = engine.current;
      const v = viewer.current;
      if (!e || !v) return;
      const cube = cubeOf(data, nextTable, language, t);
      let config: ViewConfig;
      if (saved) {
        config = saved.language === language ? saved.config : translateView(saved.config, cubeOf(data, saved.table, saved.language, translator(saved.language)), cube);
      } else if (!fresh && shown.current && shown.current.cube.table === nextTable) {
        config = translateView(await v.save(), shown.current.cube, cube);
      } else {
        config = defaultView(data, cube, t);
      }
      if (codesLanguage.current !== language) {
        await e.setLanguage(data, language);
        codesLanguage.current = language;
      }
      setRows(await e.show(v, cube, config, tables.find((x) => x.name === nextTable)?.label ?? nextTable));
      shown.current = { cube, language };
    });

  // DuckDB and Perspective start with the page (their code is loaded only now)
  useEffect(() => {
    let closed = false;
    (async () => {
      try {
        const mod = await import("../analysisEngine");
        engineModule.current = mod;
        const { AnalysisEngine, createViewer } = mod;
        mod.setViewerLanguage(language);
        const e = await AnalysisEngine.open(data, language, (s) => !closed && setStep(s));
        if (closed) return void e.close();
        engine.current = e;
        setStep("pivot");
        const v = createViewer();
        v.style.height = "100%";
        v.style.width = "100%";
        host.current?.appendChild(v);
        viewer.current = v;
        await show("plot", null, true);
        if (!closed) setStep("ready");
      } catch (e) {
        if (!closed) setError(e);
      }
    })();
    return () => {
      closed = true;
      const v = viewer.current;
      viewer.current = null;
      void v?.delete().catch(() => {});
      v?.remove();
      void engine.current?.close();
      engine.current = null;
    };
    // the data is loaded once per page; the language is followed below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Another language: the labels and the column names change, the view stays
  useEffect(() => {
    engineModule.current?.setViewerLanguage(language);
    if (shown.current && shown.current.language !== language) void show(shown.current.cube.table, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  const keepViews = (next: SavedView[]) => {
    setViews(next);
    storeAnalysisViews(projectId, next.length ? JSON.stringify(next) : null);
  };
  const chooseTable = (name: string) => {
    setTable(name);
    setViewName("");
    void show(name, null, true);
  };
  const chooseView = (name: string) => {
    setViewName(name);
    const saved = views.find((v) => v.name === name && v.table === table) ?? null;
    void show(table, saved, !saved);
  };
  const save = async (name: string) => {
    const v = viewer.current;
    if (!v || !shown.current) return;
    // the table's and title's names are the page's, given again when the view is opened
    const { table: _table, title: _title, ...config } = await v.save();
    keepViews(withSavedView(views, { name, table, language, config }));
    setViewName(name);
    setSaving(null);
  };
  const remove = () => {
    keepViews(views.filter((v) => !(v.name === viewName && v.table === table)));
    setViewName("");
  };

  const ready = step === "ready";
  const tableViews = views.filter((v) => v.table === table);
  const plotRows = data.tables.find((x) => x.name === "plot")?.rows ?? 0;
  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">
        {t(data.scope === "own" ? "analysis.explainOwn" : "analysis.explain", { count: formatNumber(plotRows, language) })}
      </Typography>
      {!data.areas && data.scope === "project" && <Alert severity="info">{t("analysis.noAreas")}</Alert>}
      {data.areas && data.areas.unmatched > 0 && <Alert severity="warning">{t("analysis.areasUnmatched", { file: data.areas.source, count: data.areas.unmatched })}</Alert>}
      <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
        <TextField select size="small" label={t("analysis.table")} value={table} onChange={(e) => chooseTable(e.target.value)} disabled={!ready} sx={{ width: { xs: "100%", sm: 240 } }}>
          {tables.map((x) => (
            <MenuItem key={x.name} value={x.name}>
              {x.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label={t("analysis.view")}
          value={viewName}
          onChange={(e) => chooseView(e.target.value)}
          disabled={!ready}
          sx={{ width: { xs: "100%", sm: 300 } }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">{t("analysis.defaultView")}</MenuItem>
          {tableViews.map((v) => (
            <MenuItem key={v.name} value={v.name}>
              {v.name}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" onClick={() => setSaving(viewName)} disabled={!ready}>
          {t("analysis.saveView")}
        </Button>
        {viewName && (
          <Button color="error" onClick={remove} disabled={!ready}>
            {t("analysis.deleteView")}
          </Button>
        )}
        {rows !== null && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: "auto" }}>
            {t("analysis.rows", { count: formatNumber(rows, language) })}
          </Typography>
        )}
      </Box>
      <ErrorAlert error={error} />
      {!ready && !error && (
        <Box role="status">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(`analysis.step.${step}`)}
          </Typography>
          <LinearProgress />
        </Box>
      )}
      <Paper variant="outlined" sx={{ height: { xs: "70vh", md: "calc(100vh - 300px)" }, minHeight: 420, overflow: "hidden" }}>
        <Box ref={host} sx={{ height: "100%", width: "100%" }} data-testid="analysis-pivot" />
      </Paper>
      <Typography variant="body2" color="text.secondary">
        {t("analysis.help")}
      </Typography>
      <SaveDialog
        open={saving !== null}
        initial={saving ?? ""}
        taken={(name) => tableViews.some((v) => v.name === name)}
        onCancel={() => setSaving(null)}
        onSave={(name) => void save(name)}
      />
    </Stack>
  );
}

function SaveDialog({ open, initial, taken, onCancel, onSave }: { open: boolean; initial: string; taken: (name: string) => boolean; onCancel: () => void; onSave: (name: string) => void }) {
  const t = useT();
  const [name, setName] = useState(initial);
  useEffect(() => setName(initial), [initial, open]);
  const trimmed = name.trim();
  return (
    <Dialog open={open} onClose={onCancel} fullWidth maxWidth="xs">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) onSave(trimmed);
        }}
      >
        <DialogTitle>{t("analysis.saveTitle")}</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("analysis.saveExplain")}
          </Typography>
          <TextField autoFocus fullWidth label={t("analysis.viewName")} value={name} onChange={(e) => setName(e.target.value)} helperText={trimmed && taken(trimmed) ? t("analysis.replaces") : " "} slotProps={{ htmlInput: { maxLength: 80 } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button type="submit" variant="contained" disabled={!trimmed}>
            {t("common.save")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
