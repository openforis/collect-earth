import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { alpha } from "@mui/material/styles";
import { useState, type ReactNode } from "react";
import { downloadRepeatChangeAreas, type AreaEstimate, type RepeatChange } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { Explain } from "../components/Explain";
import { useT } from "../i18n";
import { saveBlob } from "../saveBlob";
import { areaText, classRows, thinStrata } from "../repeatSurveyView";
import { linkProps, pathFor } from "../router";

const tableSx = { border: 1, borderColor: "divider", borderRadius: 1, overflowX: "auto" } as const;
const cellSx = { "& th, & td": { px: { xs: 1, sm: 1.5 }, whiteSpace: "nowrap" } } as const;

/** An area with its 95% interval under it, smaller. */
function AreaCell({ e, data, signed = false, bold = false }: { e: AreaEstimate; data: RepeatChange; signed?: boolean; bold?: boolean }) {
  const { language } = useApp();
  const text = areaText(e, data.areas, language, signed);
  return (
    <TableCell align="right" sx={{ fontWeight: bold ? 600 : undefined }}>
      <Box component="span" sx={{ display: "block" }}>{text.value}</Box>
      <Box component="span" sx={{ display: "block", fontSize: "0.75rem", color: "text.secondary" }}>{text.ci}</Box>
    </TableCell>
  );
}

/**
 * The areas of the changes (stage 4 of docs/plans/2026-11-11-repeat-survey.md), with their uncertainty as the IPCC
 * uncertainty page has it: the outcomes' areas, each answer's area in both periods and its net change, the transition
 * matrix in areas, and the file. Hectares from the project's areas, as every figure has them (Setup › Areas, else the
 * project file's areas file); shares of the whole until there are some.
 */
export function ChangeAreas({ projectId, data }: { projectId: string; data: RepeatChange }) {
  const t = useT();
  const { language } = useApp();
  const areas = data.areas;
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const name = (code: string) => data.options.find((o) => o.code === code)?.label ?? code;
  const classes = classRows(areas, data.options);
  const thin = thinStrata(areas);
  const unit = areas.areaKnown ? t("changeAreas.unitHa") : t("changeAreas.unitShare");
  const ha = (v: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(v);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { blob, filename } = await downloadRepeatChangeAreas(projectId, data.question.key, data.period);
      saveBlob(blob, filename);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const head = (...cells: ReactNode[]) => (
    <TableHead>
      <TableRow>
        {cells.map((c, i) => (
          <TableCell key={i} align={i === 0 ? "left" : "right"}>{c}</TableCell>
        ))}
      </TableRow>
    </TableHead>
  );
  const uncertaintyOf = (e: AreaEstimate) => areaText(e, areas, language).uncertainty;

  return (
    <Stack spacing={2} component="section" aria-labelledby="change-areas">
      <Typography variant="h3" id="change-areas">{t("changeAreas.title")}</Typography>
      <Explain color="text.primary" text={t("changeAreas.intro.short")} more={t("changeAreas.intro", { earlier: data.period })} />

      {areas.source ? (
        <Typography variant="body2" color="text.secondary">
          {areas.source === "strata"
            ? t("changeAreas.fromStrata", { strata: String(areas.strata.length), area: ha(areas.totalArea) })
            : areas.source === "total"
              ? t("changeAreas.fromTotal", { area: ha(areas.totalArea) })
              : t("changeAreas.fromFile", { file: areas.source, strata: String(areas.strata.length), area: ha(areas.totalArea) })}
        </Typography>
      ) : (
        // No areas yet: they are set in one place, Setup › Areas, for every figure of the project
        <Alert
          severity="info"
          action={
            data.canEdit ? (
              <Button color="inherit" size="small" {...linkProps(pathFor({ name: "project", projectId, tab: "setup", view: "areas" }))}>
                {t("view.setup.areas")}
              </Button>
            ) : undefined
          }
        >
          {t("changeAreas.sharesOnly")}
        </Alert>
      )}
      <ErrorAlert error={error} />

      {areas.plots === 0 ? (
        <Typography color="text.secondary">{t("change.none")}</Typography>
      ) : (
        <>
          {areas.source !== null && thin.length > 0 && <Alert severity="warning">{t("changeAreas.thinStrata", { count: String(thin.length) })}</Alert>}
          {areas.skipped.noArea > 0 && <Alert severity="info">{t("changeAreas.noArea", { count: String(areas.skipped.noArea) })}</Alert>}

          <TableContainer sx={tableSx}>
            <Table size="small" aria-label={t("changeAreas.outcomes")} sx={cellSx}>
              {head(t("changeAreas.col.outcome"), t("changeAreas.col.plots"), t("changeAreas.col.area", { unit }), t("changeAreas.col.uncertainty"))}
              <TableBody>
                {(["unchanged", "changed", "corrected"] as const).map((o) => (
                  <TableRow key={o}>
                    <TableCell component="th" scope="row">{t(`changeAreas.outcome.${o}`, { earlier: data.period })}</TableCell>
                    <TableCell align="right">{areas.outcomes[o].plots}</TableCell>
                    <AreaCell e={areas.outcomes[o]} data={data} />
                    <TableCell align="right">{uncertaintyOf(areas.outcomes[o])}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <TableContainer sx={tableSx}>
            <Table size="small" aria-label={t("changeAreas.classes", { earlier: data.period, now: data.label })} sx={cellSx}>
              {head(data.question.label, t("changeAreas.col.then", { earlier: data.period }), t("changeAreas.col.now", { now: data.label }), t("changeAreas.col.net"), t("changeAreas.col.uncertainty"))}
              <TableBody>
                {classes.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell component="th" scope="row">{c.label}</TableCell>
                    <AreaCell e={c.then} data={data} />
                    <AreaCell e={c.now} data={data} />
                    <AreaCell e={c.net} data={data} signed bold={c.net.area !== 0} />
                    <TableCell align="right">{uncertaintyOf(c.net)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {areas.outcomes.corrected.plots > 0 && (
            <Typography variant="body2" color="text.secondary">{t("changeAreas.thenNote", { earlier: data.period })}</Typography>
          )}

          {areas.matrix.length > 0 && (
            <TableContainer sx={tableSx}>
              <Table size="small" aria-label={t("changeAreas.matrix", { earlier: data.period, now: data.label })} sx={cellSx}>
                {head(t("changeAreas.col.transition", { earlier: data.period, now: data.label }), t("changeAreas.col.plots"), t("changeAreas.col.area", { unit }), t("changeAreas.col.uncertainty"))}
                <TableBody>
                  {[...areas.matrix]
                    .sort((a, b) => Number(a.from === a.to) - Number(b.from === b.to) || b.estimate.area - a.estimate.area)
                    .map((m) => (
                      <TableRow key={`${m.from}\u0000${m.to}`} sx={{ bgcolor: (theme) => (m.from !== m.to ? alpha(theme.palette.warning.main, 0.08) : undefined) }}>
                        <TableCell component="th" scope="row">
                          {m.from === m.to ? t("changeAreas.stable", { answer: name(m.from) }) : `${name(m.from)} → ${name(m.to)}`}
                        </TableCell>
                        <TableCell align="right">{m.estimate.plots}</TableCell>
                        <AreaCell e={m.estimate} data={data} />
                        <TableCell align="right">{uncertaintyOf(m.estimate)}</TableCell>
                      </TableRow>
                    ))}
                  {areas.corrections.map((m) => (
                    <TableRow key={`c${m.from}\u0000${m.to}`}>
                      <TableCell component="th" scope="row" sx={{ color: "text.secondary" }}>
                        {t("changeAreas.correction", { from: name(m.from), to: name(m.to), earlier: data.period })}
                      </TableCell>
                      <TableCell align="right">{m.estimate.plots}</TableCell>
                      <AreaCell e={m.estimate} data={data} />
                      <TableCell align="right">{uncertaintyOf(m.estimate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          <Typography variant="body2" color="text.secondary">
            {t(areas.estimator === "stratified" ? "changeAreas.howStratified" : "changeAreas.howSimple", { plots: String(areas.plots), strata: String(areas.strata.filter((s) => s.plots > 0).length) })}
          </Typography>
          <Box>
            <Button variant="outlined" onClick={() => void download()} disabled={busy}>{t("changeAreas.download")}</Button>
          </Box>
        </>
      )}
    </Stack>
  );
}
