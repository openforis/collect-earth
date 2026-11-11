import "@fontsource/poppins/500.css";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { useApp } from "../appContext";
import { useT } from "../i18n";
// © FAO/Guillermo Carlos, PERU 2026, peatland monitoring in the Peruvian Amazon (FAO Digital Media Hub, photo credit
// required): its 1200 px preview, lightly softened and in WebP, ~110 KB
import hero from "../assets/login-hero.webp";
import icon from "../shared/collect-earth-icon.png";

// The look of Collect Earth's website (the gh-pages branch, after openforis.org): an aerial photo edge to edge with a
// blue band under it, the content in a white, see-through, rounded box, Poppins headings and green buttons.

/** The credit the photo's terms ask for, shown on it */
const PHOTO_CREDIT = "© FAO/Guillermo Carlos";

/** The website's colours (its style.css) */
export const WEBSITE = {
  blue: "#4A9CD5",
  green: "#587F2E",
  greenDark: "#476825",
  heading: "#161922",
  font: "Poppins, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const;

/** A heading as the website draws one: Poppins, medium, dark slate */
export const WEBSITE_HEADING = { fontFamily: WEBSITE.font, fontWeight: 500, color: WEBSITE.heading, letterSpacing: 0 } as const;

/** The website's main button: green, slightly rounded, Poppins */
export const WEBSITE_BUTTON = {
  bgcolor: WEBSITE.green,
  fontFamily: WEBSITE.font,
  fontWeight: 500,
  borderRadius: "6px",
  boxShadow: "none",
  "&:hover": { bgcolor: WEBSITE.greenDark, boxShadow: "none" },
} as const;

/**
 * The website's hero around a page of its own (the log-in page): an aerial photo of forest filling the page, the blue band
 * under it, and `children` in the white box, to the right on a wide screen as on the website, in the middle on a narrow
 * one, under the server's name with Collect Earth's emblem. `wide`: a box for more than a form (the invitation's steps).
 */
export function HeroPanel({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const t = useT();
  const { info } = useApp();
  const name = info.serverName ?? t("app.title");
  return (
    <Box
      sx={{
        flex: 1,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: { xs: "center", md: "flex-end" },
        px: { xs: 1.5, sm: 3, md: "6vw" },
        py: { xs: 3, sm: 6 },
        background: `#2f4a2a url(${hero}) center / cover no-repeat`,
        borderBottom: `8px solid ${WEBSITE.blue}`,
        "@media print": { background: "none", borderBottom: 0 },
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: wide ? 640 : 480,
          bgcolor: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          borderRadius: "16px",
          p: { xs: 3, sm: 4.5 },
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.18)",
        }}
      >
        <Typography component="p" sx={{ ...WEBSITE_HEADING, display: "flex", alignItems: "center", gap: 1.5, fontSize: "1.1rem", mb: 2 }}>
          <Box component="img" src={icon} alt="" sx={{ width: 32, height: 32 }} />
          {name}
        </Typography>
        {children}
      </Box>
      <Typography
        component="p"
        sx={{ position: "absolute", left: 12, bottom: 6, m: 0, fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.85)", textShadow: "0 1px 2px rgba(0, 0, 0, 0.6)" }}
      >
        {PHOTO_CREDIT}
      </Typography>
    </Box>
  );
}
