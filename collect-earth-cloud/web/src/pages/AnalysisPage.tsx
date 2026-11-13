import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBack from "@mui/icons-material/ArrowBack";
import Calculate from "@mui/icons-material/Calculate";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, getAnalysis, getProject, getProjectAi, proposeAnalysisViews, type AnalysisData, type ProposedView } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain, MoreInfo } from "../components/Explain";
import { Loading } from "../components/Loading";
import { formatNumber } from "../format";
import { translator, useT } from "../i18n";
import ListSubheader from "@mui/material/ListSubheader";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import Delete from "@mui/icons-material/Delete";
import Download from "@mui/icons-material/Download";
import Fullscreen from "@mui/icons-material/Fullscreen";
import FullscreenExit from "@mui/icons-material/FullscreenExit";
import Groups from "@mui/icons-material/Groups";
import LinkIcon from "@mui/icons-material/Link";
import Save from "@mui/icons-material/Save";
import Tune from "@mui/icons-material/Tune";
import { useCallback } from "react";
import { deleteSharedAnalysisView, downloadAnalysisStandalone, getSharedAnalysisViews, shareAnalysisView, type Role } from "../api";
import CircularProgress from "@mui/material/CircularProgress";
import OfflineShare from "@mui/icons-material/OfflineShare";
import { useLocalMode } from "../appContext";
import AutoAwesome from "@mui/icons-material/AutoAwesome";
import ListItemText from "@mui/material/ListItemText";
import { applyQuestion, decodeView, drillColumns, encodeView, measuresOf, questionOf, valuesSql, type Filter, type Measure, type Question } from "../analysisQuestion";
import { chartStyle, seriesOfPaths, takesOut, TREES } from "../analysisColors";
import { templatesOf, viewOfProposal, viewTitle, type Template } from "../analysisSuggest";
import { startErrorText } from "../aiView";
import { cubeOf, defaultView, fitToCube, parseSavedViews, tableChoices, translateView, withSavedView, type Cube, type SavedView, type ViewConfig } from "../analysisView";
import type { AnalysisEngine, Step, Viewer } from "../analysisEngine";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import AltRoute from "@mui/icons-material/AltRoute";
import FormatListBulleted from "@mui/icons-material/FormatListBulleted";
import MapIcon from "@mui/icons-material/Map";
import TableChart from "@mui/icons-material/TableChart";
import { changeFields, drillDown, quickFilterFields } from "../analysisInsights";
import { AnalysisMap } from "../components/analysis/AnalysisMap";
import { ChangeFlows } from "../components/analysis/ChangeFlows";
import { DrillDialog } from "../components/analysis/DrillDialog";
import { FilterBar } from "../components/analysis/FilterBar";
import { QuestionBar } from "../components/analysis/QuestionBar";
import { linkProps, pathFor } from "../router";
import { csvBlob } from "../csv";
import { saveBlob } from "../saveBlob";
import { getAnalysisViews, storeAnalysisViews } from "../storage";
import { useLoad } from "../useLoad";

type EngineModule = typeof import("../analysisEngine");

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
        {(project.data?.role === "admin" || project.data?.role === "reviewer") && (
          <Button variant="outlined" startIcon={<Calculate />} {...linkProps(pathFor({ name: "uncertainty", projectId }))}>
            {t("uncertainty.open")}
          </Button>
        )}
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
        <Pivot projectId={projectId} projectName={project.data?.name ?? ""} role={project.data?.role ?? "operator"} data={data.data} language={language} />
      ) : null}
    </AppShell>
  );
}

/** What is shown: the cube, its measures and ready-made views, and the language its names are in. */
interface Shown {
  cube: Cube;
  measures: Measure[];
  templates: Template[];
  language: string;
}

/** The chosen view in the views list: a ready-made one, one the AI assistant proposed, one shared with the team, or one of the person's own. */
type ViewKey = `tpl:${string}` | `ai:${string}` | `team:${string}` | `mine:${string}` | "";
/** The views list's action that asks the AI assistant for views (not a view). */
const ASK_AI = "ask-ai";

/** The AI assistant's proposals as views of the cube shown (those naming a field it has not are left out). */
function aiTemplates(proposals: { table: string; views: ProposedView[] } | null, s: Shown | null, t: ReturnType<typeof useT>): Template[] {
  if (!proposals || !s || proposals.table !== s.cube.table) return [];
  return proposals.views.flatMap((p, i) => {
    const question = viewOfProposal(p, s.cube, s.measures, t);
    return question ? [{ id: `${i}`, label: p.title, why: p.why, question }] : [];
  });
}

/** A configuration as it is kept: without the table's and title's names, which the page gives when it opens it. */
function keepable(config: ViewConfig): ViewConfig {
  const { table: _table, title: _title, ...rest } = config;
  return rest;
}

/**
 * The pivot and its bars. `standalone`: in the stand-alone file (src/standalone.tsx), with no server: no team views, no
 * links to share or to the plots' pages, and no stand-alone download of itself.
 */
export function Pivot({ projectId, projectName, role, data, language, standalone = false }: { projectId: string; projectName: string; role: Role; data: AnalysisData; language: string; standalone?: boolean }) {
  const t = useT();
  const local = useLocalMode() || standalone;
  const coordinator = role === "admin";
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<AnalysisEngine | null>(null);
  const engineModule = useRef<EngineModule | null>(null);
  const viewer = useRef<Viewer | null>(null);
  const shownRef = useRef<Shown | null>(null);
  /** One change at a time: the engine's calls follow each other. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  /** A repaint after a change in Perspective's panel is under way. */
  const painting = useRef(false);
  /** The language of the code tables' labels in DuckDB. */
  const codesLanguage = useRef(language);
  const [step, setStep] = useState<Step | "ready">("database");
  const [error, setError] = useState<unknown>(null);
  const [rows, setRows] = useState<number | null>(null);
  const [table, setTable] = useState("plot");
  const [shown, setShown] = useState<Shown | null>(null);
  const [config, setConfig] = useState<ViewConfig | null>(null);
  const [mine, setMine] = useState<SavedView[]>(() => parseSavedViews(getAnalysisViews(projectId)));
  const team = useLoad(() => (local ? Promise.resolve([]) : getSharedAnalysisViews(projectId)), [projectId, local]);
  const [selected, setSelected] = useState<ViewKey>("tpl:default");
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState<"mine" | "team" | null>(null);
  const [drill, setDrill] = useState<Filter[] | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** What the chart area shows: the pivot, or the land use change flows. */
  const [mode, setMode] = useState<"pivot" | "flows">("pivot");
  const [showMap, setShowMap] = useState(false);
  /** The views a click went down from (the breadcrumbs), each with what was clicked. */
  const [trail, setTrail] = useState<{ question: Question; label: string }[]>([]);
  const tables = useMemo(() => tableChoices(data.model, language, t), [data, language, t]);
  // The AI assistant's views: for coordinators of a project where it is on (never in the local mode, which has none)
  const ai = useLoad(() => (coordinator && !local ? getProjectAi(projectId).catch(() => null) : Promise.resolve(null)), [projectId, coordinator, local]);
  const canAskAi = !!ai.data?.enabled && !!ai.data.available;
  const [proposals, setProposals] = useState<{ table: string; views: ProposedView[] } | null>(null);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  const [asking, setAsking] = useState(false);
  /** The chosen view, for the title the chart is given after a change (the state is a render late). */
  const selectedRef = useRef<ViewKey>("tpl:default");
  selectedRef.current = selected;
  /** The view was changed since it was chosen: its title is then the table's, not the view's. */
  const changedRef = useRef(false);
  changedRef.current = changed;

  /** How many changes are under way: the pivot shows a progress line and the bars wait meanwhile. */
  const [working, setWorking] = useState(0);
  const run = (task: () => Promise<void>) => {
    setWorking((n) => n + 1);
    queue.current = queue.current
      .then(task)
      .catch((e: unknown) => {
        console.error("analysis", e);
        setError(e);
      })
      .finally(() => setWorking((n) => n - 1));
    return queue.current;
  };

  /** Another view of the table shown (the same language): only the view is replaced, the table stays. */
  const restyle = (make: (s: Shown, current: ViewConfig) => ViewConfig) =>
    run(async () => {
      const v = viewer.current;
      const s = shownRef.current;
      if (!v || !s) return;
      const current = await v.save();
      await v.restore({ ...fitToCube(make(s, current), s.cube), table: current.table, title: current.title });
      await paint(v, s);
      setConfig(await v.save());
    });

  /**
   * The chart's colours (each category its own, in every chart: analysisColors.ts) and its title, once the view is
   * shown: Perspective takes the colours in the order of the view's series, which only the view knows.
   */
  const paint = async (v: Viewer, s: Shown) => {
    const e = engine.current;
    if (!e) return;
    const config = await v.save();
    const plugin = config.plugin ?? "Datagrid";
    const colour = TREES.has(plugin) ? (config.group_by?.[0] ?? null) : null;
    const order = plugin === "Datagrid" ? { paths: [], colourValues: null } : await e.chartOrder(v, colour);
    const style = chartStyle(config, s.cube, data.model, seriesOfPaths(order.paths, (config.split_by ?? []).length), order.colourValues);
    const title = titleOf(s, config);
    // Perspective adds the colours restored to those it has: a colour no longer wanted is cleared first
    if (style && takesOut(config.columns_config, style.columns_config)) await v.restore({ columns_config: null });
    if (style || title !== config.title) await v.restore({ ...(style ?? {}), title });
  };

  // the panel's listener, set once, paints with what this render knows (the language, the AI's views)
  const paintRef = useRef(paint);
  paintRef.current = paint;

  /** A ready-made or proposed view's title (a change matrix says which axis is which), else the table's name. */
  const titleOf = (s: Shown, config: ViewConfig): string => {
    const tableLabel = tables.find((x) => x.name === s.cube.table)?.label ?? s.cube.table;
    if (changedRef.current) return tableLabel;
    const [kind, ...rest] = selectedRef.current.split(":");
    const id = rest.join(":");
    const tpl = kind === "tpl" ? s.templates.find((x) => x.id === id) : kind === "ai" ? aiTemplates(proposalsRef.current, s, t).find((x) => x.id === id) : undefined;
    if (tpl) return viewTitle(tpl, questionOf(config, s.measures), t);
    return kind === "team" || kind === "mine" ? id : tableLabel;
  };

  /** Shows a table with the view `make` gives for its cube (from the cube shown before, for a translation). */
  const show = (nextTable: string, make: (next: Shown, before: Shown | null, current: ViewConfig | null) => ViewConfig) =>
    run(async () => {
      const e = engine.current;
      const v = viewer.current;
      if (!e || !v) return;
      const cube = cubeOf(data, nextTable, language, t);
      const measures = measuresOf(cube, t);
      const next: Shown = { cube, measures, templates: templatesOf(data, cube, measures, t), language };
      const before = shownRef.current;
      const current = before ? await v.save() : null;
      const viewConfig = fitToCube(make(next, before, current), cube);
      if (codesLanguage.current !== language) {
        await e.setLanguage(data, language);
        codesLanguage.current = language;
      }
      setRows(await e.show(v, cube, viewConfig, tables.find((x) => x.name === nextTable)?.label ?? nextTable));
      shownRef.current = next;
      await paint(v, next);
      setShown(next);
      setTable(nextTable);
      setConfig(await v.save());
    });

  const savedConfig = (view: { table: string; language: string; config: ViewConfig }, next: Shown) =>
    view.language === next.language ? view.config : translateView(view.config, cubeOf(data, view.table, view.language, translator(view.language)), next.cube);
  const templateConfig = (id: string, next: Shown, current: ViewConfig | null, from: Template[] = next.templates) => {
    const tpl = from.find((x) => x.id === id) ?? next.templates[0];
    const base = current ? { ...keepable(current), expressions: {}, aggregates: {}, columns_config: {} } : keepable(defaultView(data, next.cube, t));
    return applyQuestion(base, tpl.question, next.measures, next.cube);
  };

  /** A click in the pivot (the listener, set once, calls what this render knows): down a level, else the plots. */
  const clickRef = useRef<(clicked: Filter[]) => void>(() => {});
  clickRef.current = (clicked) => {
    const s = shownRef.current;
    const q = s && config ? questionOf(config, s.measures) : null;
    const step = s && q ? drillDown(data.model, s.cube, q, clicked) : null;
    if (!step || !q) return setDrill(clicked);
    setTrail((tr) => [...tr, { question: q, label: `${step.field}: ${String(step.value)}` }]);
    void ask(step.question);
  };
  /** Back up the breadcrumbs to the view of step `k` (0: before the first click). */
  const backTo = (k: number) => {
    const target = trail[k];
    if (!target) return;
    setTrail(trail.slice(0, k));
    void ask(target.question);
  };

  // DuckDB and Perspective start with the page (their code is loaded only now); a link may bring a view (#view=…)
  useEffect(() => {
    let closed = false;
    (async () => {
      try {
        const mod = await import("../analysisEngine");
        engineModule.current = mod;
        mod.setViewerLanguage(language);
        const e = await mod.AnalysisEngine.open(data, language, (s) => !closed && setStep(s));
        if (closed) return void e.close();
        engine.current = e;
        setStep("pivot");
        const v = mod.createViewer();
        v.style.height = "100%";
        v.style.width = "100%";
        host.current?.appendChild(v);
        viewer.current = v;
        // Perspective's panel and the bars are one view: what changes in the panel shows in the bars
        v.addEventListener("perspective-config-update", () => {
          void v.save().then((c) => setConfig(c));
          // A change made in Perspective's own panel gets its colours too; paint restores only what differs, so the
          // change it makes asks for nothing more
          if (painting.current) return;
          painting.current = true;
          void run(async () => {
            const s = shownRef.current;
            if (s && viewer.current) await paintRef.current(viewer.current, s);
          }).finally(() => (painting.current = false));
        });
        // A click on a bar or a row goes down into it; at the bottom, it lists its plots (the drill-through)
        v.addEventListener("perspective-click", (event) => {
          const detail = (event as CustomEvent<{ config?: { filter?: Filter[] } }>).detail;
          clickRef.current(detail?.config?.filter ?? []);
        });
        const linked = window.location.hash.startsWith("#view=") ? decodeView(window.location.hash.slice(6)) : null;
        const linkedTable = linked && data.model.tables.some((x) => x.name === linked.table) ? linked.table : "plot";
        await show(linkedTable, (next) => (linked ? savedConfig(linked, next) : templateConfig("default", next, null)));
        if (linked) setSelected("");
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
    const before = shownRef.current;
    if (before && before.language !== language) void show(before.cube.table, (next, b, current) => (current && b ? translateView(current, b.cube, next.cube) : templateConfig("default", next, null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Esc leaves the full screen
  useEffect(() => {
    if (!fullScreen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFullScreen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const question = shown && config ? questionOf(config, shown.measures) : null;

  /** The bars' changes: the view shown with the question asked, its other settings kept. */
  const ask = (q: Question) =>
    run(async () => {
      const v = viewer.current;
      const s = shownRef.current;
      if (!v || !s) return;
      const next = applyQuestion(await v.save(), q, s.measures, s.cube);
      setConfig(next);
      setChanged(true);
      changedRef.current = true;
      await v.restore(next);
      await paint(v, s);
      setConfig(await v.save());
    });

  const loadValues = useCallback(async (column: string, filters: Filter[]) => {
    const e = engine.current;
    const s = shownRef.current;
    if (!e || !s) return [];
    return (await e.rows(valuesSql(s.cube, column, filters, 1000))).map((r) => ({ value: r.value, n: Number(r.n) }));
  }, []);
  const query = useCallback(async (sql: string) => (engine.current ? engine.current.rows(sql) : []), []);

  const chooseTable = (name: string) => {
    setTrail([]);
    setSelected("tpl:default");
    selectedRef.current = "tpl:default";
    setChanged(false);
    changedRef.current = false;
    void show(name, (next, _b, current) => templateConfig("default", next, current));
  };
  const chooseView = (key: ViewKey | typeof ASK_AI) => {
    if (key === ASK_AI) return void askAi();
    setTrail([]);
    setSelected(key);
    selectedRef.current = key;
    setChanged(false);
    changedRef.current = false;
    const [kind, ...rest] = key.split(":");
    const name = rest.join(":");
    const same = shownRef.current?.cube.table === table && shownRef.current.language === language;
    if (kind === "tpl") {
      if (same) void restyle((s, current) => templateConfig(name, s, current));
      else void show(table, (next, _b, current) => templateConfig(name, next, current));
      return;
    }
    if (kind === "ai") {
      if (same) void restyle((s, current) => templateConfig(name, s, current, aiTemplates(proposalsRef.current, s, t)));
      else void show(table, (next, _b, current) => templateConfig(name, next, current, aiTemplates(proposalsRef.current, next, t)));
      return;
    }
    const view = (kind === "team" ? (team.data ?? []).find((v) => v.name === name && v.table === table) : mine.find((v) => v.name === name && v.table === table)) as
      | { table: string; language: string; config: ViewConfig }
      | undefined;
    if (!view) return;
    if (same) void restyle((s) => savedConfig(view, s));
    else void show(view.table, (next) => savedConfig(view, next));
  };
  /** Asks the AI assistant for views of the table shown; they join the list's suggestions. */
  const askAi = async () => {
    setAsking(true);
    try {
      const views = await proposeAnalysisViews(projectId, table, language);
      setProposals({ table, views });
      const usable = aiTemplates({ table, views }, shownRef.current, t).length;
      setNotice(usable ? t("analysis.ai.got", { count: usable }) : t("analysis.ai.none"));
    } catch (e) {
      setNotice(startErrorText(t, e, language) ?? t("analysis.ai.failed"));
    } finally {
      setAsking(false);
    }
  };
  const keepMine = (next: SavedView[]) => {
    setMine(next);
    storeAnalysisViews(projectId, next.length ? JSON.stringify(next) : null);
  };
  const save = async (name: string) => {
    const v = viewer.current;
    if (!v) return;
    const kept = keepable(await v.save());
    try {
      if (saving === "team") {
        team.setData(await shareAnalysisView(projectId, { name, table, language, config: kept }));
        setSelected(`team:${name}`);
        setNotice(t("analysis.sharedDone"));
      } else {
        keepMine(withSavedView(mine, { name, table, language, config: kept }));
        setSelected(`mine:${name}`);
      }
      setChanged(false);
      setSaving(null);
    } catch (e) {
      setError(e);
    }
  };
  const remove = async () => {
    const [kind, ...rest] = selected.split(":");
    const name = rest.join(":");
    try {
      if (kind === "team") team.setData(await deleteSharedAnalysisView(projectId, name, table));
      else keepMine(mine.filter((v) => !(v.name === name && v.table === table)));
      chooseView("tpl:default");
    } catch (e) {
      setError(e);
    }
  };
  const copyLink = async () => {
    const v = viewer.current;
    if (!v) return;
    const url = `${window.location.origin}${window.location.pathname}#view=${encodeView({ table, language, config: keepable(await v.save()) })}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice(t("analysis.linkCopied"));
    } catch {
      window.prompt(t("analysis.linkCopy"), url);
    }
  };
  const [packing, setPacking] = useState(false);
  // The stand-alone file is easy to pass around: what it holds is said first, and the places of the plots can be left out
  const [packOpen, setPackOpen] = useState(false);
  const [packNoPositions, setPackNoPositions] = useState(false);
  const downloadStandalone = async () => {
    setPackOpen(false);
    setPacking(true);
    try {
      const { blob, filename } = await downloadAnalysisStandalone(projectId, packNoPositions);
      saveBlob(blob, filename);
    } catch (e) {
      setError(e);
    } finally {
      setPacking(false);
    }
  };
  const download = () =>
    run(async () => {
      const e = engine.current;
      const v = viewer.current;
      if (!e || !v) return;
      saveBlob(csvBlob(await e.viewCsv(v, language)), `${fileBase()}.csv`);
    });
  const fileBase = () => {
    const label = selectedLabel() || t("analysis.title");
    return `${projectName} - ${label}`.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  };
  const selectedLabel = () => {
    const [kind, ...rest] = selected.split(":");
    const name = rest.join(":");
    if (kind === "tpl") return shown?.templates.find((x) => x.id === name)?.label ?? "";
    if (kind === "ai") return aiTemplates(proposals, shown, t).find((x) => x.id === name)?.label ?? "";
    return name;
  };
  const togglePanel = () =>
    run(async () => {
      await viewer.current?.toggleConfig();
    });

  const ready = step === "ready" && working === 0;
  const teamViews = (team.data ?? []).filter((v) => v.table === table);
  const myViews = mine.filter((v) => v.table === table);
  const myAi = aiTemplates(proposals, shown, t);
  const canDelete = selected.startsWith("mine:") || (selected.startsWith("team:") && coordinator);
  const plotRows = data.tables.find((x) => x.name === "plot")?.rows ?? 0;
  const drillCols = shown && question ? drillColumns(shown.cube, question, shown.measures) : [];
  const suggested = useMemo(() => (shown ? quickFilterFields(data.model, shown.cube) : []), [data.model, shown]);
  const canFlow = useMemo(() => !!shown && changeFields(data.model, shown.cube).length >= 2, [data.model, shown]);
  const canMap = !standalone && role !== "operator" && !!shown?.cube.columns.some((c) => c.id === "_plot");
  const areaColumn = shown?.cube.columns.find((c) => c.id === "expansion_factor")?.name ?? null;
  const flowMeasure = areaColumn && question?.measures.some((m) => m.startsWith("area")) ? areaColumn : null;
  const flowing = mode === "flows" && canFlow;

  const toolbar = (
    <Stack spacing={1.5}>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
        <TextField select size="small" label={t("analysis.table")} value={table} onChange={(e) => chooseTable(e.target.value)} disabled={!ready} sx={{ width: { xs: "100%", sm: 200 } }}>
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
          value={selected}
          onChange={(e) => chooseView(e.target.value as ViewKey | typeof ASK_AI)}
          disabled={!ready}
          sx={{ width: { xs: "100%", sm: 340 } }}
          slotProps={{ select: { displayEmpty: true, renderValue: () => (selected ? selectedLabel() : t("analysis.custom")) + (changed ? ` · ${t("analysis.changed")}` : "") }, inputLabel: { shrink: true } }}
        >
          <ListSubheader>{t("analysis.views.ready")}</ListSubheader>
          {(shown?.templates ?? []).map((x) => (
            <MenuItem key={x.id} value={`tpl:${x.id}`}>
              {x.label}
            </MenuItem>
          ))}
          {myAi.length > 0 && <ListSubheader>{t("analysis.ai.group")}</ListSubheader>}
          {myAi.map((x) => (
            <MenuItem key={`ai:${x.id}`} value={`ai:${x.id}`} sx={{ whiteSpace: "normal", maxWidth: 520 }}>
              <ListItemText primary={x.label} secondary={x.why} slotProps={{ secondary: { variant: "caption" } }} sx={{ my: 0 }} />
            </MenuItem>
          ))}
          {canAskAi && (
            <MenuItem value={ASK_AI} disabled={asking} sx={{ color: "primary.main", whiteSpace: "normal", maxWidth: 520 }}>
              <AutoAwesome fontSize="small" sx={{ mr: 1 }} />
              <ListItemText primary={t(asking ? "analysis.ai.asking" : "analysis.ai.ask")} secondary={t("analysis.ai.privacy")} slotProps={{ secondary: { variant: "caption" } }} sx={{ my: 0 }} />
            </MenuItem>
          )}
          {!local && <ListSubheader>{t("analysis.views.team")}</ListSubheader>}
          {!local && teamViews.length === 0 && (
            <MenuItem disabled value="none-team">
              {t(coordinator ? "analysis.views.teamNoneCoordinator" : "analysis.views.teamNone")}
            </MenuItem>
          )}
          {teamViews.map((v) => (
            <MenuItem key={`team:${v.name}`} value={`team:${v.name}`}>
              <Groups fontSize="small" sx={{ mr: 1, color: "text.secondary" }} />
              {v.name}
              <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                {v.savedBy}
              </Typography>
            </MenuItem>
          ))}
          <ListSubheader>{t("analysis.views.mine")}</ListSubheader>
          {myViews.length === 0 && (
            <MenuItem disabled value="none-mine">
              {t("analysis.views.mineNone")}
            </MenuItem>
          )}
          {myViews.map((v) => (
            <MenuItem key={`mine:${v.name}`} value={`mine:${v.name}`}>
              {v.name}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" variant="outlined" startIcon={<Save />} onClick={() => setSaving("mine")} disabled={!ready}>
          {t("analysis.saveView")}
        </Button>
        {coordinator && !local && (
          <Button size="small" variant="outlined" startIcon={<Groups />} onClick={() => setSaving("team")} disabled={!ready}>
            {t("analysis.shareView")}
          </Button>
        )}
        {canDelete && (
          <Tooltip title={t("analysis.deleteView")}>
            <IconButton aria-label={t("analysis.deleteView")} onClick={() => void remove()} disabled={!ready} color="error">
              <Delete />
            </IconButton>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {canFlow && (
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v: "pivot" | "flows" | null) => v && setMode(v)} aria-label={t("analysis.mode.label")}>
            <ToggleButton value="pivot" sx={{ gap: 0.75, px: 1.5 }}>
              <TableChart fontSize="small" />
              {t("analysis.mode.pivot")}
            </ToggleButton>
            <ToggleButton value="flows" sx={{ gap: 0.75, px: 1.5 }}>
              <AltRoute fontSize="small" />
              {t("analysis.mode.flows")}
            </ToggleButton>
          </ToggleButtonGroup>
        )}
        {canMap && (
          <Tooltip title={t(showMap ? "analysis.map.hide" : "analysis.map.show")}>
            <span>
              <IconButton aria-label={t("analysis.map.show")} aria-pressed={showMap} onClick={() => setShowMap((m) => !m)} disabled={!ready} color={showMap ? "primary" : "default"}>
                <MapIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={t("analysis.download")}>
          <span>
            <IconButton aria-label={t("analysis.download")} onClick={() => void download()} disabled={!ready}>
              <Download />
            </IconButton>
          </span>
        </Tooltip>
        {!standalone && (
          <Tooltip title={t("analysis.standalone")}>
            <span>
              <IconButton aria-label={t("analysis.standalone")} onClick={() => setPackOpen(true)} disabled={packing}>
                {packing ? <CircularProgress size={20} /> : <OfflineShare />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {!local && (
          <Tooltip title={t("analysis.linkCopy")}>
            <span>
              <IconButton aria-label={t("analysis.linkCopy")} onClick={() => void copyLink()} disabled={!ready}>
                <LinkIcon />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={t(config?.settings ? "analysis.panelHide" : "analysis.panelShow")}>
          <span>
            <IconButton aria-label={t("analysis.panelShow")} onClick={() => void togglePanel()} disabled={!ready} color={config?.settings ? "primary" : "default"}>
              <Tune />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t(fullScreen ? "analysis.fullScreenExit" : "analysis.fullScreen")}>
          <IconButton aria-label={t(fullScreen ? "analysis.fullScreenExit" : "analysis.fullScreen")} onClick={() => setFullScreen((f) => !f)}>
            {fullScreen ? <FullscreenExit /> : <Fullscreen />}
          </IconButton>
        </Tooltip>
      </Box>
      {shown && question && (
        <>
          <QuestionBar cube={shown.cube} measures={shown.measures} question={question} onChange={(q) => void ask(q)} disabled={!ready} />
          <FilterBar cube={shown.cube} filters={question.filters} onChange={(filters) => void ask({ ...question, filters })} loadValues={loadValues} disabled={!ready} suggested={suggested} />
        </>
      )}
    </Stack>
  );

  // the areas' source in words: a file of the project file, or the strata set on the Plot files tab
  const areasName = data.areas?.source === "strata" || data.areas?.source === "total" ? t("analysis.areasSetting") : (data.areas?.source ?? "");
  return (
    <Stack spacing={2}>
      {data.scope === "own" ? (
        <Typography color="text.secondary">{t("analysis.explainOwn", { count: formatNumber(plotRows, language) })}</Typography>
      ) : (
        <Explain text={t("analysis.explain.short", { count: formatNumber(plotRows, language) })} more={t("analysis.explain", { count: formatNumber(plotRows, language) })} />
      )}
      {!data.areas && data.scope === "project" && (
        <Alert severity="info">
          {t("analysis.noAreas.short")}
          <MoreInfo text={t("analysis.noAreas")} />
        </Alert>
      )}
      {data.areas && data.areas.unmatched > 0 && <Alert severity="warning">{t("analysis.areasUnmatched", { file: areasName, count: data.areas.unmatched })}</Alert>}
      {data.areas && (data.areas.unknownColumns?.length ?? 0) > 0 && (
        <Alert severity="warning">{t("analysis.areasUnknownColumns", { file: areasName, columns: data.areas.unknownColumns!.join(", ") })}</Alert>
      )}
      {data.areas && (data.areas.noStratum?.plots ?? 0) > 0 && (
        <Alert severity="warning">
          {t("analysis.areasNoStratum", {
            file: areasName,
            count: formatNumber(data.areas.noStratum!.plots, language),
            examples: data.areas.noStratum!.examples.map((e) => `${e.stratum || "—"} (${formatNumber(e.plots, language)})`).join(", "),
          })}
        </Alert>
      )}
      <ErrorAlert error={error} />
      {step !== "ready" && !error && (
        <Box role="status">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t(`analysis.step.${step}`)}
          </Typography>
          <LinearProgress />
        </Box>
      )}
      <Box
        sx={
          fullScreen
            ? { position: "fixed", inset: 0, zIndex: 1200, bgcolor: "background.default", p: 2, display: "flex", flexDirection: "column", gap: 1.5, overflow: "auto" }
            : { display: "flex", flexDirection: "column", gap: 1.5 }
        }
      >
        <Paper variant="outlined" sx={{ p: 2 }}>
          {toolbar}
        </Paper>
        {trail.length > 0 && question && (
          <Paper variant="outlined" sx={{ px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Breadcrumbs aria-label={t("analysis.drill.label")} sx={{ flex: "1 1 auto" }}>
              {[t("analysis.drill.all"), ...trail.map((s) => s.label)].map((label, k) =>
                k < trail.length ? (
                  <Link key={k} component="button" underline="hover" onClick={() => backTo(k)} disabled={!ready} sx={{ fontSize: 14 }}>
                    {label}
                  </Link>
                ) : (
                  <Typography key={k} sx={{ fontSize: 14, fontWeight: 600 }} color="text.primary">
                    {label}
                  </Typography>
                ),
              )}
            </Breadcrumbs>
            <Button size="small" startIcon={<FormatListBulleted />} onClick={() => setDrill(question.filters)} disabled={!ready}>
              {t("analysis.drill.plots")}
            </Button>
          </Paper>
        )}
        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 1.5, flex: fullScreen ? "1 1 auto" : undefined, height: fullScreen ? undefined : { md: "calc(100vh - 220px)" }, minHeight: 440 }}>
          <Paper variant="outlined" sx={{ position: "relative", flex: "1 1 0", minWidth: 0, height: { xs: "70vh", md: "auto" }, minHeight: 440, overflow: "hidden" }}>
            {step === "ready" && working > 0 && <LinearProgress sx={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 }} aria-label={t("analysis.working")} />}
            <Box ref={host} sx={{ height: "100%", width: "100%", display: flowing ? "none" : "block" }} data-testid="analysis-pivot" />
            {flowing && shown && question && <ChangeFlows model={data.model} cube={shown.cube} filters={question.filters} measure={flowMeasure} query={query} onPick={setDrill} />}
          </Paper>
          {showMap && canMap && shown && question && (
            <Paper variant="outlined" sx={{ flex: { md: "0 0 40%" }, height: { xs: "60vh", md: "auto" }, minHeight: 320, overflow: "hidden" }}>
              <AnalysisMap projectId={projectId} model={data.model} cube={shown.cube} filters={question.filters} colour={question.rows[0] ?? null} query={query} plotLinks />
            </Paper>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {rows !== null && (
            <Typography variant="body2" color="text.secondary">
              {t("analysis.rows", { count: formatNumber(rows, language) })}
            </Typography>
          )}
          <Explain variant="body2" text={t("analysis.help.short")} more={t("analysis.help")} />
        </Box>
      </Box>
      <SaveDialog
        open={saving !== null}
        team={saving === "team"}
        initial={selected.startsWith(saving === "team" ? "team:" : "mine:") || selected.startsWith("ai:") ? selectedLabel() : ""}
        taken={(name) => (saving === "team" ? teamViews : myViews).some((v) => v.name === name)}
        onCancel={() => setSaving(null)}
        onSave={(name) => void save(name)}
      />
      {drill && shown && (
        <DrillDialog
          projectId={projectId}
          cube={shown.cube}
          filters={drill}
          columns={drillCols}
          query={query}
          plotLinks={!standalone && role !== "operator"}
          fileName={`${fileBase()} - ${t("analysis.d.file")}`}
          onClose={() => setDrill(null)}
        />
      )}
      <Dialog open={packOpen} onClose={() => setPackOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{t("analysis.standaloneTitle")}</DialogTitle>
        <DialogContent>
          <Explain color="text.primary" sx={{ mb: 2 }} text={t("analysis.standaloneText.short")} more={t("analysis.standaloneText")} />
          <FormControlLabel control={<Checkbox checked={packNoPositions} onChange={(e) => setPackNoPositions(e.target.checked)} />} label={t("data.noPositions")} />
          <Typography variant="body2" color="text.secondary">
            {t("data.noPositionsHelp")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPackOpen(false)}>{t("common.cancel")}</Button>
          <Button variant="contained" onClick={() => void downloadStandalone()}>
            {t("analysis.standaloneDownload")}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={notice !== null} autoHideDuration={4000} onClose={() => setNotice(null)} message={notice ?? ""} />
    </Stack>
  );
}

function SaveDialog({ open, team, initial, taken, onCancel, onSave }: { open: boolean; team: boolean; initial: string; taken: (name: string) => boolean; onCancel: () => void; onSave: (name: string) => void }) {
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
        <DialogTitle>{t(team ? "analysis.shareTitle" : "analysis.saveTitle")}</DialogTitle>
        <DialogContent>
          {team ? (
            <Explain sx={{ mb: 2 }} text={t("analysis.shareExplain.short")} more={t("analysis.shareExplain")} />
          ) : (
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {t("analysis.saveExplain")}
            </Typography>
          )}
          <TextField autoFocus fullWidth label={t("analysis.viewName")} value={name} onChange={(e) => setName(e.target.value)} helperText={trimmed && taken(trimmed) ? t("analysis.replaces") : " "} slotProps={{ htmlInput: { maxLength: 80 } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={onCancel}>{t("common.cancel")}</Button>
          <Button type="submit" variant="contained" disabled={!trimmed}>
            {t(team ? "analysis.shareDo" : "common.save")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
