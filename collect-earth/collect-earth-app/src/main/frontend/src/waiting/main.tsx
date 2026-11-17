import "@fontsource/roboto/400.css";
import "../favicon";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import Typography from "@mui/material/Typography";
import { keyframes, ThemeProvider } from "@mui/material/styles";
import { Logo } from "../components/Logo";
import { translator } from "../i18n";
import { theme } from "../theme";

// /earth/waiting?lang=<UI language>: the window of the other imagery sources shows it until the first plot is picked
const language = new URLSearchParams(window.location.search).get("lang") ?? "en";
document.documentElement.lang = language;
const t = translator(language);

const breathe = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.55; transform: scale(0.96); }
`;
const fadeIn = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }`;
const still = { "@media (prefers-reduced-motion: reduce)": { animation: "none" } };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 4, p: 2, textAlign: "center" }}>
        <Logo sx={{ width: "min(360px, 70vw)", animation: `${breathe} 3s ease-in-out infinite`, ...still }} />
        <Typography variant="h6" component="p" color="text.secondary"
          sx={{ maxWidth: 520, animation: `${fadeIn} 1s ease-out both`, ...still }}>
          {t("waiting.message")}
        </Typography>
      </Box>
    </ThemeProvider>
  </StrictMode>,
);
