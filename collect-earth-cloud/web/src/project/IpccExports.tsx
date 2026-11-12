import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import { useState } from "react";
import { downloadIpccFile, downloadIpccGhgi, getIpccExports, IPCC_FILES, IPCC_MANAGEMENT, type IpccExports as IpccStatus } from "../api";
import { ErrorAlert } from "../components/ErrorAlert";
import { CardFrame } from "../components/FoldingCard";
import { Explain } from "../components/Explain";
import { Loading } from "../components/Loading";
import { useT } from "../i18n";
import { saveBlob } from "../saveBlob";
import { useLoad } from "../useLoad";

const CATEGORIES = ["F", "C", "G", "W", "S", "O"] as const;
type Management = "MANAGED" | "UNMANAGED" | "ANNUAL" | "PERENNIAL" | "TREED" | "OTHER";

/**
 * The IPCC exports on the Data tab (cloud only: in the local mode Collect Earth's IPCC tool makes them): the files of
 * the desktop's LULUCF package, made by the server from the plots' first assessments, each downloaded on its own; the
 * file for the IPCC Inventory Software after its form. Says plainly when the survey lacks what they need.
 */
export function IpccExports({ projectId }: { projectId: string }) {
  const t = useT();
  const status = useLoad(() => getIpccExports(projectId), [projectId]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [form, setForm] = useState(false);
  const s = status.data;

  const save = async (what: string, get: () => Promise<{ blob: Blob; filename: string }>) => {
    setBusy(what);
    setError(null);
    try {
      const { blob, filename } = await get();
      saveBlob(blob, filename);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <CardFrame title={t("ipcc.title")} fold={t("ipcc.explain.short")}>
      <Stack spacing={2}>
        <Explain text={t("ipcc.explain.short")} more={t("ipcc.explain")} />
        {status.loading && !s ? (
          <Loading />
        ) : status.error ? (
          <ErrorAlert error={status.error} onRetry={status.reload} />
        ) : s && s.missing.length > 0 ? (
          <Alert severity="info">{t("ipcc.missing", { names: s.missing.join(", ") })}</Alert>
        ) : s && s.plots === 0 ? (
          <Alert severity="info">{t("ipcc.noPlots")}</Alert>
        ) : s ? (
          <>
            {s.areas === null && <Alert severity="warning">{t("ipcc.noAreas")}</Alert>}
            <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
              {IPCC_FILES.map((file) => (
                <Button key={file} variant="outlined" startIcon={<Download />} disabled={busy !== null} onClick={() => void save(file, () => downloadIpccFile(projectId, file))}>
                  {busy === file ? t("ipcc.downloading") : t(`ipcc.file.${file}`)}
                </Button>
              ))}
              <Button variant="contained" startIcon={<Download />} disabled={busy !== null} onClick={() => setForm(true)}>
                {t("ipcc.ghgi.open")}
              </Button>
            </Stack>
          </>
        ) : null}
        {!form && <ErrorAlert error={error} />}
      </Stack>
      {form && s && (
        <GhgiForm
          status={s}
          busy={busy === "ghgi"}
          error={error}
          onClose={() => {
            setForm(false);
            setError(null);
          }}
          onDownload={(choices) => void save("ghgi", () => downloadIpccGhgi(projectId, choices)).then((done) => done && setForm(false))}
        />
      )}
    </CardFrame>
  );
}

/** The desktop's form of the file for the IPCC Inventory Software: country, region question, and a management type per subdivision. */
function GhgiForm({ status, busy, error, onClose, onDownload }: {
  status: IpccStatus;
  busy: boolean;
  error: unknown;
  onClose: () => void;
  onDownload: (choices: { country: string; region: string; management: Record<string, string> }) => void;
}) {
  const t = useT();
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState(status.region ?? "");
  const [management, setManagement] = useState<Record<string, string>>(() => Object.fromEntries(status.subdivisions.map((s) => [`${s.category}/${s.code}`, s.management])));

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="ipcc-ghgi-title">
      <DialogTitle id="ipcc-ghgi-title">{t("ipcc.ghgi.title")}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography color="text.secondary">{t("ipcc.ghgi.explain")}</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select fullWidth size="small" label={t("ipcc.country")} value={country} onChange={(e) => setCountry(e.target.value)}>
              {status.countries.map(([code, name]) => (
                <MenuItem key={code} value={code}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
            <TextField select fullWidth size="small" label={t("ipcc.region")} value={region} onChange={(e) => setRegion(e.target.value)}>
              {status.regions.map((r) => (
                <MenuItem key={r} value={r}>
                  {r}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          {CATEGORIES.map((category) => {
            const subdivisions = status.subdivisions.filter((s) => s.category === category);
            if (subdivisions.length === 0) return null;
            return (
              <Box key={category}>
                <Typography variant="subtitle2">{t(`ipcc.cat.${category}`)}</Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("ipcc.subdivision")}</TableCell>
                      <TableCell sx={{ width: { sm: 240 } }}>{t("ipcc.management")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {subdivisions.map((s) => {
                      const key = `${s.category}/${s.code}`;
                      return (
                        <TableRow key={key}>
                          <TableCell>{s.name || s.code}</TableCell>
                          <TableCell>
                            <TextField
                              select
                              fullWidth
                              size="small"
                              value={management[key]}
                              onChange={(e) => setManagement({ ...management, [key]: e.target.value })}
                              slotProps={{ htmlInput: { "aria-label": `${t("ipcc.management")}: ${s.name || s.code}` } }}
                            >
                              {IPCC_MANAGEMENT[category].map((m) => (
                                <MenuItem key={m} value={m}>
                                  {t(`ipcc.mgmt.${m as Management}`)}
                                </MenuItem>
                              ))}
                            </TextField>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            );
          })}
          <ErrorAlert error={error} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t("common.close")}
        </Button>
        <Button variant="contained" startIcon={<Download />} disabled={!country || !region || busy} onClick={() => onDownload({ country, region, management })}>
          {busy ? t("ipcc.downloading") : t("ipcc.download")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
