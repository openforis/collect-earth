import { createTheme } from "@mui/material/styles";
import { collectEarthColors, collectEarthComponents, collectEarthShape, collectEarthTypography } from "./shared/collectEarthTheme";

// Collect Earth's look (src/shared/collectEarthTheme.ts, which its pages use too), in its light colours: the charts,
// the analysis grid and the printed reports are drawn for a light page, so the dashboard has no dark scheme yet.
export const theme = createTheme({
  palette: collectEarthColors.light,
  shape: collectEarthShape,
  typography: {
    ...collectEarthTypography,
    // the dashboard's pages have headings, which Collect Earth's panel does not
    h1: { fontSize: "1.9rem", fontWeight: 500 },
    h2: { fontSize: "1.4rem", fontWeight: 500 },
    h3: { fontSize: "1.15rem", fontWeight: 500 },
  },
  components: {
    ...collectEarthComponents,
    MuiTextField: { defaultProps: { fullWidth: true } },
    // Most alerts are plain explanations already on the page: only errors (role="alert")
    // and results of an action (role="status") are announced by screen readers.
    MuiAlert: { defaultProps: { role: "note" } },
  },
});
