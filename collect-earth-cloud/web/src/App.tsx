import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, errorMessageKey, getMe, getServerInfo, logout, setUnauthorizedHandler, type Me, type ServerInfo, type Session } from "./api";
import { AppContext, type AppState } from "./appContext";
import { Loading } from "./components/Loading";
import { I18nContext, initialLanguage, translator, type Language } from "./i18n";
import { choosePage } from "./pageChoice";
import { AccountPage } from "./pages/AccountPage";
import { JoinPage } from "./pages/JoinPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { PublicProgressPage } from "./pages/PublicProgressPage";
import { MyQualityPage, MyWorkPage, TeamReportPage } from "./pages/ReportPages";
import { WeeklyPage } from "./pages/WeeklyPage";
import { ResetPage } from "./pages/ResetPage";
import { ServerPage } from "./pages/ServerPage";
import { SetupPage } from "./pages/SetupPage";
import { matchRoute, navigate, usePath, type Route } from "./router";
import { getToken, setToken, storeLanguage } from "./storage";
import { theme } from "./theme";

function RoutePage({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <ProjectsPage />;
    case "project":
      return <ProjectPage key={route.projectId} projectId={route.projectId} tab={route.tab} />;
    case "plotFile":
      return <ProjectPage key={route.projectId} projectId={route.projectId} tab="plots" fileId={route.fileId} />;
    case "person":
      return <ProjectPage key={route.projectId} projectId={route.projectId} tab="people" personId={route.userId} />;
    case "plot":
      return <ProjectPage key={route.projectId} projectId={route.projectId} tab="quality" plot={route.plot} />;
    case "myQuality":
      return <MyQualityPage key={route.projectId} projectId={route.projectId} />;
    case "myWork":
      return <MyWorkPage key={route.projectId} projectId={route.projectId} />;
    case "teamReport":
      return <TeamReportPage key={route.projectId} projectId={route.projectId} />;
    case "weekly":
      return <WeeklyPage key={`${route.projectId} ${route.week ?? ""}`} projectId={route.projectId} week={route.week} />;
    case "join":
      return <JoinPage token={route.token} />;
    case "reset":
      return <ResetPage token={route.token} />;
    case "publicProgress":
      return <PublicProgressPage key={route.token} token={route.token} />;
    case "account":
      return <AccountPage />;
    case "server":
      return <ServerPage />;
    default:
      return <NotFoundPage />;
  }
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

export function App() {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const t = useMemo(() => translator(language), [language]);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  const route = matchRoute(usePath());

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // A progress link's page names its project in the title itself.
  const ownTitle = route.name === "publicProgress";
  useEffect(() => {
    if (!ownTitle) document.title = info?.serverName ?? t("app.title");
  }, [info?.serverName, t, ownTitle]);

  // The server said our session is no longer valid: back to logging in, on the same page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setMe(null);
      setSessionEnded(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const refreshInfo = useCallback(async () => {
    setInfo(await getServerInfo());
  }, []);

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      return;
    }
    try {
      setMe(await getMe());
    } catch (error) {
      // A 401 already went through the handler above; anything else is a real problem.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
  }, []);

  const start = useCallback(async () => {
    setChecking(true);
    setStartError(null);
    try {
      await Promise.all([refreshInfo(), refreshMe()]);
    } catch (error) {
      setStartError(error);
    } finally {
      setChecking(false);
    }
  }, [refreshInfo, refreshMe]);

  useEffect(() => {
    void start();
  }, [start]);

  const state: AppState | null = useMemo(
    () =>
      info && {
        info,
        me,
        language,
        setLanguage: (next: Language) => {
          setLanguageState(next);
          storeLanguage(next);
        },
        loggedIn: async (session: Session) => {
          setToken(session.token);
          setSessionEnded(false);
          setMe(await getMe());
        },
        logOut: async () => {
          try {
            await logout();
          } catch {
            // the session is dropped here anyway
          }
          setToken(null);
          setMe(null);
          navigate("/");
        },
        refreshMe,
        refreshInfo,
      },
    [info, me, language, refreshMe, refreshInfo],
  );

  let content;
  if (checking) {
    content = <Loading />;
  } else if (!state) {
    content = (
      <Box sx={{ maxWidth: 560, mx: "auto", mt: 8, px: 2 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" onClick={() => void start()}>
              {t("common.retry")}
            </Button>
          }
        >
          {t(errorMessageKey(startError))}
        </Alert>
      </Box>
    );
  } else {
    const choice = choosePage(route, state.info, me !== null);
    switch (choice.kind) {
      case "setup":
        content = <SetupPage />;
        break;
      case "login":
      case "signup":
        content = <LoginPage key={choice.kind} mode={choice.kind} sessionEnded={sessionEnded} />;
        break;
      case "redirect":
        content = <Redirect to={choice.to} />;
        break;
      default:
        content = <RoutePage route={choice.route} />;
    }
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <I18nContext.Provider value={t}>
        {state ? <AppContext.Provider value={state}>{content}</AppContext.Provider> : content}
      </I18nContext.Provider>
    </ThemeProvider>
  );
}
