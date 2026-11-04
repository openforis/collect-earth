import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, errorMessageKey, getMe, getServerInfo, logout, setUnauthorizedHandler, type Me, type ServerInfo, type Session } from "./api";
import { AppContext, type AppState } from "./appContext";
import { Loading } from "./components/Loading";
import { I18nContext, initialLanguage, translator, type Language } from "./i18n";
import { choosePage } from "./pageChoice";
import { usePageFocus } from "./pageFocus";
import { JoinPage } from "./pages/JoinPage";
import { ConfirmEmailPage, UnsubscribePage } from "./pages/MailLinkPages";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { LocalSignedOutPage } from "./pages/LocalSignedOutPage";
import { ResetPage } from "./pages/ResetPage";
import { SetupPage } from "./pages/SetupPage";
import { matchRoute, navigate, usePath, type Route } from "./router";
import { getToken, setToken, storeLanguage } from "./storage";
import { theme } from "./theme";

// Pages loaded when first opened: the sign-in and the projects list do not wait for the map and charts.
const AccountPage = lazy(() => import("./pages/AccountPage").then((m) => ({ default: m.AccountPage })));
const ProjectPage = lazy(() => import("./pages/ProjectPage").then((m) => ({ default: m.ProjectPage })));
const PublicProgressPage = lazy(() => import("./pages/PublicProgressPage").then((m) => ({ default: m.PublicProgressPage })));
const MyQualityPage = lazy(() => import("./pages/ReportPages").then((m) => ({ default: m.MyQualityPage })));
const MyWorkPage = lazy(() => import("./pages/ReportPages").then((m) => ({ default: m.MyWorkPage })));
const TeamReportPage = lazy(() => import("./pages/ReportPages").then((m) => ({ default: m.TeamReportPage })));
const TrainingReportPage = lazy(() => import("./pages/TrainingReportPage").then((m) => ({ default: m.TrainingReportPage })));
const WeeklyPage = lazy(() => import("./pages/WeeklyPage").then((m) => ({ default: m.WeeklyPage })));
const ServerPage = lazy(() => import("./pages/ServerPage").then((m) => ({ default: m.ServerPage })));

function RoutePage({ route }: { route: Route }) {
  return (
    <Suspense fallback={<Loading />}>
      <RoutedPage route={route} />
    </Suspense>
  );
}

function RoutedPage({ route }: { route: Route }) {
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
    case "trainingReport":
      return <TrainingReportPage key={`${route.projectId} ${route.setId}`} projectId={route.projectId} setId={route.setId} />;
    case "weekly":
      return <WeeklyPage key={`${route.projectId} ${route.week ?? ""}`} projectId={route.projectId} week={route.week} />;
    case "join":
      return <JoinPage token={route.token} />;
    case "reset":
      return <ResetPage token={route.token} />;
    case "publicProgress":
      return <PublicProgressPage key={route.token} token={route.token} />;
    case "unsubscribe":
      return <UnsubscribePage key={route.token} token={route.token} />;
    case "confirmEmail":
      return <ConfirmEmailPage key={route.token} token={route.token} />;
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
  const path = usePath();
  const route = matchRoute(path);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // The title names each page; a new page gets the focus on its heading. A progress link's page
  // names its project in the title itself; a person, a plot or a plot file has a heading of its own
  // under the project's.
  const announce = usePageFocus(path, {
    serverName: info?.localMode ? t("app.titleLocal") : (info?.serverName ?? t("app.title")),
    language,
    ownTitle: route.name === "publicProgress",
    ownHeading: route.name === "person" || route.name === "plot" || route.name === "plotFile",
    // What the address says, for a page that shows no heading of its own (a plot one may not see, a wrong address).
    fallback: route.name === "plot" ? t("quality.plot", { plot: route.plot }) : route.name === "notFound" ? t("notFound.title") : null,
  });

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
    // The local mode has one project: home is its Progress tab.
    const localProjectId = state.info.localMode ? (me?.memberships[0]?.projectId ?? null) : null;
    const choice = choosePage(route, state.info, me !== null, localProjectId);
    switch (choice.kind) {
      case "setup":
        content = <SetupPage />;
        break;
      case "login":
      case "signup":
        content = <LoginPage key={choice.kind} mode={choice.kind} sessionEnded={sessionEnded} />;
        break;
      case "localSignedOut":
        content = <LocalSignedOutPage />;
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
        {/* Only when a new page has no heading to take the focus: its title. */}
        <Box aria-live="polite" sx={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
          {announce}
        </Box>
      </I18nContext.Provider>
    </ThemeProvider>
  );
}
