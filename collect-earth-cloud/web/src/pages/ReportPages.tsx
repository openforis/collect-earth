import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import ArrowBack from "@mui/icons-material/ArrowBack";
import Print from "@mui/icons-material/Print";
import { useEffect, type ReactNode } from "react";
import { getMyQuality, getMyWork, getProject, getTeamReport, type AnswerOptions, type ReportConfusion, type ReportNote } from "../api";
import { useApp } from "../appContext";
import { AppShell } from "../components/AppShell";
import { ErrorAlert } from "../components/ErrorAlert";
import { MyTraining } from "../components/MyTraining";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { answerText, rateText } from "../qualityView";
import { linkProps, pathFor, type ProjectTab } from "../router";
import { useLoad, type Loaded } from "../useLoad";
import { onceVisibleAfter } from "../visibility";
import { browserTimeZone } from "../progressView";
import { AsOf } from "../components/PeopleCharts";
import { ActivitySection, FilesSection, PersonHeading, PersonNumbers, QualitySection, SpeedSection, SyncSection } from "./PersonPage";

/** How long to wait before asking again for figures that were stale. */
const STALE_RETRY_MS = 10_000;

/**
 * Stale figures (newer ones being worked out): asked for again after a while, only while
 * the page is visible; hidden when the wait ends, as soon as it is shown again.
 */
function useRefreshWhileStale<T extends { stale: boolean }>(loaded: Loaded<T>) {
  const stale = loaded.data?.stale === true && !loaded.loading;
  const { reload } = loaded;
  useEffect(() => {
    if (!stale) return;
    return onceVisibleAfter(STALE_RETRY_MS, document, reload);
  }, [stale, reload]);
}

/** A printable report: the project's name, the title, Back and Print (hidden when printed), and its content. */
export function ReportFrame({
  projectId,
  title,
  back,
  backTo,
  printable = true,
  children,
}: {
  projectId: string;
  title: string;
  back: ProjectTab;
  /** A page to go back to instead of the tab (a training set's page), and its link's words. */
  backTo?: { path: string; label: string };
  /** False while there is nothing to print (loading, or refused). */
  printable?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const project = useLoad(() => getProject(projectId), [projectId]);
  return (
    <AppShell>
      <Stack spacing={3}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }} className="no-print">
          <Button startIcon={<ArrowBack />} {...linkProps(backTo?.path ?? pathFor({ name: "project", projectId, tab: back }))}>
            {backTo?.label ?? t("report.back")}
          </Button>
          {printable && (
            <Button startIcon={<Print />} variant="outlined" onClick={() => window.print()}>
              {t("common.print")}
            </Button>
          )}
        </Stack>
        {/* The heading shows once the project is known: the page's title names both ("Team report – North survey"). */}
        {!project.loading && (
          <div>
            <Typography variant="h1" sx={{ wordBreak: "break-word" }}>
              {title}
            </Typography>
            {project.data && (
              <Typography variant="h2" component="p" color="text.secondary" sx={{ wordBreak: "break-word" }} data-page-context>
                {project.data.name}
              </Typography>
            )}
          </div>
        )}
        {children}
      </Stack>
    </AppShell>
  );
}

/** When the figures are from, and whether newer ones are coming. */
export function FiguresTime({ computedAt, stale }: { computedAt: number | null; stale: boolean }) {
  const t = useT();
  const { language } = useApp();
  if (computedAt === null) return null;
  const time = formatDate(computedAt, language);
  return (
    <Typography variant="body2" color="text.secondary" role="status">
      {stale ? t("quality.stale", { time }) : t("report.computedAt", { time })}
    </Typography>
  );
}

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" component="section" sx={{ p: { xs: 2, sm: 3 }, breakInside: "avoid" }}>
      <Stack spacing={1.5}>
        <Typography variant="h2">{title}</Typography>
        {children}
      </Stack>
    </Paper>
  );
}

/** An answer by its label in the survey ("Forest", Yes/No), "(no answer)" for a blank one. */
function answer(t: ReturnType<typeof useT>, key: string, value: string, options: AnswerOptions): string {
  return answerText(t, key, value, options);
}

function NoteText({ note, label, options }: { note: ReportNote; label?: string; options: AnswerOptions }) {
  const t = useT();
  const pair = note.firstValue !== null || note.checkValue !== null;
  const value = (v: string | null) => (v === null ? t("quality.anyAnswer") : answer(t, note.questionKey, v, options));
  return (
    <Box component="li" sx={{ mb: 1, breakInside: "avoid" }}>
      {(label || pair) && (
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
          {label}
          {label && pair && " · "}
          {pair && t("quality.noteAbout", { first: value(note.firstValue), check: value(note.checkValue) })}
        </Typography>
      )}
      <Typography sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{note.text}</Typography>
    </Box>
  );
}

function ConfusionItem({ confusion, text, plots, options }: { confusion: ReportConfusion; text: string; plots: string; options: AnswerOptions }) {
  const t = useT();
  return (
    <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5, breakInside: "avoid" }}>
      <Typography variant="h3" sx={{ wordBreak: "break-word" }}>
        {confusion.label}
      </Typography>
      <Typography sx={{ wordBreak: "break-word" }}>{text}</Typography>
      {confusion.plots.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
          {plots}
        </Typography>
      )}
      {confusion.notes.length > 0 && (
        <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2.5 }} aria-label={t("myQuality.notes")}>
          {confusion.notes.map((note) => (
            <NoteText key={note.id} note={note} options={options} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** "My quality": a member's own figures as first assessor, their usual mix-ups and the notes about them. Never who checked. */
export function MyQualityPage({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const mine = useLoad(() => getMyQuality(projectId), [projectId]);
  useRefreshWhileStale(mine);
  const data = mine.data;
  return (
    <ReportFrame projectId={projectId} title={t("myQuality.title")} back="progress">
      <Typography color="text.secondary">{t("myQuality.intro")}</Typography>
      <Box className="no-print">
        <Button variant="outlined" {...linkProps(pathFor({ name: "myWork", projectId }))}>
          {t("myWork.link")}
        </Button>
      </Box>
      {!data ? (
        mine.loading ? <Loading /> : <ErrorAlert error={mine.error} onRetry={mine.reload} />
      ) : (
        <>
          <FiguresTime computedAt={data.computedAt} stale={data.stale} />
          <Block title={t("myQuality.checked")}>
            {data.asFirst.compared === 0 ? (
              <Alert severity="info">{t("myQuality.none")}</Alert>
            ) : (
              <Typography sx={{ fontSize: "1.25rem", fontVariantNumeric: "tabular-nums" }}>{rateText(t, data.asFirst, language)}</Typography>
            )}
          </Block>
          {data.asFirst.compared > 0 && (
            <Block title={t("myQuality.confusionsTitle")}>
              {data.confusions.length === 0 && <Typography>{t("myQuality.confusionsNone")}</Typography>}
              {data.confusions.map((c) => (
                <ConfusionItem
                  key={`${c.key}\u0000${c.first}\u0000${c.check}`}
                  confusion={c}
                  options={data.options}
                  text={t(c.checks === 1 ? "myQuality.confusionOnce" : "myQuality.confusion", {
                    first: answer(t, c.key, c.first, data.options),
                    check: answer(t, c.key, c.check, data.options),
                    count: formatNumber(c.checks, language),
                  })}
                  plots={t("quality.plotsList", { plots: c.plots.join("; ") })}
                />
              ))}
            </Block>
          )}
        </>
      )}
    </ReportFrame>
  );
}

/**
 * "My work": the numbers the coordinators see about the person looking (their plots,
 * days and hours, speed, syncs, agreement and the plots to look at again), and the
 * sentence saying so. Own data only: the server answers with the signed-in person's.
 */
export function MyWorkPage({ projectId }: { projectId: string }) {
  const t = useT();
  const timeZone = browserTimeZone();
  const mine = useLoad(() => getMyWork(projectId, timeZone), [projectId, timeZone]);
  const data = mine.data;
  return (
    <ReportFrame projectId={projectId} title={t("myWork.title")} back="progress">
      <Alert severity="info">{t("myWork.coordinatorsSee")}</Alert>
      <Box className="no-print">
        <Button variant="outlined" {...linkProps(pathFor({ name: "myQuality", projectId }))}>
          {t("myQuality.link")}
        </Button>
      </Box>
      {!data ? (
        mine.loading ? <Loading /> : <ErrorAlert error={mine.error} onRetry={mine.reload} />
      ) : (
        <>
          <PersonHeading data={data} />
          <AsOf asOf={data.asOf} />
          <PersonNumbers data={data} self />
          <FilesSection data={data} projectId={projectId} />
          <MyTraining projectId={projectId} />
          <ActivitySection data={data} self />
          <SpeedSection data={data} />
          <SyncSection data={data} self />
          <QualitySection data={data} self projectId={projectId} />
          <YourData />
        </>
      )}
    </ReportFrame>
  );
}

/**
 * What this server records about the person and who sees it (recommendation 6 of the data review): said plainly, on
 * the page that already shows them the coordinators' figures about them.
 */
function YourData() {
  const t = useT();
  const items = ["yourData.answers", "yourData.when", "yourData.time", "yourData.sync", "yourData.account"] as const;
  return (
    <Block title={t("yourData.title")}>
      <Typography sx={{ mb: 1 }}>{t("yourData.intro")}</Typography>
      <Box component="ul" sx={{ mt: 0, pl: 3 }}>
        {items.map((k) => (
          <li key={k}>
            <Typography>{t(k)}</Typography>
          </li>
        ))}
      </Box>
      <Typography sx={{ mb: 1 }}>{t("yourData.who")}</Typography>
      <Typography sx={{ mb: 1 }}>{t("yourData.ai")}</Typography>
      <Typography>{t("yourData.kept")}</Typography>
    </Block>
  );
}

/** The team report for training (coordinators): agreement by question, the most mixed-up answers, the notes. No names. */
export function TeamReportPage({ projectId }: { projectId: string }) {
  const t = useT();
  const { language } = useApp();
  const report = useLoad(() => getTeamReport(projectId), [projectId]);
  useRefreshWhileStale(report);
  const data = report.data;
  const labels = new Map((data?.questions ?? []).map((q) => [q.key, q.label]));
  return (
    <ReportFrame projectId={projectId} title={t("teamReport.title")} back="quality" printable={Boolean(data)}>
      <Typography color="text.secondary">{t("teamReport.intro")}</Typography>
      {!data ? (
        report.loading ? <Loading /> : <ErrorAlert error={report.error} onRetry={report.reload} />
      ) : (
        <>
          <FiguresTime computedAt={data.computedAt} stale={data.stale} />
          {data.plotsChecked === 0 ? (
            <Alert severity="info">{t("teamReport.none")}</Alert>
          ) : (
            <>
              <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
                {[
                  [t("quality.plotsChecked"), data.plotsChecked],
                  [t("quality.plotsDiffering"), data.plotsDiffering],
                ].map(([label, value]) => (
                  <Box key={String(label)}>
                    <Typography variant="body2" color="text.secondary">
                      {label}
                    </Typography>
                    <Typography sx={{ fontSize: "2rem", fontWeight: 600, lineHeight: 1.2 }}>{formatNumber(Number(value), language)}</Typography>
                  </Box>
                ))}
              </Stack>
              <Block title={t("quality.questionsTitle")}>
                <Box sx={{ overflowX: "auto" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("quality.question")}</TableCell>
                        <TableCell>{t("quality.agreement")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.questions.map((q) => (
                        <TableRow key={q.key} sx={{ verticalAlign: "top", breakInside: "avoid" }}>
                          <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", minWidth: 140 }}>
                            {q.label}
                            {q.kind === "number" && q.margin !== null && (
                              <Typography variant="body2" color="text.secondary">
                                {t("quality.withinMargin", { margin: q.margin })}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>{rateText(t, q, language)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              </Block>
              <Block title={t("teamReport.confusionsTitle")}>
                {data.confusions.length === 0 && <Typography>{t("quality.noConfusions")}</Typography>}
                {data.confusions.map((c) => (
                  <ConfusionItem
                    key={`${c.key}\u0000${c.first}\u0000${c.check}`}
                    confusion={c}
                    options={data.options}
                    text={t(c.checks === 1 ? "teamReport.confusionOnce" : "teamReport.confusion", {
                      first: answer(t, c.key, c.first, data.options),
                      check: answer(t, c.key, c.check, data.options),
                      count: formatNumber(c.checks, language),
                    })}
                    plots={t("teamReport.examples", { plots: c.plots.join("; ") })}
                  />
                ))}
              </Block>
            </>
          )}
          <Block title={t("teamReport.notesTitle")}>
            {data.notes.length === 0 ? (
              <Typography>{t("teamReport.noNotes")}</Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.notes.map((note) => (
                  <NoteText key={note.id} note={note} label={labels.get(note.questionKey) ?? note.questionKey} options={data.options} />
                ))}
              </Box>
            )}
          </Block>
        </>
      )}
    </ReportFrame>
  );
}
