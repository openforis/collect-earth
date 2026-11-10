import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import LinearProgress from "@mui/material/LinearProgress";
import Link from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import { useEffect, useState } from "react";
import { drillCountSql, drillSql, whereSql, type Filter } from "../../analysisQuestion";
import { csvField, type Cube } from "../../analysisView";
import { formatNumber } from "../../format";
import { useApp } from "../../appContext";
import { useT } from "../../i18n";
import { pathFor } from "../../router";
import { saveBlob } from "../../saveBlob";
import { ErrorAlert } from "../ErrorAlert";
import { filterText } from "./FilterBar";

export const DRILL_LIMIT = 200;

/** Rows as CSV that Excel opens with its accents right (a byte order mark first). */
export function csvBlob(columns: readonly string[], rows: readonly Record<string, unknown>[]): Blob {
  const cell = (v: unknown) => (v === null || v === undefined ? "" : csvField(String(v)));
  const text = [columns.map(cell).join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
  return new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
}

/**
 * The drill-through (Saiku's "drill through"): the plots behind a cell of the pivot, with the fields of the view and
 * what its measures read, each plot a link to its page (coordinators and reviewers); all of them downloadable.
 */
export function DrillDialog({
  projectId,
  cube,
  filters,
  columns,
  query,
  plotLinks,
  fileName,
  onClose,
}: {
  projectId: string;
  cube: Cube;
  filters: Filter[];
  columns: string[];
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  plotLinks: boolean;
  fileName: string;
  onClose: () => void;
}) {
  const t = useT();
  const { language } = useApp();
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const partial = whereSql(cube, filters).partial;
  const plotColumn = cube.columns.find((c) => c.id === "_plot")?.name;

  useEffect(() => {
    let live = true;
    Promise.all([query(drillSql(cube, filters, columns, DRILL_LIMIT)), query(drillCountSql(cube, filters))]).then(
      ([r, c]) => {
        if (!live) return;
        setRows(r);
        setCount(Number(c[0]?.n ?? 0));
      },
      (e: unknown) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [cube, filters, columns, query]);

  const download = async () => {
    setBusy(true);
    try {
      saveBlob(csvBlob(columns, await query(drillSql(cube, filters, columns, null))), `${fileName}.csv`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const fields = [...new Set(filters.map(([c]) => c))];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{count === null ? t("analysis.d.title") : t("analysis.d.titleCount", { count: formatNumber(count, language) })}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
          {fields.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("analysis.d.all")}
            </Typography>
          ) : (
            fields.map((c) => <Chip key={c} size="small" label={filterText(c, filters, t)} />)
          )}
        </Box>
        {partial && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t("analysis.d.partial")}
          </Alert>
        )}
        <ErrorAlert error={error} />
        {!rows && !error && <LinearProgress />}
        {rows && rows.length === 0 && <Typography color="text.secondary">{t("analysis.d.none")}</Typography>}
        {rows && rows.length > 0 && (
          <TableContainer sx={{ maxHeight: "60vh" }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {columns.map((c) => (
                    <TableCell key={c} sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={i} hover>
                    {columns.map((c) => {
                      const v = r[c];
                      const text = v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "✓" : "✗") : typeof v === "number" ? formatNumber(Math.round(v * 100) / 100, language) : String(v);
                      return (
                        <TableCell key={c}>
                          {c === plotColumn && plotLinks && text ? (
                            <Link href={pathFor({ name: "plot", projectId, plot: text })} target="_blank" rel="noopener">
                              {text}
                            </Link>
                          ) : (
                            text
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {count !== null && count > DRILL_LIMIT && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t("analysis.d.more", { shown: DRILL_LIMIT, count: formatNumber(count, language) })}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<Download />} onClick={download} disabled={busy || !count}>
          {t("analysis.d.download")}
        </Button>
        <Button variant="contained" onClick={onClose}>
          {t("common.close")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
