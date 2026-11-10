import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { generateSigrid, listSigridCountries, planSigrid, type DesignArea, type SigridChoice, type SigridCountry, type SigridFacts } from "../api";
import { useApp } from "../appContext";
import { ErrorAlert } from "../components/ErrorAlert";
import { FileDrop } from "../components/FileDrop";
import { formatNumber } from "../format";
import { useT } from "../i18n";
import { bytesToBase64 } from "../plotDesignView";
import { districtOptions, firstSpacing, sigridFileName } from "../sigridView";

type District = ReturnType<typeof districtOptions>[number];

/** Plots from the SIGRID grid of a country: its provinces or districts, clipped to an area if given, at one spacing. */
export function SigridDesign({ projectId, busy, onFile }: { projectId: string; busy: boolean; onFile: (file: File) => Promise<void> }) {
  const t = useT();
  const { language } = useApp();
  const [countries, setCountries] = useState<SigridCountry[]>([]);
  const [country, setCountry] = useState<SigridCountry | null>(null);
  const [provinces, setProvinces] = useState<string[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [clip, setClip] = useState<{ name: string; sent: DesignArea } | null>(null);
  const [spacing, setSpacing] = useState<number | null>(null);
  const [facts, setFacts] = useState<SigridFacts | null>(null);
  // The choice the shown count is of: the file is made only for that one.
  const [countedFor, setCountedFor] = useState("");
  const [working, setWorking] = useState<"checking" | "creating" | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const n = (v: number) => formatNumber(v, language);

  useEffect(() => {
    listSigridCountries(projectId).then((r) => setCountries(r.countries), setError);
  }, [projectId]);

  const choice: SigridChoice | null = country
    ? {
        country: country.name,
        ...(spacing !== null ? { spacingKm: spacing } : {}),
        provinces,
        districts: districts.map(({ province, district }) => ({ province, district })),
        ...(clip?.sent ?? {}),
      }
    : null;
  const choiceKey = JSON.stringify(choice);
  useEffect(() => {
    if (!choice) return;
    let live = true;
    const timer = setTimeout(async () => {
      setWorking("checking");
      try {
        const next = await planSigrid(projectId, choice);
        if (!live) return;
        setFacts(next);
        setCountedFor(choiceKey);
        setError(null);
        if (spacing === null) setSpacing(firstSpacing(next));
      } catch (err) {
        if (live) setError(err);
      } finally {
        if (live) setWorking(null);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, choiceKey]);

  const pickCountry = (c: SigridCountry | null) => {
    setCountry(c);
    setFacts(null);
    setProvinces([]);
    setDistricts([]);
    setSpacing(null);
    setMade(null);
  };

  const readClip = async ([file]: File[]) => {
    setError(null);
    const sent: DesignArea = file.name.toLowerCase().endsWith(".zip") ? { shapefile: bytesToBase64(new Uint8Array(await file.arrayBuffer())) } : { geojson: await file.text() };
    setClip({ name: file.name, sent });
  };

  const create = async () => {
    if (!choice || !country || spacing === null) return;
    setError(null);
    setMade(null);
    setWorking("creating");
    try {
      const csv = await generateSigrid(projectId, choice);
      const name = sigridFileName(country.file, spacing);
      await onFile(new File([csv], name, { type: "text/csv" }));
      setMade(name);
    } catch (err) {
      setError(err);
    } finally {
      setWorking(null);
    }
  };

  const options = useMemo(() => (facts && facts.country === country?.name ? districtOptions(facts) : []), [facts, country]);
  const at = facts && spacing !== null ? facts.spacings.indexOf(spacing) : -1;
  const current = facts && facts.country === country?.name ? facts : null;
  return (
    <Stack spacing={2}>
      <Typography color="text.secondary">{t("sigrid.explain")}</Typography>
      <Autocomplete
        options={countries}
        value={country}
        onChange={(_, c) => pickCountry(c)}
        getOptionLabel={(c) => c.name}
        isOptionEqualToValue={(a, b) => a.name === b.name}
        disabled={working === "creating" || busy}
        renderInput={(params) => <TextField {...params} size="small" label={t("sigrid.country")} />}
        sx={{ maxWidth: 420 }}
      />
      {current && (
        <>
          {current.provinces.length > 0 && (
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <Autocomplete
                multiple
                options={current.provinces.map((p) => p.name)}
                value={provinces}
                onChange={(_, v) => setProvinces(v)}
                renderInput={(params) => <TextField {...params} size="small" label={t("sigrid.provinces")} placeholder={provinces.length === 0 ? t("sigrid.all") : undefined} />}
                sx={{ flex: 1 }}
              />
              <Autocomplete
                multiple
                options={options}
                value={districts}
                onChange={(_, v) => setDistricts(v)}
                groupBy={(d) => d.province}
                getOptionLabel={(d) => d.district}
                isOptionEqualToValue={(a, b) => a.key === b.key}
                renderInput={(params) => <TextField {...params} size="small" label={t("sigrid.districts")} placeholder={districts.length === 0 ? t("sigrid.all") : undefined} />}
                sx={{ flex: 1 }}
              />
            </Stack>
          )}
          {clip ? (
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
              <Typography>{t("sigrid.clipped", { name: clip.name })}</Typography>
              <Box>
                <Button size="small" onClick={() => setClip(null)}>
                  {t("sigrid.noClip")}
                </Button>
              </Box>
            </Stack>
          ) : (
            <FileDrop label={t("sigrid.clipDrop")} buttonLabel={t("design.choose")} accept=".geojson,.json,.zip,application/geo+json,application/zip" disabled={working === "creating" || busy} onFiles={readClip} />
          )}
          <TextField select size="small" label={t("sigrid.spacing")} value={spacing ?? ""} onChange={(e) => setSpacing(Number(e.target.value))} sx={{ maxWidth: 420 }}>
            {current.spacings.map((s, i) => (
              <MenuItem key={s} value={s}>
                {t("sigrid.spacingOption", { km: s, count: n(current.selected[i]) })}
              </MenuItem>
            ))}
          </TextField>
          <div role="status">
            {working === "checking" ? (
              <Typography color="text.secondary">{t("design.checking")}</Typography>
            ) : current.plots !== undefined && at >= 0 ? (
              current.tooMany ? (
                <Alert severity="warning">{t("sigrid.tooMany", { count: n(current.plots), max: n(current.max) })}</Alert>
              ) : (
                <Typography>{t("design.estimate", { count: n(current.plots) })}</Typography>
              )
            ) : null}
          </div>
          <Box>
            <Button
              variant="contained"
              onClick={create}
              disabled={working !== null || busy || countedFor !== choiceKey || !current.plots || current.tooMany || spacing === null}
            >
              {working === "creating" ? t("design.creating") : t("sigrid.create")}
            </Button>
          </Box>
          {made && (
            <Alert severity="info" role="status">
              {t("sigrid.made", { name: made })}
            </Alert>
          )}
        </>
      )}
      <ErrorAlert error={error} />
    </Stack>
  );
}
