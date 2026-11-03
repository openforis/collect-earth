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
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  ApiError,
  getAnswerColumns,
  getAnswers,
  NO_ANSWERS_FILTER,
  type AnswersData,
  type AnswersFilter,
  type ChoiceAnswers,
  type NumberAnswers,
  type NumberSpread,
} from "../api";
import { useApp } from "../appContext";
import {
  answerLabel,
  answerQuestions,
  answersRefused,
  chanceText,
  choiceRows,
  datesInOrder,
  flagText,
  hasFilter,
  numberText,
  percent,
  restOfTeam,
  shownQuestion,
  spreadScale,
  spreadText,
  type ChoiceRow,
} from "../answersView";
import { ChartOrTable, stepKey } from "../components/PeopleCharts";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate, formatNumber } from "../format";
import { useT } from "../i18n";
import { browserTimeZone } from "../progressView";
import { useLoad } from "../useLoad";

/**
 * The two series of these charts: the team (or the rest of it) and one person. Checked
 * with the dataviz validator against the page's surface (lightness, chroma, colour-blind
 * and normal-vision separation, 3:1 contrast). The dashboard has no dark theme yet.
 */
const TEAM = "#2a6fb0";
const PERSON = "#2f7d4a";

/** Flags shown before "Show all". */
const FLAGS_SHOWN = 8;

/** Tables fit a phone: they scroll inside their own frame. */
const tableFrame = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto", maxHeight: 420 } as const;

function Swatch({ color }: { color: string }) {
  return <Box component="span" aria-hidden sx={{ display: "inline-block", width: 12, height: 12, borderRadius: "3px", bgcolor: color, mr: 0.75, verticalAlign: "-1px" }} />;
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
      {items.map((i) => (
        <Typography key={i.label} variant="body2" color="text.secondary">
          <Swatch color={i.color} />
          {i.label}
        </Typography>
      ))}
    </Stack>
  );
}

/**
 * Rows of horizontal bars (one or two per row), keyboard and pointer readable: the group
 * takes the focus, arrow keys / Home / End step through the rows, and the readout above
 * says the row's figures (announced only while the chart has the keyboard).
 */
function BarRows({
  rows,
  ariaLabel,
}: {
  rows: { label: string; bars: { color: string; value: number; text: string }[]; readout: string }[];
  ariaLabel: string;
}) {
  const theme = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const readout = useId();
  const max = Math.max(1e-9, ...rows.flatMap((r) => r.bars.map((b) => b.value)));
  const thick = rows[0]?.bars.length > 1 ? 10 : 14;
  return (
    <Box>
      <Typography id={readout} variant="body2" sx={{ minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }} aria-live={active !== null ? "polite" : "off"}>
        {active !== null ? rows[active]?.readout : ""}
      </Typography>
      <Box
        role="group"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-describedby={readout}
        onFocus={() => {
          setActive((a) => a ?? 0);
        }}
        onBlur={() => {
          setActive(null);
        }}
        onKeyDown={(e) => {
          const next = stepKey(e, active ?? 0, rows.length);
          if (next === null) return;
          e.preventDefault();
          setActive(next);
        }}
        onMouseLeave={() => setActive(null)}
        sx={{ borderRadius: 1, outline: "none", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
      >
        {rows.map((row, i) => (
          <Box
            key={row.label + i}
            onMouseEnter={() => setActive(i)}
            title={row.readout}
            sx={{ py: 0.75, px: 0.5, borderRadius: 1, bgcolor: active === i ? "action.hover" : "transparent" }}
          >
            <Typography variant="body2" sx={{ mb: 0.25, wordBreak: "break-word" }}>
              {row.label}
            </Typography>
            {row.bars.map((bar, j) => (
              <Box key={j} sx={{ display: "flex", alignItems: "center", gap: 1, mt: j > 0 ? "2px" : 0 }}>
                <Box sx={{ flex: 1, minWidth: 0, borderLeft: `1px solid ${theme.palette.divider}` }}>
                  <Box
                    sx={{
                      width: `${Math.max(0, (bar.value / max) * 100)}%`,
                      minWidth: bar.value > 0 ? "2px" : 0,
                      height: thick,
                      bgcolor: bar.color,
                      // Square at the baseline, rounded at the data end.
                      borderRadius: "0 4px 4px 0",
                    }}
                  />
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ width: "4.2em", textAlign: "right", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                  {bar.text}
                </Typography>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ChoiceView({ choice, person, narrowed }: { choice: ChoiceAnswers; person: string | null; narrowed: boolean }) {
  const t = useT();
  const { language } = useApp();
  const rows = choiceRows(choice, person);
  const rest = restOfTeam(choice, person);
  // A side with no answer to the question says so instead of drawing 0 % bars.
  const pct = (share: number | null) => (share === null ? t("answers.noAnswers") : percent(share, language));
  const compared = rows.length > 0 && rows[0].person !== null;
  const label = (r: ChoiceRow) => answerLabel(t, choice.key, r.code, r.label);
  const mine = person === null ? undefined : choice.people.find((p) => p.username === person);
  const chartRows = rows.map((r) => ({
    label: label(r),
    bars: compared
      ? [
          { color: PERSON, value: r.person!.share ?? 0, text: pct(r.person!.share) },
          { color: TEAM, value: r.rest!.share ?? 0, text: pct(r.rest!.share) },
        ]
      : [{ color: TEAM, value: r.share, text: percent(r.share, language) }],
    readout: compared
      ? t("answers.readoutPerson", {
          answer: label(r),
          person: person!,
          share: pct(r.person!.share),
          count: formatNumber(r.person!.count, language),
          team: pct(r.rest!.share),
          teamCount: formatNumber(r.rest!.count, language),
        })
      : t("answers.readoutTeam", { answer: label(r), share: percent(r.share, language), count: formatNumber(r.count, language) }),
  }));
  const cell = (count: number, of: number) => (of > 0 ? `${percent(count / of, language)} (${formatNumber(count, language)})` : t("answers.noAnswers"));
  const table = (
    <TableContainer sx={tableFrame}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>{t("answers.personColumn")}</TableCell>
            <TableCell align="right">{t("answers.answeredColumn")}</TableCell>
            {rows.map((r) => (
              <TableCell key={r.code} align="right">
                {label(r)}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
              {t("answers.team")}
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatNumber(choice.answered, language)}
            </TableCell>
            {rows.map((r) => (
              <TableCell key={r.code} align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {cell(r.count, choice.answered)}
              </TableCell>
            ))}
          </TableRow>
          {rest && (
            <TableRow>
              <TableCell component="th" scope="row" sx={{ fontWeight: 500 }}>
                {t("answers.restOfTeam")}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(rest.answered, language)}
              </TableCell>
              {rows.map((r, i) => (
                <TableCell key={r.code} align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {cell(rest.counts[i] ?? 0, rest.answered)}
                </TableCell>
              ))}
            </TableRow>
          )}
          {choice.people.map((p) => (
            <TableRow key={p.username}>
              <TableCell component="th" scope="row">
                {p.username}
              </TableCell>
              <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(p.answered, language)}
              </TableCell>
              {rows.map((r, i) => (
                <TableCell key={r.code} align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {cell(p.counts[i] ?? 0, p.answered)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {compared && mine
          ? t("answers.choiceExplainPerson", { person: person!, plots: formatNumber(mine.answered, language), team: formatNumber(choice.answered - mine.answered, language) })
          : t("answers.choiceExplain", { plots: formatNumber(choice.answered, language) })}
        {choice.blank > 0 ? ` ${t(narrowed ? (choice.blank === 1 ? "answers.blankFilteredOne" : "answers.blankFiltered") : choice.blank === 1 ? "answers.blankOne" : "answers.blank", { n: formatNumber(choice.blank, language) })}` : ""}
        {choice.multiple ? ` ${t("answers.multiple")}` : ""}
      </Typography>
      {compared && (
        <Legend
          items={[
            { color: PERSON, label: person! },
            { color: TEAM, label: t("answers.restOfTeam") },
          ]}
        />
      )}
      <ChartOrTable label={t("answers.viewOf", { question: choice.label })} chart={<BarRows rows={chartRows} ariaLabel={t("answers.chartOf", { question: choice.label })} />} table={table} />
    </Stack>
  );
}

/** One row of the number chart: the middle half of the values as a bar, the median as a mark across it. */
function SpreadRow({ label, s, color, scale, active, onEnter, readout }: { label: string; s: NumberSpread; color: string; scale: { min: number; max: number }; active: boolean; onEnter: () => void; readout: string }) {
  const theme = useTheme();
  const at = (v: number) => ((v - scale.min) / (scale.max - scale.min)) * 100;
  return (
    <Box onMouseEnter={onEnter} title={readout} sx={{ py: 0.75, px: 0.5, borderRadius: 1, bgcolor: active ? "action.hover" : "transparent" }}>
      <Typography variant="body2" sx={{ mb: 0.25, wordBreak: "break-word" }}>
        {label}
      </Typography>
      <Box sx={{ position: "relative", height: 14, borderTop: 0, background: `linear-gradient(${theme.palette.divider}, ${theme.palette.divider}) center / 100% 1px no-repeat` }}>
        {s.q1 !== null && s.q3 !== null && s.median !== null && (
          <>
            <Box sx={{ position: "absolute", top: 0, bottom: 0, left: `${at(s.q1)}%`, width: `max(2px, ${at(s.q3) - at(s.q1)}%)`, bgcolor: color, borderRadius: "4px" }} />
            <Box sx={{ position: "absolute", top: -3, bottom: -3, left: `calc(${at(s.median)}% - 1px)`, width: "3px", bgcolor: "text.primary", borderRadius: "1px", boxShadow: `0 0 0 2px ${theme.palette.background.paper}` }} />
          </>
        )}
      </Box>
    </Box>
  );
}

function NumberView({ numbers, person }: { numbers: NumberAnswers; person: string | null }) {
  const t = useT();
  const { language } = useApp();
  const scale = spreadScale(numbers);
  const [active, setActive] = useState<number | null>(null);
  const readoutId = useId();
  const rows = [{ label: t("answers.team"), s: numbers.team, color: TEAM }, ...numbers.people.map((p) => ({ label: p.username, s: p as NumberSpread, color: PERSON }))];
  const readout = (r: (typeof rows)[number]) =>
    `${r.label}: ${spreadText(t, r.s, language)}${r.s.nonNumeric > 0 ? ` · ${t("answers.nonNumeric", { n: formatNumber(r.s.nonNumeric, language) })}` : ""}`;
  const chart = (
    <Box>
      <Typography id={readoutId} variant="body2" sx={{ minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }} aria-live={active !== null ? "polite" : "off"}>
        {active !== null && rows[active] ? readout(rows[active]) : ""}
      </Typography>
      <Box
        role="group"
        tabIndex={0}
        aria-label={t("answers.chartOf", { question: numbers.label })}
        aria-describedby={readoutId}
        onFocus={() => {
          setActive((a) => a ?? 0);
        }}
        onBlur={() => {
          setActive(null);
        }}
        onKeyDown={(e) => {
          const next = stepKey(e, active ?? 0, rows.length);
          if (next === null) return;
          e.preventDefault();
          setActive(next);
        }}
        onMouseLeave={() => setActive(null)}
        sx={{ borderRadius: 1, outline: "none", "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 } }}
      >
        {rows.map((r, i) => (
          <SpreadRow key={r.label + i} label={r.label} s={r.s} color={r.color} scale={scale} active={active === i} onEnter={() => setActive(i)} readout={readout(r)} />
        ))}
        <Box sx={{ display: "flex", justifyContent: "space-between", px: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {numberText(scale.min, language)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {numberText(scale.max, language)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
  const table = (
    <TableContainer sx={tableFrame}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>{t("answers.personColumn")}</TableCell>
            <TableCell align="right">{t("answers.valuesColumn")}</TableCell>
            <TableCell align="right">{t("answers.medianColumn")}</TableCell>
            <TableCell align="right">{t("answers.q1Column")}</TableCell>
            <TableCell align="right">{t("answers.q3Column")}</TableCell>
            <TableCell align="right">{t("answers.nonNumericColumn")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.label + i}>
              <TableCell component="th" scope="row" sx={{ fontWeight: i === 0 ? 500 : undefined }}>
                {r.label}
              </TableCell>
              {[formatNumber(r.s.values, language), numberText(r.s.median, language), numberText(r.s.q1, language), numberText(r.s.q3, language), formatNumber(r.s.nonNumeric, language)].map((v, j) => (
                <TableCell key={j} align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {v}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
  return (
    <Stack spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {t("answers.numberExplain")}
        {numbers.team.nonNumeric > 0 ? ` ${t("answers.nonNumericTeam", { n: formatNumber(numbers.team.nonNumeric, language) })}` : ""}
      </Typography>
      <Legend
        items={[
          { color: TEAM, label: t("answers.team") },
          { color: PERSON, label: person ?? t("answers.eachPerson") },
        ]}
      />
      <ChartOrTable label={t("answers.viewOf", { question: numbers.label })} chart={chart} table={table} />
    </Stack>
  );
}

function SelectField({ label, value, onChange, children, minWidth = 180 }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; minWidth?: number }) {
  const id = useId();
  return (
    <FormControl size="small" sx={{ minWidth: { xs: "100%", sm: minWidth } }}>
      <InputLabel id={id}>{label}</InputLabel>
      <Select labelId={id} label={label} value={value} onChange={(e) => onChange(String(e.target.value))}>
        {children}
      </Select>
    </FormControl>
  );
}

const ALL = "__all__";
/** The days typed apply this long after the last change (or when the field is left). */
const DAYS_DELAY_MS = 600;

function Filters({
  projectId,
  data,
  filter,
  onChange,
  teamOnly,
}: {
  projectId: string;
  data: AnswersData | null;
  filter: AnswersFilter;
  onChange: (f: AnswersFilter) => void;
  teamOnly: boolean;
}) {
  const t = useT();
  const { language } = useApp();
  const columns = useLoad(() => (filter.file ? getAnswerColumns(projectId, filter.file) : Promise.resolve([])), [projectId, filter.file]);
  const people = data?.filters.people ?? (filter.person ? [filter.person] : []);
  const files = data?.filters.files ?? [];
  const column = columns.data?.find((c) => c.index === filter.column) ?? null;
  // The days as typed: applied DAYS_DELAY_MS after the last change or when the field is
  // left, and only when in order (the server refuses a first day after the last).
  const [days, setDays] = useState({ from: filter.from ?? "", to: filter.to ?? "" });
  useEffect(() => setDays({ from: filter.from ?? "", to: filter.to ?? "" }), [filter.from, filter.to]);
  const typedFrom = days.from || null;
  const typedTo = days.to || null;
  const inOrder = datesInOrder(typedFrom, typedTo);
  const applyDays = () => {
    if (inOrder && (typedFrom !== filter.from || typedTo !== filter.to)) onChange({ ...filter, from: typedFrom, to: typedTo });
  };
  useEffect(() => {
    if (typedFrom === filter.from && typedTo === filter.to) return;
    const id = window.setTimeout(applyDays, DAYS_DELAY_MS);
    return () => window.clearTimeout(id);
  });
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: { sm: "center" } }}>
      {!teamOnly && (
        <SelectField label={t("answers.filterPerson")} value={filter.person ?? ALL} onChange={(v) => onChange({ ...filter, person: v === ALL ? null : v })}>
          <MenuItem value={ALL}>{t("answers.everyone")}</MenuItem>
          {people.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </SelectField>
      )}
      <SelectField label={t("answers.filterFile")} value={filter.file ?? ALL} onChange={(v) => onChange({ ...filter, file: v === ALL ? null : v, column: null, value: null })}>
        <MenuItem value={ALL}>{t("answers.allFiles")}</MenuItem>
        {files.map((f) => (
          <MenuItem key={f.id} value={f.id}>
            {f.filename}
          </MenuItem>
        ))}
      </SelectField>
      {filter.file && (columns.data?.length ?? 0) > 0 && (
        <SelectField
          label={t("answers.filterColumn")}
          value={filter.column === null ? ALL : String(filter.column)}
          onChange={(v) => onChange({ ...filter, column: v === ALL ? null : Number(v), value: null })}
        >
          <MenuItem value={ALL}>{t("answers.anyColumn")}</MenuItem>
          {columns.data!.map((c) => (
            <MenuItem key={c.index} value={String(c.index)} disabled={c.values === null}>
              {(c.name || t("answers.columnNumber", { n: c.index + 1 })) + (c.values === null ? ` (${t("answers.tooManyValues", { n: formatNumber(c.distinctCount, language) })})` : "")}
            </MenuItem>
          ))}
        </SelectField>
      )}
      {column?.values && (
        <SelectField
          label={t("answers.filterValue")}
          value={filter.value === null ? ALL : `v:${filter.value}`}
          onChange={(v) => onChange({ ...filter, value: v === ALL ? null : v.slice(2) })}
        >
          <MenuItem value={ALL}>{t("answers.chooseValue")}</MenuItem>
          {column.values.map((v) => (
            <MenuItem key={v.value} value={`v:${v.value}`}>
              {(v.value || t("answers.emptyValue")) + ` (${formatNumber(v.count, language)})`}
            </MenuItem>
          ))}
        </SelectField>
      )}
      <TextField
        size="small"
        type="date"
        label={t("answers.from")}
        value={days.from}
        onChange={(e) => setDays((d) => ({ ...d, from: e.target.value }))}
        onBlur={applyDays}
        error={!inOrder}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 170 } }}
      />
      <TextField
        size="small"
        type="date"
        label={t("answers.to")}
        value={days.to}
        onChange={(e) => setDays((d) => ({ ...d, to: e.target.value }))}
        onBlur={applyDays}
        error={!inOrder}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 170 } }}
      />
      {(hasFilter(filter) || filter.column !== null || days.from !== "" || days.to !== "") && (
        <Button
          size="small"
          onClick={() => {
            setDays({ from: "", to: "" });
            onChange(NO_ANSWERS_FILTER);
          }}
        >
          {t("answers.clear")}
        </Button>
      )}
      {!inOrder && (
        <Typography variant="body2" color="error" role="alert" sx={{ flexBasis: "100%" }}>
          {t("answers.datesOrder")}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * The Quality tab's Answers section (coordinators and reviewers; never collectors, never
 * My work): how the first assessments answer each question, for the team and for each
 * person, with the shares far from the rest of the team listed as worth a look.
 * `teamOnly` (reviewers, Decision 10): the server gives them the team's figures only and
 * refuses a person, so there is no person filter and no list of people's answers worth a look.
 */
export function QualityAnswers({ projectId, teamOnly = false }: { projectId: string; teamOnly?: boolean }) {
  const t = useT();
  const { language } = useApp();
  const timeZone = browserTimeZone();
  const [filter, setFilter] = useState<AnswersFilter>(NO_ANSWERS_FILTER);
  const [chosen, setChosen] = useState<string | null>(null);
  const [allFlags, setAllFlags] = useState(false);
  // A column without its value yet asks for nothing new.
  const asked: AnswersFilter = filter.column !== null && filter.value === null ? { ...filter, column: null } : filter;
  const key = JSON.stringify(asked);
  const answers = useLoad(() => getAnswers(projectId, asked, timeZone), [projectId, key, timeZone]);
  const { data, error, loading, reload } = answers;
  const busy = error instanceof ApiError && error.code === "busy";
  // A reviewer's filter of fewer than 5 plots, or of one person's plots, is refused (403): the figures of the filter before are not shown under it.
  const refused = answersRefused(teamOnly, error);
  // Newer figures are being worked out (or the server is busy): ask again in a while.
  useEffect(() => {
    if (loading || !(data?.stale || busy)) return;
    const id = window.setTimeout(reload, busy ? 15_000 : 20_000);
    return () => window.clearTimeout(id);
  }, [loading, data?.stale, busy, reload]);

  const questions = data ? answerQuestions(data) : [];
  const shown = shownQuestion(questions, chosen);
  const choice = data?.choices.find((c) => c.key === shown) ?? null;
  const numbers = data?.numbers.find((n) => n.key === shown) ?? null;
  const flags = data ? (allFlags ? data.flags : data.flags.slice(0, FLAGS_SHOWN)) : [];
  // The person filter picks whose figures are shown; the plots counted stay the team's.
  const narrowed = filter.file !== null || filter.from !== null || filter.to !== null;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="answers-title">
      <Stack spacing={2}>
        <Typography variant="h2" id="answers-title">
          {t("answers.title")}
        </Typography>
        <Typography color="text.secondary">{t(teamOnly ? "answers.explainTeam" : "answers.explain")}</Typography>
        <Filters projectId={projectId} data={data} filter={filter} onChange={setFilter} teamOnly={teamOnly} />
        {!data && loading && <Loading />}
        {busy && (
          <Alert severity="info" role="status" action={<Button color="inherit" size="small" onClick={reload}>{t("common.retry")}</Button>}>
            {t("quality.busy")}
          </Alert>
        )}
        {/* A reviewer's filter must hold at least 5 plots (Decision 10): a smaller one is refused (403). */}
        {refused ? (
          <Alert
            severity="info"
            role="status"
            action={
              <Button color="inherit" size="small" onClick={() => setFilter(NO_ANSWERS_FILTER)}>
                {t("answers.clear")}
              </Button>
            }
          >
            {t("answers.tooFewPlots")}
          </Alert>
        ) : (
          error !== null && !busy && <ErrorAlert error={error} onRetry={reload} />
        )}
        {data && !refused && (
          <Box sx={{ opacity: loading ? 0.6 : 1, transition: "opacity 120ms" }} aria-busy={loading}>
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                {/* Only the count is announced, when it changes: the time after it changes at each reload. */}
                <span aria-live="polite">{t(narrowed ? "answers.countFiltered" : "answers.count", { n: formatNumber(data.plots, language) })}</span>
                {data.computedAt !== null && ` ${t(data.stale ? "answers.asOfStale" : "answers.asOf", { time: formatDate(data.computedAt, language) })}`}
              </Typography>
              {data.plots === 0 ? (
                <Typography>{t(narrowed ? "answers.noneFiltered" : "answers.none")}</Typography>
              ) : (
                <>
                  {!teamOnly && (
                  <Box>
                    <Typography variant="h3" sx={{ mb: 0.5 }}>
                      {t("answers.flagsTitle")}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {t("answers.flagsExplain")}
                    </Typography>
                    {data.tests > 0 && data.flagsTotal > 0 && (
                      <Typography variant="body2" sx={{ mb: 1 }}>
                        {t("answers.flagsCount", { n: formatNumber(data.flagsTotal, language), tests: formatNumber(data.tests, language) })} {chanceText(t, data.chanceFlags, language)}
                      </Typography>
                    )}
                    {data.flags.length === 0 ? (
                      <Typography variant="body2">{t("answers.noFlags")}</Typography>
                    ) : (
                      <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
                        {flags.map((f) => (
                          <Box component="li" key={`${f.key} ${f.username} ${f.code}`}>
                            <Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>
                              {f.label}
                            </Typography>
                            <Typography variant="body2" component="span">
                              {" — "}
                              {flagText(t, f, language)}{" "}
                            </Typography>
                            <Button
                              size="small"
                              sx={{ minWidth: 0, py: 0, verticalAlign: "baseline" }}
                              onClick={() => {
                                setChosen(f.key);
                                if (filter.person !== f.username) setFilter({ ...filter, person: f.username });
                              }}
                              aria-label={t("answers.showFlagFor", { question: f.label, person: f.username })}
                            >
                              {t("answers.showFlag")}
                            </Button>
                          </Box>
                        ))}
                      </Stack>
                    )}
                    {data.flags.length > FLAGS_SHOWN && (
                      <Button size="small" onClick={() => setAllFlags(!allFlags)} sx={{ mt: 0.5 }}>
                        {allFlags ? t("answers.fewerFlags") : t("answers.allFlags", { n: formatNumber(data.flagsTotal, language) })}
                      </Button>
                    )}
                    {allFlags && data.flagsTotal > data.flags.length && (
                      <Typography variant="body2" color="text.secondary">
                        {t("answers.flagsCapped", { n: formatNumber(data.flags.length, language) })}
                      </Typography>
                    )}
                  </Box>
                  )}
                  {questions.length > 0 && shown !== null && (
                    <Stack spacing={1.5}>
                      <SelectField label={t("answers.question")} value={shown} onChange={setChosen} minWidth={320}>
                        {questions.map((q) => (
                          <MenuItem key={q.key} value={q.key}>
                            {q.label}
                            {q.flags > 0 ? ` (${t("answers.questionFlags", { n: formatNumber(q.flags, language) })})` : ""}
                          </MenuItem>
                        ))}
                      </SelectField>
                      {choice && <ChoiceView choice={choice} person={data.person} narrowed={narrowed} />}
                      {numbers && <NumberView numbers={numbers} person={data.person} />}
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          </Box>
        )}
      </Stack>
    </Paper>
  );
}
