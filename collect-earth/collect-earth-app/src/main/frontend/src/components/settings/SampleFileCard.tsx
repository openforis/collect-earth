import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { formatText, type SampleFileCheck } from "../../settings";
import { serverText } from "../../serverTexts";
import { SettingField, type SettingFieldProps } from "./SettingField";

interface Props extends SettingFieldProps {
  /** What the server found in the file at the path, null while none was checked */
  check: SampleFileCheck | null;
  checking: boolean;
  /** The check itself failed (the server could not be reached) */
  checkError: string | null;
}

/**
 * The plots file of the project: its path, and what the server found in it (POST /api/settings/sampleFile): how
 * many plots, its columns against the survey's, the problems, the first rows and a map of where the plots are.
 */
export function SampleFileCard({ check, checking, checkError, ...field }: Props) {
  const s = (key: string) => serverText(field.texts, key);
  const columns = check ? (check.foundColumns.length ? check.foundColumns : check.expectedColumns) : [];
  const width = Math.max(columns.length, ...(check?.rows.map((r) => r.length) ?? [0]));
  const wrongCells = new Set<string>();
  for (const problem of check?.problems ?? []) {
    if (Array.isArray(problem.details)) {
      for (const cell of problem.details as { row: number; column: number }[]) wrongCells.add(cell.row + ":" + cell.column);
    }
  }
  return (
    <Stack spacing={2} data-testid="sample-file">
      <SettingField {...field} />
      {checking && <LinearProgress aria-label={s("SettingsPage.sampleFile.checking")} />}
      {checkError && <Alert severity="warning">{formatText(s("SettingsPage.sampleFile.checkFailed"), checkError)}</Alert>}
      {check && !checking && (
        <Stack spacing={1.5}>
          {check.problems.map((p) => (
            <Alert key={p.code} severity={p.blocking ? "error" : "warning"} sx={{ whiteSpace: "pre-line" }}>{p.message}</Alert>
          ))}
          {check.exists && (
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
              <Chip label={formatText(s("SettingsPage.sampleFile.plots"), check.plots)} color="primary" variant="outlined" size="small" />
              {check.foundColumns.length === 0 && <Chip label={s("SettingsPage.sampleFile.noHeader")} size="small" />}
            </Stack>
          )}
          {check.exists && check.expectedColumns.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {s("SettingsPage.sampleFile.expected")}: {check.expectedColumns.join(", ")}
            </Typography>
          )}
          {check.rows.length > 0 && (
            <Paper variant="outlined" sx={{ overflow: "auto", maxHeight: 280 }}>
              <Table size="small" stickyHeader aria-label={s("SettingsPage.sampleFile.preview")}>
                <TableHead>
                  <TableRow>
                    {Array.from({ length: width }, (_, i) => <TableCell key={i}>{columns[i] ?? ""}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {check.rows.map((row, r) => (
                    <TableRow key={r}>
                      {Array.from({ length: width }, (_, c) => (
                        <TableCell key={c} sx={wrongCells.has((r + 1) + ":" + (c + 1)) ? { bgcolor: "error.main", color: "error.contrastText" } : undefined}>
                          {row[c] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
          )}
          {check.points.length > 1 && <DotMap points={check.points} label={s("SettingsPage.sampleFile.map")} />}
        </Stack>
      )}
    </Stack>
  );
}

/** The plots as dots, latitude and longitude to scale (the longitudes squeezed by the cosine of the middle latitude). */
function DotMap({ points, label }: { points: [number, number][]; label: string }) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const cos = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180)) || 1;
  const w = Math.max((maxLon - minLon) * cos, 1e-6), h = Math.max(maxLat - minLat, 1e-6);
  const size = Math.max(w, h);
  const pad = size * 0.05;
  const r = size / 120;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Box component="svg" role="img" aria-label={label} data-testid="dot-map"
        viewBox={`${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`} preserveAspectRatio="xMidYMid meet"
        sx={{ display: "block", width: "100%", maxWidth: 420, maxHeight: 300, bgcolor: "action.hover", borderRadius: 1 }}>
        {points.map((p, i) => (
          <circle key={i} cx={(p[1] - minLon) * cos} cy={maxLat - p[0]} r={r} fill="#fbc02d" stroke="#5d4a00" strokeWidth={r / 4} />
        ))}
      </Box>
    </Box>
  );
}
