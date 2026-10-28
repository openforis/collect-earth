import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: {
    primary: { main: "#2e6b3f" },
    secondary: { main: "#1f5f8b" },
    background: { default: "#f4f6f3" },
  },
  shape: { borderRadius: 10 },
  typography: {
    h1: { fontSize: "1.9rem", fontWeight: 500 },
    h2: { fontSize: "1.4rem", fontWeight: 500 },
    h3: { fontSize: "1.15rem", fontWeight: 500 },
    button: { textTransform: "none", fontWeight: 500 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { fullWidth: true } },
    // Most alerts are plain explanations already on the page: only errors (role="alert")
    // and results of an action (role="status") are announced by screen readers.
    MuiAlert: { defaultProps: { role: "note" } },
  },
});
