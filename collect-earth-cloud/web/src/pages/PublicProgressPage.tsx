import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import GlobalStyles from "@mui/material/GlobalStyles";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import LinkOff from "@mui/icons-material/LinkOff";
import Print from "@mui/icons-material/Print";
import { useEffect, useState } from "react";
import { ApiError, getPublicProgress, type PublicProgressData } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { EmptyState } from "../components/EmptyState";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { AsOf } from "../components/PeopleCharts";
import { formatDate } from "../format";
import { useT } from "../i18n";
import { ForecastSection, OverTime, Section, Totals, useNow } from "../project/ProgressTab";
import { browserTimeZone, publicQualityText, updatedText } from "../progressView";
import { formatRate } from "../qualityView";
import { useLoad } from "../useLoad";
import { onceVisibleAfter } from "../visibility";

/** A progress link's page is read again this often while it is visible (it is a page to glance at, not to watch). */
export const PUBLIC_REFRESH_MS = 5 * 60_000;

/** Printed: the chart's Chart/Table switch is left out too (the app shell already hides the buttons). */
const PRINT = { "@media print": { ".MuiToggleButtonGroup-root": { display: "none !important" } } } as const;

/** While the page is open: not indexed, no referrer (its address holds the token). The server's headers say the same. */
function usePrivatePage(title: string | null) {
  const t = useT();
  useEffect(() => {
    const metas = [
      ["robots", "noindex, nofollow"],
      ["referrer", "no-referrer"],
    ].map(([name, content]) => {
      const meta = document.createElement("meta");
      meta.name = name;
      meta.content = content;
      document.head.appendChild(meta);
      return meta;
    });
    return () => metas.forEach((m) => m.remove());
  }, []);
  useEffect(() => {
    if (title) document.title = t("publicProgress.pageTitle", { project: title });
  }, [title, t]);
}

function QualitySection({ data }: { data: PublicProgressData }) {
  const t = useT();
  const { language } = useApp();
  const q = data.quality;
  const rate = q.agreement?.rate ?? null;
  return (
    <Section title={t("publicProgress.qualityTitle")} id="public-quality">
      <Stack spacing={1}>
        <Typography color="text.secondary">{t("publicProgress.qualityExplain")}</Typography>
        {rate !== null && (
          <Typography variant="h2" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatRate(rate, language)}
          </Typography>
        )}
        <Typography>{publicQualityText(t, q, language)}</Typography>
        {q.available && q.computedAt !== null && (
          <Typography variant="body2" color="text.secondary">
            {t("publicProgress.qualityAsOf", { time: formatDate(q.computedAt, language) })}
          </Typography>
        )}
      </Stack>
    </Section>
  );
}

/**
 * A read-only progress link for funders (/p/<token>): the project's name, its totals, the
 * progress chart, the forecast and one quality figure. No login and no app chrome beyond the
 * server's name and the language; no names, answers or plot ids (the server never sends them).
 */
export function PublicProgressPage({ token }: { token: string }) {
  const t = useT();
  const timeZone = browserTimeZone();
  const state = useLoad(() => getPublicProgress(token, timeZone), [token, timeZone]);
  const { data, loading, reload, error } = state;
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const now = useNow(15_000);
  usePrivatePage(data?.projectName ?? null);

  useEffect(() => {
    if (data) setLoadedAt(Date.now());
  }, [data]);
  useEffect(() => {
    if (loading) return;
    return onceVisibleAfter(PUBLIC_REFRESH_MS, document, reload);
  }, [loading, reload]);

  let body;
  if (loading && !data) {
    body = <Loading />;
  } else if (!data && error instanceof ApiError && error.status === 404) {
    body = (
      <Paper variant="outlined">
        <EmptyState icon={<LinkOff color="error" />} title={t("publicProgress.invalidTitle")}>
          {t("publicProgress.invalid")}
        </EmptyState>
      </Paper>
    );
  } else if (!data) {
    body = <ErrorAlert error={error} onRetry={reload} />;
  } else {
    body = (
      <Stack spacing={3}>
        <GlobalStyles styles={PRINT} />
        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {t("publicProgress.kicker")}
          </Typography>
          <Typography variant="h1" sx={{ wordBreak: "break-word" }}>
            {data.projectName}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mr: "auto" }}>
              {updatedText(t, loadedAt, now)}
            </Typography>
            <Button size="small" startIcon={<Print />} onClick={() => window.print()}>
              {t("publicProgress.print")}
            </Button>
          </Stack>
        </Box>
        {error !== null && error !== undefined && <ErrorAlert error={error} onRetry={reload} />}
        <AsOf asOf={data.asOf} />
        {data.totals.plots === 0 ? <Alert severity="info">{t("publicProgress.noPlots")}</Alert> : <Totals data={data} />}
        <ForecastSection data={data} publicView />
        <OverTime data={data} />
        <QualitySection data={data} />
        <Typography variant="body2" color="text.secondary">
          {t("publicProgress.privacy")}
        </Typography>
      </Stack>
    );
  }

  return <AppShell bare>{body}</AppShell>;
}
