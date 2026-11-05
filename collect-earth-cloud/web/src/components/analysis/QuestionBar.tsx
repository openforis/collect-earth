import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import AlignHorizontalLeft from "@mui/icons-material/AlignHorizontalLeft";
import BarChart from "@mui/icons-material/BarChart";
import DonutLarge from "@mui/icons-material/DonutLarge";
import GridOn from "@mui/icons-material/GridOn";
import ShowChart from "@mui/icons-material/ShowChart";
import StackedLineChart from "@mui/icons-material/StackedLineChart";
import SwapHoriz from "@mui/icons-material/SwapHoriz";
import TableChart from "@mui/icons-material/TableChart";
import ViewQuilt from "@mui/icons-material/ViewQuilt";
import type { ReactNode } from "react";
import { CHARTS, swapAxes, type Measure, type Question } from "../../analysisQuestion";
import type { ColumnGroup, Cube, CubeColumn } from "../../analysisView";
import { useT, type MessageKey } from "../../i18n";

const CHART_ICONS: Record<string, ReactNode> = {
  Datagrid: <TableChart fontSize="small" />,
  "Y Bar": <BarChart fontSize="small" />,
  "X Bar": <AlignHorizontalLeft fontSize="small" />,
  "Y Line": <ShowChart fontSize="small" />,
  "Y Area": <StackedLineChart fontSize="small" />,
  Treemap: <ViewQuilt fontSize="small" />,
  Sunburst: <DonutLarge fontSize="small" />,
  Heatmap: <GridOn fontSize="small" />,
};

const GROUP_KEYS: Record<ColumnGroup, MessageKey> = {
  entity: "analysis.group.entity",
  survey: "analysis.group.survey",
  plotFile: "analysis.group.plotFile",
  collection: "analysis.group.collection",
  area: "analysis.group.area",
};
/** The order of the groups in the lists: the answers first, as they are what is analysed. */
const GROUP_ORDER: ColumnGroup[] = ["entity", "survey", "plotFile", "collection", "area"];
const MEASURE_KEYS: Record<Measure["group"], MessageKey> = { plots: "analysis.mgroup.plots", area: "analysis.mgroup.area", answers: "analysis.mgroup.answers" };

/** The fields to put in the rows or the columns, in groups (the survey's questions, the plot file's, the collection's). */
export function fieldOptions(cube: Cube): CubeColumn[] {
  return [...cube.columns].filter((c) => c.group !== "area").sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
}

/**
 * The question bar: "Show <measures> by <rows> and <columns>, as <table or chart>", with the order of the rows and a
 * button that swaps rows and columns. Every list is searchable and grouped, so a survey of a hundred questions stays
 * easy to go through.
 */
export function QuestionBar({ cube, measures, question, onChange, disabled }: { cube: Cube; measures: Measure[]; question: Question; onChange: (q: Question) => void; disabled?: boolean }) {
  const t = useT();
  const fields = fieldOptions(cube);
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  const measureById = new Map(measures.map((m) => [m.id, m]));
  const set = (patch: Partial<Question>) => onChange({ ...question, ...patch });
  // A field is in the rows or in the columns, not in both
  const used = new Set([...question.rows, ...question.columns]);
  const chips = (values: readonly string[], getTagProps: (o: { index: number }) => Record<string, unknown>, label: (v: string) => string) =>
    values.map((v, index) => {
      const { key, ...props } = getTagProps({ index }) as { key: string } & Record<string, unknown>;
      return <Chip key={key} size="small" label={label(v)} {...props} />;
    });
  const fieldPicker = (which: "rows" | "columns", label: string, placeholder: string) => (
    <Autocomplete
      multiple
      size="small"
      disabled={disabled}
      options={fields.map((f) => f.name).filter((n) => !used.has(n) || question[which].includes(n))}
      groupBy={(n) => t(GROUP_KEYS[fieldByName.get(n)?.group ?? "survey"])}
      value={question[which]}
      onChange={(_, v) => set({ [which]: v } as Partial<Question>)}
      filterSelectedOptions
      renderValue={(values, getItemProps) => chips(values, getItemProps, (v) => v)}
      renderInput={(params) => <TextField {...params} label={label} placeholder={question[which].length ? "" : placeholder} />}
      sx={{ flex: "1 1 260px", minWidth: 220 }}
    />
  );
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "flex-start" }} role="group" aria-label={t("analysis.q.label")}>
      <Autocomplete
        multiple
        size="small"
        disabled={disabled}
        options={measures.map((m) => m.id)}
        groupBy={(id) => t(MEASURE_KEYS[measureById.get(id)?.group ?? "plots"])}
        getOptionLabel={(id) => measureById.get(id)?.label ?? id}
        value={question.measures.filter((id) => measureById.has(id))}
        onChange={(_, v) => set({ measures: v })}
        filterSelectedOptions
        renderValue={(values, getItemProps) => chips(values, getItemProps, (id) => measureById.get(id)?.label ?? id)}
        renderInput={(params) => <TextField {...params} label={t("analysis.q.show")} placeholder={question.measures.length ? "" : t("analysis.q.showHint")} />}
        sx={{ flex: "1 1 260px", minWidth: 220 }}
      />
      {fieldPicker("rows", t("analysis.q.rows"), t("analysis.q.rowsHint"))}
      <Tooltip title={t("analysis.q.swap")}>
        <span>
          <IconButton aria-label={t("analysis.q.swap")} onClick={() => onChange(swapAxes(question))} disabled={disabled || (!question.rows.length && !question.columns.length)} sx={{ mt: 0.5 }}>
            <SwapHoriz />
          </IconButton>
        </span>
      </Tooltip>
      {fieldPicker("columns", t("analysis.q.columns"), t("analysis.q.columnsHint"))}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center", flex: "1 1 100%" }}>
        <ToggleButtonGroup size="small" exclusive value={question.chart} onChange={(_, v: string | null) => v && set({ chart: v })} aria-label={t("analysis.q.as")} disabled={disabled}>
          {CHARTS.map((c) => (
            <Tooltip key={c.id} title={t(c.key)}>
              <ToggleButton value={c.id} aria-label={t(c.key)}>
                {CHART_ICONS[c.id]}
              </ToggleButton>
            </Tooltip>
          ))}
        </ToggleButtonGroup>
        <TextField select size="small" label={t("analysis.q.order")} value={question.order} onChange={(e) => set({ order: e.target.value as Question["order"] })} disabled={disabled || !question.measures.length} sx={{ width: 220 }}>
          <MenuItem value="name">{t("analysis.q.orderName")}</MenuItem>
          <MenuItem value="desc">{t("analysis.q.orderDesc")}</MenuItem>
          <MenuItem value="asc">{t("analysis.q.orderAsc")}</MenuItem>
        </TextField>
      </Box>
    </Box>
  );
}
