import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ArrowBack from "@mui/icons-material/ArrowBack";
import OpenInNew from "@mui/icons-material/OpenInNew";
import { useId, useState, type ReactNode } from "react";
import { ApiError, deleteQualityDecision, getPlotPage, setQualityDecision, type DecisionKind, type PlotPageData } from "../api";
import { useApp, useLocalMode } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { FLAG_KIND_KEYS, flagText } from "../flagsView";
import { formatDate } from "../format";
import { useT, type MessageKey } from "../i18n";
import { plotPageParts } from "../localMode";
import { answerRows, hasCheck, recordKindKey, recordStateKey } from "../plotView";
import { CheckAnswers } from "../project/QualityDifferences";
import { answerText, googleEarthUrl } from "../qualityView";
import { earthMapUrl } from "../reviewQueueView";
import { linkProps, pathFor } from "../router";
import { useLoad } from "../useLoad";

const DECISIONS: { kind: DecisionKind; label: MessageKey }[] = [
  { kind: "first", label: "quality.decision.first" },
  { kind: "check", label: "quality.decision.check" },
  { kind: "recheck", label: "quality.decision.recheck" },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: { xs: 1.5, sm: 2 } }}>
      <Typography variant="h3" id={id} sx={{ mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

/** The decision of the plot, and deciding it (coordinators, and reviewers on plots they did not assess). */
function Decision({ projectId, data, onChange }: { projectId: string; data: PlotPageData; onChange: (next: PlotPageData) => void }) {
  const t = useT();
  const { language } = useApp();
  const [comment, setComment] = useState(data.decision?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const decision = data.decision;
  const withCheck = hasCheck(data.records);
  const decide = async (kind: DecisionKind) => {
    setBusy(true);
    setError(null);
    try {
      onChange({ ...data, decision: await setQualityDecision(projectId, data.plot, kind, comment) });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteQualityDecision(projectId, data.plot);
      onChange({ ...data, decision: null });
      setComment("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={1.5}>
      {decision ? (
        <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip color="primary" variant="outlined" label={t("quality.decided", { decision: t(DECISIONS.find((d) => d.kind === decision.decision)!.label) })} />
          {(decision.decidedBy || decision.decidedAt !== null) && (
            <Typography variant="body2" color="text.secondary">
              {decision.decidedBy ? t("quality.decidedBy", { name: decision.decidedBy, time: formatDate(decision.decidedAt, language) }) : formatDate(decision.decidedAt, language)}
            </Typography>
          )}
          {decision.byAssessor && (
            <Typography variant="body2" color="text.secondary">
              {t("quality.byAssessor")}
            </Typography>
          )}
          {!data.ownPlot && (
            <Button size="small" onClick={undo} disabled={busy}>
              {t("quality.undo")}
            </Button>
          )}
        </Stack>
      ) : (
        <Typography color="text.secondary">{t("plot.noDecision")}</Typography>
      )}
      {decision?.comment && <Typography sx={{ wordBreak: "break-word" }}>{decision.comment}</Typography>}
      {data.ownPlot ? (
        <Alert severity="info" role="note">{t("quality.ownPlot")}</Alert>
      ) : (
        <>
          {!withCheck && (
            <Typography variant="body2" color="text.secondary">
              {t("queue.noCheck")}
            </Typography>
          )}
          <TextField label={t("quality.comment")} value={comment} onChange={(e) => setComment(e.target.value)} size="small" multiline slotProps={{ htmlInput: { maxLength: 2000 } }} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
            {DECISIONS.map((d) => (
              <Button key={d.kind} variant={decision?.decision === d.kind ? "contained" : "outlined"} onClick={() => void decide(d.kind)} disabled={busy || (d.kind === "check" && !withCheck)}>
                {t(d.label)}
              </Button>
            ))}
          </Stack>
        </>
      )}
      <ErrorAlert error={error} />
    </Stack>
  );
}

/**
 * One plot (Task 8; coordinators and reviewers, never collectors): its plot files and who holds
 * it, every record with its round and answers, its decision, its flags and its differences
 * (from the quality figures at hand), and where it is.
 */
export function PlotPage({ projectId, plot, canOpenFiles }: { projectId: string; plot: string; canOpenFiles: boolean }) {
  const t = useT();
  const { language } = useApp();
  // The local mode (one person): no decision, differences or holders, and every record is yours.
  const local = useLocalMode();
  const parts = plotPageParts(local);
  const loaded = useLoad(() => getPlotPage(projectId, plot), [projectId, plot]);
  const quality = pathFor({ name: "project", projectId, tab: "quality" });
  const back = (
    <Button startIcon={<ArrowBack />} {...linkProps(quality)} sx={{ alignSelf: "flex-start" }}>
      {t("plot.back")}
    </Button>
  );

  if (loaded.loading && !loaded.data) return <Loading />;
  if (loaded.error || !loaded.data) {
    const missing = loaded.error instanceof ApiError && loaded.error.status === 404;
    return (
      <Stack spacing={2}>
        {back}
        {missing ? <Alert severity="info" role="note" data-page-error>{t("plot.notFound")}</Alert> : <ErrorAlert error={loaded.error} onRetry={loaded.reload} />}
      </Stack>
    );
  }

  const data = loaded.data;
  const label = (key: string) => data.labels[key] ?? key;
  const rows = answerRows(data.questions, data.records);
  const live = data.records.filter((r) => !r.deleted);
  return (
    <Stack spacing={2}>
      {back}
      <Box>
        <Typography variant="h2" sx={{ wordBreak: "break-word" }} data-page-heading>
          {t("quality.plot", { plot: data.plot })}
        </Typography>
        {data.name !== data.plot && <Typography color="text.secondary">{t("plot.seenAs", { name: data.name })}</Typography>}
      </Box>
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
        {data.place ? (
          <>
            <Link href={googleEarthUrl(data.place.lat, data.place.lon)} target="_blank" rel="noopener noreferrer" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              {t("quality.googleEarth")}
              <OpenInNew fontSize="small" titleAccess={t("common.newTab")} />
            </Link>
            <Link
              href={earthMapUrl(data.place.name, data.place.lat, data.place.lon, data.outline)}
              target="_blank"
              rel="noopener noreferrer"
              title={data.outline.kind === "place" ? t("queue.earthMapPlaceTitle") : undefined}
              sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
            >
              {t(data.outline.kind === "place" ? "queue.earthMapPlace" : "queue.earthMap")}
              <OpenInNew fontSize="small" titleAccess={t("common.newTab")} />
            </Link>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {data.unsupportedSrs ? t("quality.placesUnsupported", { srs: data.unsupportedSrs }) : t("plot.noPlace")}
          </Typography>
        )}
        <Link {...linkProps(quality)}>{t(local ? "activity.openQuality" : "plot.openQuality")}</Link>
      </Stack>

      {data.reference && (
        <Alert severity="info" role="note">{data.reference.assessor ? t("plot.reference", { assessor: data.reference.assessor }) : t("plot.referenceNoName")}</Alert>
      )}

      {/* A reference plot is never decided: its other assessments are measured against it. */}
      {!data.reference && parts.decision && (
        <Section title={t("plot.decisionHeading")}>
          <Decision key={data.plot} projectId={projectId} data={data} onChange={(next) => loaded.setData(next)} />
        </Section>
      )}

      <Section title={t("plot.records")}>
        {data.records.length === 0 ? (
          <Typography color="text.secondary">{t("plot.noRecords")}</Typography>
        ) : (
          <Stack spacing={1.5}>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {data.records.map((r) => (
                <Box component="li" key={`${r.operator}\u0000${r.recordKey}`} sx={{ wordBreak: "break-word", mb: 0.5 }}>
                  <Typography component="span" sx={{ fontWeight: 500 }}>
                    {t(recordKindKey(r.assessment))}
                    {parts.names ? ` · ${r.operator}` : ""}
                  </Typography>
                  <Typography component="span" color="text.secondary">
                    {" · "}
                    {t("plot.round", { round: r.round })}
                    {" · "}
                    {t(recordStateKey(r))}
                    {r.modifiedOn !== null ? ` · ${t(local ? "plot.savedLocal" : "plot.saved", { time: formatDate(r.modifiedOn, language) })}` : ""}
                  </Typography>
                </Box>
              ))}
            </Box>
            {live.length > 0 &&
              (rows.length === 0 ? (
                <Typography color="text.secondary">{t("plot.noAnswers")}</Typography>
              ) : (
                <>
                  <Typography variant="body2" color="text.secondary">
                    {t("plot.answers")}
                    {rows.some((row) => row.differs) ? ` · ${t("plot.differsNote")}` : ""}
                  </Typography>
                  <TableContainer sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" }}>
                    <Table size="small" sx={{ "& th, & td": { overflowWrap: "anywhere", px: { xs: 1, sm: 2 }, verticalAlign: "top" } }}>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ minWidth: 120 }}>{t("quality.question")}</TableCell>
                          {data.records.map((r) => (
                            <TableCell key={`${r.operator}\u0000${r.recordKey}`} sx={{ minWidth: 100 }}>
                              {t(recordKindKey(r.assessment))}
                              <Box component="span" sx={{ display: "block", color: "text.secondary", fontWeight: 400 }}>
                                {[parts.names ? r.operator : null, r.deleted ? t("plot.deleted") : !r.submitted ? t("plot.draft") : null].filter((x) => x !== null).join(" · ")}
                              </Box>
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={row.key} sx={row.differs ? { bgcolor: "action.hover" } : undefined}>
                            <TableCell component="th" scope="row">
                              {row.label}
                            </TableCell>
                            {row.values.map((value, i) => (
                              <TableCell key={i}>{value === null ? "—" : answerText(t, row.key, value, data.options)}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              ))}
          </Stack>
        )}
      </Section>

      <Section title={t("plot.flagsHeading")}>
        {data.flags === null ? (
          <Alert severity="info" role="note">{t(local ? "plot.figuresMissingLocal" : "plot.figuresMissing")}</Alert>
        ) : (
          <Stack spacing={1}>
            {data.figures?.stale && (
              <Typography variant="body2" color="text.secondary">
                {t("quality.stale", { time: formatDate(data.figures.computedAt, language) })}
              </Typography>
            )}
            {data.flags.length === 0 ? (
              <Typography color="text.secondary">{t("plot.noFlags")}</Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.flags.map((f, i) => (
                  <Box component="li" key={`${f.kind} ${f.operator} ${i}`} sx={{ wordBreak: "break-word" }}>
                    <Typography variant="body2" component="span" color="text.secondary">
                      {t(FLAG_KIND_KEYS[f.kind])}
                      {parts.names ? ` · ${f.operator}` : ""}
                      {f.at !== null ? ` · ${formatDate(f.at, language)}` : ""}
                      {": "}
                    </Typography>
                    <Typography variant="body2" component="span">
                      {flagText(t, f, language, { local })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Stack>
        )}
      </Section>

      {data.differences !== null && parts.differences && (
        <Section title={t("plot.differencesHeading")}>
          {data.differences.length === 0 ? (
            <Typography color="text.secondary">{t("plot.noDifferences")}</Typography>
          ) : (
            <Stack spacing={1.5}>
              {data.differences.map((d) =>
                d.fields.length > 0 && !d.changed ? (
                  <CheckAnswers key={`${d.check.operator}\u0000${d.check.recordKey}`} difference={d} label={label} options={data.options} />
                ) : (
                  <Alert key={`${d.check.operator}\u0000${d.check.recordKey}`} severity="info">
                    {t("queue.answersChanged", { first: d.first.operator, check: d.check.operator })}
                  </Alert>
                ),
              )}
            </Stack>
          )}
        </Section>
      )}

      <Section title={t(parts.holders && data.files.some((f) => f.main !== null) ? "plot.files" : "tab.plots")}>
        <Stack spacing={1.5}>
          {data.files.map((f) => (
            <Box key={f.id}>
              <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
                {canOpenFiles ? (
                  <Link {...linkProps(pathFor({ name: "plotFile", projectId, fileId: f.id }))} sx={{ fontWeight: 500, wordBreak: "break-word" }} title={t("plot.openFile")}>
                    {f.filename}
                  </Link>
                ) : (
                  <Typography sx={{ fontWeight: 500, wordBreak: "break-word" }}>{f.filename}</Typography>
                )}
                {parts.holders && <Chip size="small" variant="outlined" label={t(f.divided ? "plot.fileDivided" : "plot.fileWhole")} />}
              </Stack>
              {f.main !== null && parts.holders && (
                <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                  {f.main.length > 0 ? t("plot.holders", { names: f.main.join(", ") }) : t("plot.nobody")}
                </Typography>
              )}
              {f.copies !== null && f.copies.length > 0 && parts.holders && (
                <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                  {t("plot.copies", { names: f.copies.join(", ") })}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}
