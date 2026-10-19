import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
  colorSchemes: {
    light: { palette: { primary: { main: "#1565c0" }, background: { default: "#f4f6f8" } } },
    dark: { palette: { primary: { main: "#64a8f0", contrastText: "#0b1420" }, background: { default: "#101418", paper: "#171c22" } } },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif",
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiToggleButton: { styleOverrides: { root: { textTransform: "none" } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
