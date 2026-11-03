import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { errorMessageKey, searchPlots, type PlotMatch } from "../api";
import { useT } from "../i18n";
import { foundMessage, matchLabel, SEARCH_DELAY_MS, shownMatches, type SearchAnswer } from "../plotView";
import { navigate, pathFor } from "../router";

/** Read by screen readers, not shown. */
const visuallyHidden = { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

/** As the server's MAX_SEARCH_RESULTS. */
const LISTED = 20;

/** The last row of the list when more plots match: a note, not a plot (disabled, still read out). */
type Option = PlotMatch | { more: true };
const MORE: Option = { more: true };
const isMore = (option: Option): option is { more: true } => "more" in option;

/**
 * The project header's plot search (coordinators and reviewers): plots whose id starts with
 * what is typed, asked for a moment after the last key; choosing one opens its page. Only the
 * answer for what is typed now is offered, so Enter never opens a plot of an earlier search.
 */
export function PlotSearchBox({ projectId }: { projectId: string }) {
  const t = useT();
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [error, setError] = useState<{ query: string; error: unknown } | null>(null);
  const latest = useRef(0);
  const query = input.trim();
  const shown = shownMatches(answer, query);
  const failed = error !== null && error.query === query ? error.error : null;
  const loading = query !== "" && answer?.query !== query && failed === null;

  useEffect(() => {
    const call = ++latest.current;
    if (query === "") return;
    const timer = window.setTimeout(() => {
      searchPlots(projectId, query).then(
        (result) => {
          if (call === latest.current) setAnswer({ query, result });
        },
        (err: unknown) => {
          if (call === latest.current) setError({ query, error: err });
        },
      );
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [projectId, query]);

  const options: Option[] = shown.more ? [...shown.plots, MORE] : shown.plots;
  const found = query !== "" && !loading && failed === null ? foundMessage(shown.plots.length) : null;

  return (
    <Box sx={{ width: { xs: "100%", sm: 300 } }}>
      <Autocomplete<Option, false, false, false>
        options={options}
        // The server already chose and ordered them.
        filterOptions={(list) => list}
        getOptionLabel={(option) => (isMore(option) ? "" : matchLabel(option))}
        getOptionDisabled={isMore}
        isOptionEqualToValue={(a, b) => !isMore(a) && !isMore(b) && a.plot === b.plot}
        value={null}
        inputValue={input}
        onInputChange={(_, value, reason) => {
          if (reason !== "reset") setInput(value);
        }}
        onChange={(_, option) => {
          if (option && !isMore(option)) {
            setInput("");
            navigate(pathFor({ name: "plot", projectId, plot: option.plot }));
          }
        }}
        autoHighlight
        loading={loading}
        loadingText={t("plotSearch.searching")}
        noOptionsText={query === "" ? t("plotSearch.placeholder") : failed !== null ? t(errorMessageKey(failed)) : t("plotSearch.none", { q: query })}
        renderOption={(props, option) => {
          const { key: _key, ...rest } = props as typeof props & { key?: string };
          if (isMore(option)) {
            return (
              <Box component="li" {...rest} key="__more__" sx={{ display: "block !important", opacity: "1 !important" }}>
                <Typography variant="body2" color="text.secondary">
                  {t("plotSearch.more", { n: String(LISTED) })}
                </Typography>
              </Box>
            );
          }
          return (
            <Box component="li" {...rest} key={option.plot} sx={{ display: "block !important" }}>
              <Typography sx={{ wordBreak: "break-word" }}>{matchLabel(option)}</Typography>
              {option.files.length > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ wordBreak: "break-word" }}>
                  {t("plotSearch.inFiles", { files: option.files.map((f) => f.filename).join(", ") })}
                </Typography>
              )}
            </Box>
          );
        }}
        renderInput={(params) => <TextField {...params} size="small" label={t("plotSearch.label")} placeholder={t("plotSearch.placeholder")} />}
      />
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {found ? t(found.key, found.n !== undefined ? { n: String(found.n) } : undefined) : ""}
      </Box>
    </Box>
  );
}
