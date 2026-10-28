import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import { ThemeProvider } from "@mui/material/styles";
import { I18nContext, translator } from "../i18n";
import { formTheme } from "./formTheme";
import { FormApp } from "./FormApp";
import { FormStore } from "./store";
import { uiScaleStyles } from "../uiScale";

// /earth/form?id=<placemark id>&lang=<UI language>: the plots map opens it next to the map
const params = new URLSearchParams(window.location.search);
const language = params.get("lang") ?? "en";
document.documentElement.lang = language;
const store = new FormStore(params.get("id") ?? "");
window.addEventListener("pagehide", store.saveOnLeave);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={formTheme}>
      <CssBaseline />
      <GlobalStyles styles={uiScaleStyles} />
      <I18nContext.Provider value={translator(language)}>
        <FormApp store={store} />
      </I18nContext.Provider>
    </ThemeProvider>
  </StrictMode>,
);
