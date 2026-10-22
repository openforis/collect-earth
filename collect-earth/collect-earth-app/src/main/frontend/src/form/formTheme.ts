import { createTheme } from "@mui/material/styles";

/**
 * The colours of the Collect Earth balloon (Bootstrap 3 + jQuery Steps, earth.css): blue step tabs, cyan
 * "info" buttons that turn dark teal once chosen, a grey panel around the questions. The form keeps them so
 * operators recognise it, on a cleaner layout.
 */
interface BalloonPalette {
  /** a tab that is not the current one (jquery-steps .done) */
  tab: string;
  tabText: string;
  /** the grey panel the questions sit on (.wizard > .content) */
  panel: string;
  /** a code item not chosen (.btn-info) */
  code: string;
  codeBorder: string;
  codeHover: string;
  codeText: string;
  /** a chosen code item (.btn-info.active) */
  codeOn: string;
  codeOnBorder: string;
  codeOnText: string;
  /** plot file data in the header (.capsuleCat) */
  capsule: string;
}

declare module "@mui/material/styles" {
  interface Palette { balloon: BalloonPalette }
  interface PaletteOptions { balloon?: BalloonPalette }
}

export const formTheme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#2184be", dark: "#1a6a99", contrastText: "#ffffff" },
        text: { primary: "#333333", secondary: "#666666" },
        background: { default: "#ffffff", paper: "#ffffff" },
        balloon: {
          tab: "#9dc8e2", tabText: "#174d6e", panel: "#eeeeee",
          code: "#5bc0de", codeBorder: "#46b8da", codeHover: "#46b8da", codeText: "#0d3a47",
          codeOn: "#306878", codeOnBorder: "#1c4c5a", codeOnText: "#ffffff",
          capsule: "#e9f3f9",
        },
      },
    },
    dark: {
      palette: {
        primary: { main: "#4aa8dc", dark: "#2184be", contrastText: "#0b1a24" },
        background: { default: "#14191e", paper: "#14191e" },
        balloon: {
          tab: "#24435a", tabText: "#cfe3f0", panel: "#1c232a",
          code: "#1d4c5c", codeBorder: "#2b6a7f", codeHover: "#245b6d", codeText: "#d6f1fa",
          codeOn: "#5bc0de", codeOnBorder: "#8fd4ea", codeOnText: "#08212a",
          capsule: "#1f3442",
        },
      },
    },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif",
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiTooltip: { defaultProps: { arrow: true } },
    // the inputs stand out white on the grey panel, as the balloon's Bootstrap fields
    MuiOutlinedInput: { styleOverrides: { root: ({ theme }) => ({ backgroundColor: theme.vars!.palette.background.paper }) } },
    MuiTabs: {
      styleOverrides: {
        // jquery-steps: rounded tabs that wrap onto a second line instead of scrolling out of sight
        root: { minHeight: 0 },
        indicator: { display: "none" },
        list: { flexWrap: "wrap", gap: 4 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: ({ theme }) => ({
          // in rem and spacing, so that they get smaller with the rest in small windows (uiScale.ts)
          minHeight: 0, minWidth: 0, padding: theme.spacing(0.625, 1.5), borderRadius: 5, fontSize: "0.8125rem", fontWeight: 500, lineHeight: 1.4,
          backgroundColor: theme.vars!.palette.balloon.tab, color: theme.vars!.palette.balloon.tabText, opacity: 1,
          "&.Mui-selected": { backgroundColor: theme.vars!.palette.primary.main, color: theme.vars!.palette.primary.contrastText },
          "&:hover:not(.Mui-selected)": { filter: "brightness(0.95)" },
          "&.Mui-focusVisible": { outline: `2px solid ${theme.vars!.palette.primary.dark}`, outlineOffset: 1 },
        }),
      },
    },
  },
});
