import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { ApiError, getQuality, saveQualityMargins, type AnswerOptions, type GuidanceNote, type QualityData, type Rate } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import {
  answerText,
  barPercent,
  canWriteNote,
  formatRate,
  keepLocalChanges,
  labelMap,
  marginRows,
  marginsToSave,
  parseMargin,
  pollDelay,
  problemMessageKey,
  rateText,
  reloadOnShow,
  splitWeek,
  weekChart,
  weekRateText,
  weekText,
  withDecision,
  withNote,
  type WeekPoint,
} from "../qualityView";
import { linkProps, pathFor } from "../router";
import { useLoad } from "../useLoad";
import { QualityAnswers } from "./QualityAnswers";
import { QualityChecks } from "./QualityChecks";
import { QualityFlags } from "./QualityFlags";
import { QualitySurvey } from "./QualitySurvey";
import { QualityReference } from "./QualityReference";
import { QualityAssistant } from "./QualityAssistant";
import { QualityDifferences, type PlotFocus } from "./QualityDifferences";
import { NoteDialog, QualityNotes, type NoteDraft } from "./QualityNotes";
import { ReviewQueue } from "./ReviewQueue";

/**
 * The agreement colour: one series everywhere, so one hue. A step of the dashboard's
 * green with enough chroma for a mark (the theme's #2e6b3f reads grey as a bar), and a
 * light step of the same hue for the bar's track.
 */
export const MARK = "#2f7d4a";
const TRACK = "#dcebe0";

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" } as const;

function Section({ title, explain, children }: { title: string; explain?: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section">
      <Stack spacing={2}>
        <Typography variant="h2">{title}</Typography>
        {explain && <Typography color="text.secondary">{explain}</Typography>}
        {children}
      </Stack>
    </Paper>
  );
}

/** A rate as text with its bar under it (the bar only when there is a rate). */
function RateBar({ rate }: { rate: Rate }) {
  const t = useT();
  const { language } = useApp();
  const pct = barPercent(rate);
  return (
    <Box sx={{ minWidth: 150 }}>
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }} color={pct === null ? "text.secondary" : "text.primary"}>
        {rateText(t, rate, language)}
      </Typography>
      {pct !== null && (
        <Box aria-hidden sx={{ mt: 0.5, height: 8, bgcolor: TRACK, maxWidth: 260 }}>
          <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: MARK, borderRadius: "0 4px 4px 0" }} />
        </Box>
      )}
    </Box>
  );
}

/** A big figure with its label. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ minWidth: 140 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography sx={{ fontSize: "2rem", fontWeight: 600, lineHeight: 1.2 }}>{value}</Typography>
    </Box>
  );
}

function Counts({ data, stillWorking }: { data: QualityData; stillWorking: boolean }) {
  const t = useT();
  const { language } = useApp();
  return (
    <Section title={t("quality.title")} explain={t("quality.explain")}>
      {data.stale && data.computedAt !== null && (
        <Alert severity="info" role="status">
          {t("quality.stale", { time: formatDate(data.computedAt, language) })}
        </Alert>
      )}
      {/* Busy asking for newer figures, with these on screen: a quiet line, not an error. */}
      {stillWorking && (
        <Typography variant="body2" color="text.secondary" role="status">
          {t("quality.stillWorking")}
        </Typography>
      )}
      {data.plotsChecked === 0 ? (
        <Alert severity="info">{t("quality.none")}</Alert>
      ) : (
        <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Figure label={t("quality.plotsChecked")} value={formatNumber(data.plotsChecked, language)} />
          <Figure label={t("quality.plotsDiffering")} value={formatNumber(data.plotsDiffering, language)} />
        </Stack>
      )}
    </Section>
  );
}

function Margins({ projectId, data, onSaved }: { projectId: string; data: QualityData; onSaved: (margins: Record<string, number>) => void }) {
  const t = useT();
  const rows = useMemo(() => marginRows(data.questions, data.margins), [data.questions, data.margins]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  if (rows.length === 0) return null;
  const textOf = (key: string, value: number) => texts[key] ?? String(value);
  const parsed = rows.map((row) => ({ row, value: parseMargin(textOf(row.key, row.value)) }));
  const invalid = parsed.some((p) => p.value === null);
  const changed = parsed.some((p) => p.value !== null && p.value !== p.row.value);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      // The server replaces the whole set: the saved margins are sent too, those shown over them.
      const shown = Object.fromEntries(parsed.map((p) => [p.row.key, p.value as number]));
      onSaved(await saveQualityMargins(projectId, marginsToSave(data.margins, shown)));
      setTexts({});
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={(e) => (e.preventDefault(), void save())} sx={{ pt: 1 }}>
      <Typography variant="h3" sx={{ mb: 0.5 }}>
        {t("quality.marginsTitle")}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("quality.marginsExplain")}
      </Typography>
      <Stack spacing={2}>
        {parsed.map(({ row, value }) => (
          <Stack key={row.key} direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1, sm: 2 }} sx={{ alignItems: { sm: "center" } }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ wordBreak: "break-word" }}>{row.label}</Typography>
              {row.entity && (
                <Typography variant="body2" color="text.secondary">
                  {t("quality.marginEvery", { entity: row.entity })}
                </Typography>
              )}
            </Box>
            <TextField
              label={t("quality.marginLabel")}
              value={textOf(row.key, row.value)}
              onChange={(e) => {
                setSaved(false);
                setTexts({ ...texts, [row.key]: e.target.value });
              }}
              error={value === null}
              helperText={value === null ? t("quality.marginInvalid") : undefined}
              size="small"
              fullWidth={false}
              sx={{ width: { xs: "100%", sm: 140 } }}
              slotProps={{ htmlInput: { inputMode: "decimal", "aria-label": `${t("quality.marginLabel")}: ${row.label}` } }}
            />
          </Stack>
        ))}
        <Box>
          <Button type="submit" variant="contained" disabled={busy || invalid || !changed}>
            {t("quality.marginsSave")}
          </Button>
        </Box>
        {saved && (
          <Alert severity="success" role="status">
            {t("quality.marginsSaved")}
          </Alert>
        )}
        <ErrorAlert error={error} />
      </Stack>
    </Box>
  );
}

function Questions({ projectId, data, onMargins }: { projectId: string; data: QualityData; onMargins: (m: Record<string, number>) => void }) {
  const t = useT();
  return (
    <Section title={t("quality.questionsTitle")} explain={t("quality.questionsExplain")}>
      {data.questions.length === 0 ? (
        <Alert severity="info">{t("quality.noQuestions")}</Alert>
      ) : (
        <TableContainer sx={tableFrame}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t("quality.question")}</TableCell>
                <TableCell>{t("quality.agreement")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.questions.map((q) => (
                <TableRow key={q.key} sx={{ verticalAlign: "top" }}>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word", minWidth: 140 }}>
                    {q.label}
                    {q.kind === "number" && q.margin !== null && (
                      <Typography variant="body2" color="text.secondary">
                        {t("quality.withinMargin", { margin: q.margin })}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <RateBar rate={q} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Margins projectId={projectId} data={data} onSaved={onMargins} />
    </Section>
  );
}

/** An answer as shown: the option's label ("Forest", Yes/No), "(no answer)" for a blank one. */
function Answer({ questionKey, value, options }: { questionKey: string; value: string; options: AnswerOptions }) {
  const t = useT();
  return value ? (
    <>{answerText(t, questionKey, value, options)}</>
  ) : (
    <Box component="span" sx={{ color: "text.secondary", fontStyle: "italic" }}>
      {t("quality.blank")}
    </Box>
  );
}

function Confusions({ data, onWriteNote }: { data: QualityData; onWriteNote: (draft: NoteDraft) => void }) {
  const t = useT();
  const { language } = useApp();
  const label = labelMap(data.questions);
  const keys = useMemo(() => [...new Set(data.confusions.map((c) => c.key))], [data.confusions]);
  const [picked, setPicked] = useState<string>("");
  const [open, setOpen] = useState<string | null>(null);
  const key = keys.includes(picked) ? picked : (keys[0] ?? "");
  const rows = data.confusions.filter((c) => c.key === key);
  const noteFor = (first: string, check: string): GuidanceNote | undefined =>
    data.notes.find((n) => n.questionKey === key && n.firstValue === (first || null) && n.checkValue === (check || null));

  return (
    <Section title={t("quality.confusionsTitle")} explain={t("quality.confusionsExplain")}>
      {keys.length === 0 ? (
        <Alert severity="info">{t("quality.noConfusions")}</Alert>
      ) : (
        <>
          <FormControl size="small" sx={{ maxWidth: 480 }}>
            <InputLabel id="confusion-question">{t("quality.question")}</InputLabel>
            <Select labelId="confusion-question" label={t("quality.question")} value={key} onChange={(e) => setPicked(e.target.value)}>
              {keys.map((k) => (
                <MenuItem key={k} value={k} sx={{ whiteSpace: "normal" }}>
                  {label(k)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TableContainer sx={tableFrame}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("quality.firstAnswer")}</TableCell>
                  <TableCell>{t("quality.checkAnswer")}</TableCell>
                  <TableCell align="right">{t("quality.times")}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c, index) => {
                  const id = `${c.first}\u0000${c.check}`;
                  const noteable = canWriteNote(c.first, c.check);
                  const note = noteable ? noteFor(c.first, c.check) : undefined;
                  const whyNot = `confusion-no-note-${index}`;
                  return (
                    <TableRow key={id} sx={{ verticalAlign: "top" }}>
                      <TableCell sx={{ wordBreak: "break-word" }}>
                        <Answer questionKey={c.key} value={c.first} options={data.options} />
                      </TableCell>
                      <TableCell sx={{ wordBreak: "break-word" }}>
                        <Answer questionKey={c.key} value={c.check} options={data.options} />
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {formatNumber(c.count, language)}
                      </TableCell>
                      <TableCell>
                        <Stack spacing={0.5} sx={{ alignItems: "flex-start", "& .MuiButton-root": { whiteSpace: "nowrap" } }}>
                          <Button size="small" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id}>
                            {open === id ? t("quality.hidePlots") : t("quality.showPlots")}
                          </Button>
                          <Button
                            size="small"
                            // A blank answer in a note means "any answer": not what this row is about.
                            disabled={!noteable}
                            aria-describedby={noteable ? undefined : whyNot}
                            onClick={() => onWriteNote(note ? { ...note } : { questionKey: c.key, firstValue: c.first, checkValue: c.check, text: "" })}
                          >
                            {note ? t("quality.editNote") : t("quality.writeNote")}
                          </Button>
                          {!noteable && (
                            <Typography id={whyNot} variant="body2" color="text.secondary" sx={{ maxWidth: 220 }}>
                              {t("quality.noteNeedsAnswers")}
                            </Typography>
                          )}
                        </Stack>
                        {open === id && (
                          <Typography variant="body2" sx={{ mt: 1, wordBreak: "break-word" }}>
                            {t("quality.plotsList", { plots: c.plots.join("; ") })}
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}
    </Section>
  );
}

/**
 * The person column stays in view while the wide table scrolls sideways on a phone: on
 * the left, over a background so the other columns pass under it.
 */
const stickyFirst = {
  position: { xs: "sticky", sm: "static" },
  left: 0,
  zIndex: 1,
  bgcolor: "background.paper",
  borderRight: { xs: 1, sm: 0 },
  borderRightColor: "divider",
  minWidth: 96,
} as const;

function People({ data }: { data: QualityData }) {
  const t = useT();
  const label = labelMap(data.questions);
  return (
    <Section title={t("quality.peopleTitle")} explain={t("quality.peopleExplain")}>
      {data.people.length === 0 ? (
        <Alert severity="info">{t("quality.noPeople")}</Alert>
      ) : (
        <TableContainer sx={tableFrame}>
          <Table size="small" sx={{ minWidth: 680 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={stickyFirst}>{t("quality.person")}</TableCell>
                <TableCell>{t("quality.asFirst")}</TableCell>
                <TableCell>{t("quality.asChecker")}</TableCell>
                <TableCell>{t("quality.weakest")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.people.map((person) => (
                <TableRow key={person.username} sx={{ verticalAlign: "top" }}>
                  <TableCell component="th" scope="row" sx={{ ...stickyFirst, wordBreak: "break-word" }}>
                    {person.username}
                  </TableCell>
                  <TableCell>
                    <RateBar rate={person.asFirst} />
                  </TableCell>
                  <TableCell>
                    <RateBar rate={person.asChecker} />
                  </TableCell>
                  <TableCell sx={{ minWidth: 160, wordBreak: "break-word" }}>
                    {person.weakest.length === 0
                      ? "–"
                      : person.weakest.map((w) => (
                          <Box key={w.key}>{t("quality.differingCount", { label: label(w.key), count: w.differing, total: w.compared })}</Box>
                        ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}

/** The width of an element, kept up to date (the chart is drawn at its real size, so its text stays readable on a phone). */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const CHART_HEIGHT = 200;

function WeekLineChart({ data }: { data: QualityData }) {
  const t = useT();
  const { language } = useApp();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const box = { width: Math.max(width, 200), height: CHART_HEIGHT, left: 44, right: 16, top: 12, bottom: 28 };
  const chart = weekChart(data.weeks, box);
  const weekName = (week: string) => t("quality.week", splitWeek(week));
  const pointText = (pt: WeekPoint) => weekText(t, pt, language);
  const count = chart.points.length;
  const shown = active !== null ? chart.points[active] : chart.points[count - 1];
  const first = chart.points[0];
  const last = chart.points[count - 1];
  // The hit area of each week: the band around it, wider than the dot.
  const band = count > 1 ? (box.width - box.left - box.right) / (count - 1) : box.width - box.left - box.right;
  const readout = useId();

  // One stop for the keyboard: the arrow keys move from week to week, Home and End to the ends.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const at = active ?? count - 1;
    const next =
      e.key === "ArrowLeft" || e.key === "ArrowDown"
        ? Math.max(0, at - 1)
        : e.key === "ArrowRight" || e.key === "ArrowUp"
          ? Math.min(count - 1, at + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? count - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <Box ref={ref} sx={{ width: "100%" }}>
      <Typography id={readout} variant="body2" sx={{ minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }} aria-live={active !== null ? "polite" : "off"}>
        {shown ? pointText(shown) : ""}
      </Typography>
      <Box
        role="group"
        tabIndex={0}
        aria-label={`${first && last ? t("quality.chartLabel", { from: weekName(first.week), to: weekName(last.week) }) : t("quality.weeksTitle")} ${t("quality.chartKeys")}`}
        aria-describedby={readout}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? count - 1)}
        onBlur={() => setActive(null)}
        sx={{
          width: "fit-content",
          maxWidth: "100%",
          borderRadius: 1,
          outline: "none",
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
        }}
      >
      {width > 0 && (
        <svg
          width={box.width}
          height={box.height}
          aria-hidden
          style={{ display: "block", overflow: "visible" }}
          onMouseLeave={() => setActive(null)}
        >
          {chart.ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={box.left} x2={box.width - box.right} y1={tick.y} y2={tick.y} stroke="#e0e0e0" strokeWidth={1} />
              <text x={box.left - 8} y={tick.y} dy="0.32em" textAnchor="end" fontSize={12} fill="rgba(0,0,0,0.6)">
                {formatRate(tick.value, language)}
              </text>
            </g>
          ))}
          {shown && active !== null && <line x1={shown.x} x2={shown.x} y1={box.top} y2={box.height - box.bottom} stroke="#bdbdbd" strokeWidth={1} />}
          {chart.path && <path d={chart.path} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {/* Lines touching a week of few checks: dashed, as that week's share can swing a lot. */}
          {chart.fewPath && <path d={chart.fewPath} fill="none" stroke={MARK} strokeWidth={2} strokeDasharray="4 4" strokeLinecap="butt" />}
          {chart.points.map((pt, i) =>
            pt.few ? (
              // Few checks: a hollow dot.
              <circle key={pt.week} cx={pt.x} cy={pt.y} r={active === i ? 5 : 4} fill="#fff" stroke={MARK} strokeWidth={2} />
            ) : (
              <circle key={pt.week} cx={pt.x} cy={pt.y} r={active === i ? 5 : 4} fill={MARK} stroke="#fff" strokeWidth={2} />
            ),
          )}
          {first && (
            <text x={first.x} y={box.height - 8} textAnchor={chart.points.length === 1 ? "middle" : "start"} fontSize={12} fill="rgba(0,0,0,0.6)">
              {weekName(first.week)}
            </text>
          )}
          {last && last !== first && (
            <text x={last.x} y={box.height - 8} textAnchor="end" fontSize={12} fill="rgba(0,0,0,0.6)">
              {weekName(last.week)}
            </text>
          )}
          {chart.points.map((pt, i) => (
            <rect
              key={`hit-${pt.week}`}
              x={pt.x - band / 2}
              y={box.top}
              width={Math.max(band, 24)}
              height={box.height - box.top - box.bottom}
              fill="transparent"
              onMouseEnter={() => setActive(i)}
            />
          ))}
        </svg>
      )}
      </Box>
    </Box>
  );
}
function Weeks({ data }: { data: QualityData }) {
  const t = useT();
  const { language } = useApp();
  const [view, setView] = useState<"chart" | "table">("chart");
  const weeks = [...data.weeks].filter((w) => w.compared > 0).sort((a, b) => (a.week < b.week ? -1 : 1));
  return (
    <Section title={t("quality.weeksTitle")} explain={t("quality.weeksExplain")}>
      {weeks.length === 0 ? (
        <Alert severity="info">{t("quality.noWeeks")}</Alert>
      ) : (
        <>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label={t("quality.weeksTitle")}>
            <ToggleButton value="chart">{t("quality.showChart")}</ToggleButton>
            <ToggleButton value="table">{t("quality.showTable")}</ToggleButton>
          </ToggleButtonGroup>
          {view === "chart" ? (
            <WeekLineChart data={data} />
          ) : (
            <TableContainer sx={tableFrame}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t("quality.weekColumn")}</TableCell>
                    <TableCell>{t("quality.agreement")}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {weeks.map((w) => (
                    <TableRow key={w.week}>
                      <TableCell component="th" scope="row" sx={{ whiteSpace: "nowrap" }}>
                        {t("quality.week", splitWeek(w.week))}
                      </TableCell>
                      <TableCell sx={{ fontVariantNumeric: "tabular-nums" }}>
                        {weekRateText(t, w, language)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </Section>
  );
}

function Problems({ data }: { data: QualityData }) {
  const t = useT();
  const { language } = useApp();
  const count = data.problemsTotal;
  return (
    // In a Box: the page's Stack spacing does not reach an Accordion's own margins.
    <Box>
      <Accordion
        variant="outlined"
        disableGutters
        // The heading around the summary's button is the section's h2 (an h3 by default), level with the others.
        slotProps={{ heading: { component: "h2" } }}
        sx={{ borderRadius: 1, "&::before": { display: "none" } }}
      >
        <AccordionSummary expandIcon={<ExpandMore />} aria-controls="quality-problems" id="quality-problems-title" sx={{ px: { xs: 2, sm: 3 }, py: 1 }}>
          <Typography variant="h2" component="span">
            {t("quality.problemsTitle", { count: formatNumber(count, language) })}
          </Typography>
        </AccordionSummary>
        <AccordionDetails id="quality-problems" sx={{ px: { xs: 2, sm: 3 }, pb: 3 }}>
          <Stack spacing={1.5}>
            <Typography color="text.secondary">{t("quality.problemsExplain")}</Typography>
            {count === 0 && <Typography>{t("quality.noProblems")}</Typography>}
            {data.problems.length > 0 && (
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {data.problems.map((pr, i) => (
                  <Box component="li" key={`${pr.kind}:${pr.recordKey}:${pr.operator}:${i}`} sx={{ wordBreak: "break-word", mb: 0.5 }}>
                    {t(problemMessageKey(pr.kind), { plot: pr.plot, name: pr.operator })}
                  </Box>
                ))}
              </Box>
            )}
            {data.problems.length < count && (
              <Typography variant="body2" color="text.secondary">
                {t("quality.problemsMore", { count: formatNumber(data.problems.length, language), total: formatNumber(count, language) })}
              </Typography>
            )}
            {data.beyondOutline.count > 0 && <Alert severity="info">{t("quality.beyond", { count: formatNumber(data.beyondOutline.count, language) })}</Alert>}
          </Stack>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}

/**
 * The Quality tab (coordinators): how often the checks agree with the first
 * assessments, by question, person and week; the mixed-up answers; each difference to
 * decide; guidance notes for collectors; and records that could not be compared.
 */
export function QualityTab({ projectId }: { projectId: string }) {
  const t = useT();
  // A load that started before a decision, a note or margins were saved here keeps those as saved.
  const quality = useLoad(() => getQuality(projectId), [projectId], { merge: keepLocalChanges });
  const { data, error, loading, reload, setData } = quality;
  const [note, setNote] = useState<NoteDraft | null>(null);
  /** A plot to show in the differences list (from the assistant's links); `at` makes each click a new one. */
  const [focus, setFocus] = useState<PlotFocus | null>(null);
  const busy = error instanceof ApiError && error.code === "busy";
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  /** Answers in a row that were stale or busy: the wait before asking again grows with them. */
  const rounds = useRef(0);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  /** When the last answer came (figures or an error), and whether it was stale or busy: for asking again when shown. */
  const lastLoad = useRef({ at: 0, stale: false, busy: false });
  useEffect(() => {
    if (!loading) lastLoad.current = { at: Date.now(), stale: data?.stale === true, busy };
  }, [loading, data?.stale, busy]);

  // Nothing is asked while the page is hidden. Shown again, it asks at once when the
  // figures were stale or busy, or the last answer is over a minute old (not at every
  // switch between tabs).
  useEffect(() => {
    const changed = () => {
      const nowHidden = document.visibilityState === "hidden";
      setHidden(nowHidden);
      const last = lastLoad.current;
      if (!nowHidden && !loadingRef.current && reloadOnShow({ stale: last.stale, busy: last.busy, sinceLoad: Date.now() - last.at })) reload();
    };
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, [reload]);

  // Stale figures (newer ones are being worked out) or busy: ask again, less often the
  // longer it lasts. The server's CPU only runs during requests, so this asking is also
  // what lets the newer figures be worked out. Not after any other error.
  useEffect(() => {
    if (loading) return;
    const failed = error !== null && !busy;
    const delay = pollDelay({ stale: data?.stale === true, busy, failed, hidden, round: rounds.current });
    if (delay === null) {
      if (!hidden && !failed) rounds.current = 0;
      return;
    }
    const id = window.setTimeout(() => {
      rounds.current += 1;
      reload();
    }, delay);
    return () => window.clearTimeout(id);
  }, [data?.stale, error, busy, loading, hidden, reload]);

  if (!data) {
    if (loading) return <Loading />;
    return busy ? (
      <Alert
        severity="info"
        role="status"
        action={
          <Button color="inherit" size="small" onClick={reload}>
            {t("common.retry")}
          </Button>
        }
      >
        {t("quality.busy")}
      </Alert>
    ) : (
      <ErrorAlert error={error} onRetry={reload} />
    );
  }

  // Changes made here apply to the data as it is when they land (not as it was when they
  // started), so a load or another change in between is not undone.
  const update = (change: (prev: QualityData) => Partial<QualityData>) => setData((prev) => ({ ...prev, ...change(prev) }));
  const savedNote = (saved: GuidanceNote) => update((prev) => ({ notes: withNote(prev.notes, saved) }));

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button variant="outlined" size="small" {...linkProps(pathFor({ name: "teamReport", projectId }))}>
          {t("teamReport.link")}
        </Button>
        <Button variant="outlined" size="small" {...linkProps(pathFor({ name: "myQuality", projectId }))}>
          {t("myQuality.link")}
        </Button>
      </Stack>
      <Counts data={data} stillWorking={busy} />
      {error !== null && !busy && <ErrorAlert error={error} onRetry={reload} />}
      <ReviewQueue
        projectId={projectId}
        canBulk
        onDecision={(plot, decision) => update((prev) => ({ decisions: withDecision(prev.decisions, plot, decision) }))}
        onBulk={reload}
      />
      <QualityChecks projectId={projectId} />
      <QualityReference projectId={projectId} canEdit />
      {data.plotsChecked > 0 && (
        <>
          <Questions projectId={projectId} data={data} onMargins={(margins) => (update(() => ({ margins })), reload())} />
          <Confusions data={data} onWriteNote={setNote} />
          <People data={data} />
          <Weeks data={data} />
          <QualityDifferences
            projectId={projectId}
            data={data}
            focus={focus}
            onDecision={(plot, decision) => update((prev) => ({ decisions: withDecision(prev.decisions, plot, decision) }))}
          />
        </>
      )}
      <QualityFlags projectId={projectId} canEdit />
      <QualityAnswers projectId={projectId} />
      <QualitySurvey projectId={projectId} />
      <QualityNotes
        projectId={projectId}
        data={data}
        onEdit={setNote}
        onDeleted={(id) => update((prev) => ({ notes: prev.notes.filter((n) => n.id !== id) }))}
      />
      <Problems data={data} />
      <QualityAssistant projectId={projectId} data={data} onWriteNote={setNote} onShowPlot={(plot) => setFocus({ plot, at: Date.now() })} />
      {note && (
        <NoteDialog projectId={projectId} data={data} draft={note} onClose={() => setNote(null)} onSaved={(saved) => (savedNote(saved), setNote(null))} />
      )}
    </Stack>
  );
}
