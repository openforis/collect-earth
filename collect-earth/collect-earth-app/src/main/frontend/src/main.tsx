import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import { ThemeProvider } from "@mui/material/styles";
import { App } from "./App";
import { MapController } from "./controller";
import { theme } from "./theme";
import { uiScaleStyles } from "./uiScale";

const controller = new MapController();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={uiScaleStyles} />
      <App controller={controller} />
    </ThemeProvider>
  </StrictMode>,
);
