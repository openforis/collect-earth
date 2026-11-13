// The stand-alone analysis: the analysis page's pivot over a copy of the data, in one HTML file that opens from the disk
// in any browser, with no server, no internet and no installation (what replaces the stand-alone Saiku tool). Built by
// web/standalone.config.ts; the server puts the data in it when it is downloaded (src/routes/analysis.ts):
// window.__CE_ANALYSIS, the gzipped JSON of StandaloneAnalysis in base64.
// The scripts of its four languages only: every font is inside the file
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import "@fontsource/roboto/latin-ext-400.css";
import "@fontsource/roboto/latin-ext-500.css";
import "@fontsource/roboto/latin-ext-700.css";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Container from "@mui/material/Container";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { ThemeProvider } from "@mui/material/styles";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ServerInfo, StandaloneAnalysis } from "./api";
import { AppContext, type AppState } from "./appContext";
import { LanguageMenu } from "./components/AppShell";
import { Explain } from "./components/Explain";
import { Loading } from "./components/Loading";
import { I18nContext, initialLanguage, translator, type Language } from "./i18n";
import { Pivot } from "./pages/AnalysisPage";
import { storeLanguage } from "./storage";
import { theme } from "./theme";
import { collectEarthAppBar } from "./shared/collectEarthTheme";
import logo from "./shared/collect-earth-logo.png";

declare global {
  interface Window {
    __CE_ANALYSIS?: string;
  }
}

/** The data the file holds, or null when it holds none (the template itself, or a file cut short). */
async function readData(): Promise<StandaloneAnalysis | null> {
  const base64 = window.__CE_ANALYSIS;
  if (!base64) return null;
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text()) as StandaloneAnalysis;
  } catch {
    return null;
  }
}

/** What the analysis page reads of the app: a single person, with no server (the local mode leaves the team out). */
const INFO = { localMode: true } as ServerInfo;

function Standalone() {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = useMemo(() => translator(language), [language]);
  const [data, setData] = useState<StandaloneAnalysis | null | undefined>(undefined);
  useEffect(() => void readData().then(setData), []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  useEffect(() => {
    if (data) document.title = `${data.project.name} · ${t("analysis.title")}`;
  }, [data, t]);

  const state: AppState = {
    info: INFO,
    me: null,
    language,
    setLanguage: (next) => {
      setLanguage(next);
      storeLanguage(next);
    },
    loggedIn: async () => {},
    logOut: async () => {},
    refreshMe: async () => {},
    refreshInfo: async () => {},
  };
  const made = data ? new Date(data.made).toLocaleDateString(language, { year: "numeric", month: "long", day: "numeric" }) : "";
  const plots = data?.tables.find((x) => x.name === "plot")?.rows ?? 0;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* the full text of a "more about this" tip is for paper only (as AppShell's print styles) */}
      <GlobalStyles styles={{ "@media screen": { ".print-only": { display: "none !important" } } }} />
      <I18nContext.Provider value={t}>
        <AppContext.Provider value={state}>
          {/* Collect Earth's app bar (src/shared/collectEarthTheme.ts); the logo is inside the file, as everything else */}
          <AppBar position="static" color={collectEarthAppBar.color} elevation={collectEarthAppBar.elevation}>
            <Toolbar variant="dense" sx={{ gap: 1.5 }}>
              <Box component="img" src={logo} alt="" sx={collectEarthAppBar.logoSx} />
              <Typography variant="subtitle1" component="div" sx={{ flex: 1, minWidth: 0, fontWeight: 600 }} noWrap>
                {data ? `${data.project.name} · ${t("analysis.title")}` : t("analysis.title")}
              </Typography>
              <LanguageMenu />
            </Toolbar>
          </AppBar>
          <Container maxWidth={false} sx={{ py: 3 }}>
            {data === undefined ? (
              <Loading />
            ) : data === null ? (
              <Alert severity="error">{t("analysis.standaloneBroken")}</Alert>
            ) : (
              <>
                <Explain text={t("analysis.standaloneMade.short", { date: made })} more={t("analysis.standaloneMade", { date: made })} />
                <Explain sx={{ mb: 2 }} text={t("analysis.standaloneFresh.short")} more={t("analysis.standaloneFresh")} />
                {/* What the file holds, first: it is easy to pass around */}
                <Alert severity="warning" sx={{ mb: 2 }} data-testid="standalone-share">
                  {t("analysis.standaloneShare", { project: data.project.name })}
                  {data.withoutPositions ? ` ${t("analysis.standaloneNoPositions")}` : ""}
                </Alert>
                {plots === 0 ? (
                  <Alert severity="info">{t(data.scope === "own" ? "analysis.emptyOwn" : "analysis.empty")}</Alert>
                ) : (
                  <Box>
                    <Pivot projectId={data.project.id} projectName={data.project.name} role={data.scope === "own" ? "operator" : "admin"} data={data} language={language} standalone />
                  </Box>
                )}
              </>
            )}
          </Container>
        </AppContext.Provider>
      </I18nContext.Provider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Standalone />
  </StrictMode>,
);
