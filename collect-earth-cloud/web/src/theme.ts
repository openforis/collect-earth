import { createTheme } from "@mui/material/styles";
import { collectEarthColors, collectEarthComponents, collectEarthShape, collectEarthTypography } from "./shared/collectEarthTheme";

// Collect Earth's look (src/shared/collectEarthTheme.ts, which its pages use too), in its light colours: the charts,
// the analysis grid and the printed reports are drawn for a light page, so the dashboard has no dark scheme yet.
// Then what a page of figures and forms needs on top of Collect Earth's panel: headings, quieter borders, flat
// buttons, denser fields and tables.

/** A border lighter than MUI's divider, for cards on the grey page. */
const HAIRLINE = "rgba(16, 24, 40, 0.09)";

export const theme = createTheme({
  palette: { ...collectEarthColors.light, divider: HAIRLINE },
  shape: collectEarthShape,
  typography: {
    ...collectEarthTypography,
    // the dashboard's pages have headings, which Collect Earth's panel does not
    h1: { fontSize: "1.6rem", fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.25 },
    h2: { fontSize: "1.15rem", fontWeight: 600, letterSpacing: "-0.005em", lineHeight: 1.35 },
    h3: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.4 },
  },
  components: {
    ...collectEarthComponents,
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiPaper: {
      styleOverrides: {
        outlined: { borderColor: HAIRLINE },
        elevation1: { boxShadow: "0 1px 2px rgba(16, 24, 40, 0.06)" },
      },
    },
    MuiTextField: { defaultProps: { fullWidth: true, size: "small" } },
    MuiTab: { styleOverrides: { root: { minHeight: 44, fontWeight: 500 } } },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme }) => ({ fontWeight: 600, fontSize: "0.8rem", color: theme.palette.text.secondary, backgroundColor: "#f8fafc" }),
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
    // Most alerts are plain explanations already on the page: only errors (role="alert")
    // and results of an action (role="status") are announced by screen readers.
    MuiAlert: { defaultProps: { role: "note" }, styleOverrides: { root: { borderRadius: 8 } } },
  },
});
