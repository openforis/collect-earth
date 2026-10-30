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
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ApiError, getQuality, saveQualityMargins, type GuidanceNote, type QualityData, type Rate } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { barPercent, formatRate, labelMap, marginRows, parseMargin, problemMessageKey, rateText, splitWeek, weekChart, type WeekPoint } from "../qualityView";
import { useLoad } from "../useLoad";
import { QualityDifferences } from "./QualityDifferences";
import { NoteDialog, QualityNotes, type NoteDraft } from "./QualityNotes";

/**
 * The agreement colour: one series everywhere, so one hue. A step of the dashboard's
 * green with enough chroma for a mark (the theme's #2e6b3f reads grey as a bar), and a
 * light step of the same hue for the bar's track.
 */
export const MARK = "#2f7d4a";
const TRACK = "#dcebe0";

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" } as const;

/** Re-fetch figures given as stale after this long, and after a "busy" answer after Retry-After. */
const STALE_RETRY_MS = 5_000;
const BUSY_RETRY_MS = 10_000;

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

function Counts({ data }: { data: QualityData }) {
  const t = useT();
  const { language } = useApp();
  return (
    <Section title={t("quality.title")} explain={t("quality.explain")}>
      {data.stale && data.computedAt !== null && (
        <Alert severity="info" role="status">
          {t("quality.stale", { time: formatDate(data.computedAt, language) })}
        </Alert>
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
      // Every margin shown is sent: the server replaces the whole set.
      const margins = Object.fromEntries(parsed.map((p) => [p.row.key, p.value as number]));
      onSaved(await saveQualityMargins(projectId, margins));
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

/** An answer as shown: "(no answer)" for a blank one. */
function Answer({ value }: { value: string }) {
  const t = useT();
  return value ? (
    <>{value}</>
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
                {rows.map((c) => {
                  const id = `${c.first}\u0000${c.check}`;
                  const note = noteFor(c.first, c.check);
                  return (
                    <TableRow key={id} sx={{ verticalAlign: "top" }}>
                      <TableCell sx={{ wordBreak: "break-word" }}>
                        <Answer value={c.first} />
                      </TableCell>
                      <TableCell sx={{ wordBreak: "break-word" }}>
                        <Answer value={c.check} />
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
                            onClick={() =>
                              onWriteNote(note ? { ...note } : { questionKey: c.key, firstValue: c.first || null, checkValue: c.check || null, text: "" })
                            }
                          >
                            {note ? t("quality.editNote") : t("quality.writeNote")}
                          </Button>
                        </Stack>
                        {open === id && (
                          <Typography variant="body2" sx={{ mt: 1, wordBreak: "break-word" }}>
                            {t("quality.plotsList", { plots: c.plots.join(", ") })}
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
                <TableCell>{t("quality.person")}</TableCell>
                <TableCell>{t("quality.asFirst")}</TableCell>
                <TableCell>{t("quality.asChecker")}</TableCell>
                <TableCell>{t("quality.weakest")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.people.map((person) => (
                <TableRow key={person.username} sx={{ verticalAlign: "top" }}>
                  <TableCell component="th" scope="row" sx={{ wordBreak: "break-word" }}>
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
  const pointText = (pt: WeekPoint) => `${weekName(pt.week)}: ${rateText(t, { compared: pt.compared, agreeing: pt.agreeing, rate: pt.rate }, language)}`;
  const shown = active !== null ? chart.points[active] : chart.points[chart.points.length - 1];
  const first = chart.points[0];
  const last = chart.points[chart.points.length - 1];
  // The hit area of each week: the band around it, wider than the dot.
  const band = chart.points.length > 1 ? (box.width - box.left - box.right) / (chart.points.length - 1) : box.width - box.left - box.right;

  return (
    <Box ref={ref} sx={{ width: "100%" }}>
      <Typography variant="body2" sx={{ minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }} aria-live="polite">
        {shown ? pointText(shown) : ""}
      </Typography>
      {width > 0 && (
        <svg
          width={box.width}
          height={box.height}
          role="img"
          aria-label={first && last ? t("quality.chartLabel", { from: weekName(first.week), to: weekName(last.week) }) : t("quality.weeksTitle")}
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
          <path d={chart.path} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {chart.points.map((pt, i) => (
            <circle key={pt.week} cx={pt.x} cy={pt.y} r={active === i ? 5 : 4} fill={MARK} stroke="#fff" strokeWidth={2} />
          ))}
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
              tabIndex={0}
              aria-label={pointText(pt)}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              style={{ outline: "none" }}
            />
          ))}
        </svg>
      )}
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
                        {rateText(t, { compared: w.compared, agreeing: w.agreeing, rate: w.agreeing / w.compared }, language)}
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
      <Accordion variant="outlined" disableGutters sx={{ borderRadius: 1, "&::before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMore />} aria-controls="quality-problems" id="quality-problems-title" sx={{ px: { xs: 2, sm: 3 }, py: 1 }}>
          <Typography variant="h2">{t("quality.problemsTitle", { count: formatNumber(count, language) })}</Typography>
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
  const quality = useLoad(() => getQuality(projectId), [projectId]);
  const { data, error, loading, reload } = quality;
  const [note, setNote] = useState<NoteDraft | null>(null);
  const busy = error instanceof ApiError && error.code === "busy";

  // Stale figures: newer ones are being worked out, so ask again in a moment. Busy: after Retry-After.
  useEffect(() => {
    if (loading || !(data?.stale || busy)) return;
    const id = window.setTimeout(reload, busy ? BUSY_RETRY_MS : STALE_RETRY_MS);
    return () => window.clearTimeout(id);
  }, [data, busy, loading, reload]);

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

  const update = (patch: Partial<QualityData>) => quality.setData({ ...data, ...patch });
  const savedNote = (saved: GuidanceNote) => {
    const others = data.notes.filter((n) => n.id !== saved.id);
    // In the server's order: by question, then the pair.
    const order = (n: GuidanceNote) => [n.questionKey, n.firstValue ?? "", n.checkValue ?? ""].join("\u0000");
    update({ notes: [...others, saved].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0)) });
  };

  return (
    <Stack spacing={3}>
      <Counts data={data} />
      {error !== null && !busy && <ErrorAlert error={error} onRetry={reload} />}
      {data.plotsChecked > 0 && (
        <>
          <Questions projectId={projectId} data={data} onMargins={(margins) => (update({ margins }), reload())} />
          <Confusions data={data} onWriteNote={setNote} />
          <People data={data} />
          <Weeks data={data} />
          <QualityDifferences projectId={projectId} data={data} onDecisions={(decisions) => update({ decisions })} />
        </>
      )}
      <QualityNotes projectId={projectId} data={data} onEdit={setNote} onDeleted={(id) => update({ notes: data.notes.filter((n) => n.id !== id) })} />
      <Problems data={data} />
      {/* Task 18: the AI assistant's section goes here. */}
      {note && (
        <NoteDialog projectId={projectId} data={data} draft={note} onClose={() => setNote(null)} onSaved={(saved) => (savedNote(saved), setNote(null))} />
      )}
    </Stack>
  );
}
