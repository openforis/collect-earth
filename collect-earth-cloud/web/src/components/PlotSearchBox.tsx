import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { errorMessageKey, searchPlots, type PlotMatch, type PlotSearchResult } from "../api";
import { useT } from "../i18n";
import { matchLabel, SEARCH_DELAY_MS } from "../plotView";
import { navigate, pathFor } from "../router";

const NOTHING: PlotSearchResult = { plots: [], more: false };
/** As the server's MAX_SEARCH_RESULTS. */
const LISTED = 20;

/**
 * The project header's plot search (coordinators and reviewers): plots whose id starts with
 * what is typed, asked for a moment after the last key; choosing one opens its page.
 */
export function PlotSearchBox({ projectId }: { projectId: string }) {
  const t = useT();
  const [input, setInput] = useState("");
  const [result, setResult] = useState<PlotSearchResult>(NOTHING);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const latest = useRef(0);
  const query = input.trim();

  useEffect(() => {
    const call = ++latest.current;
    if (query === "") {
      setResult(NOTHING);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchPlots(projectId, query).then(
        (found) => {
          if (call !== latest.current) return;
          setResult(found);
          setError(null);
          setLoading(false);
        },
        (err: unknown) => {
          if (call !== latest.current) return;
          setResult(NOTHING);
          setError(err);
          setLoading(false);
        },
      );
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, query]);

  const open = (match: PlotMatch) => {
    setInput("");
    navigate(pathFor({ name: "plot", projectId, plot: match.plot }));
  };

  return (
    <Autocomplete<PlotMatch, false, false, false>
      options={result.plots}
      // The server already chose and ordered them.
      filterOptions={(options) => options}
      getOptionLabel={matchLabel}
      isOptionEqualToValue={(a, b) => a.plot === b.plot}
      value={null}
      inputValue={input}
      onInputChange={(_, value, reason) => {
        if (reason !== "reset") setInput(value);
      }}
      onChange={(_, match) => {
        if (match) open(match);
      }}
      autoHighlight
      loading={loading}
      loadingText={t("plotSearch.searching")}
      noOptionsText={query === "" ? t("plotSearch.placeholder") : error ? t(errorMessageKey(error)) : t("plotSearch.none", { q: query })}
      renderOption={(props, match) => {
        const { key: _key, ...rest } = props as typeof props & { key?: string };
        return (
          <Box component="li" {...rest} key={match.plot} sx={{ display: "block !important" }}>
            <Typography sx={{ wordBreak: "break-word" }}>{matchLabel(match)}</Typography>
            {match.files.length > 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                {t("plotSearch.inFiles", { files: match.files.map((f) => f.filename).join(", ") })}
              </Typography>
            )}
          </Box>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={t("plotSearch.label")}
          placeholder={t("plotSearch.placeholder")}
          helperText={result.more && query !== "" ? t("plotSearch.more", { n: String(LISTED) }) : undefined}
        />
      )}
      sx={{ width: { xs: "100%", sm: 300 } }}
    />
  );
}
