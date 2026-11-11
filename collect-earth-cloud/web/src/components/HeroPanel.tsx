import "@fontsource/poppins/500.css";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import hero from "../assets/login-hero.jpg";
import icon from "../shared/collect-earth-icon.png";

// The look of Collect Earth's website (the gh-pages branch, after openforis.org): satellite imagery edge to edge with a
// blue band under it, the content in a white, see-through, rounded box, Poppins headings and green buttons.

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
 * The website's hero around a page of its own (the log-in page): the satellite image filling the page, the blue band
 * under it, and `children` in the white box, to the right on a wide screen as on the website, in the middle on a narrow
 * one, under the name of the product with its emblem.
 */
export function HeroPanel({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: { xs: "center", md: "flex-end" },
        px: { xs: 1.5, sm: 3, md: "6vw" },
        py: { xs: 3, sm: 6 },
        background: `#23463a url(${hero}) 22% 45% / cover no-repeat`,
        borderBottom: `8px solid ${WEBSITE.blue}`,
        "@media print": { background: "none", borderBottom: 0 },
      }}
    >
      <Box
        sx={{
          width: "100%",
          maxWidth: 480,
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
    </Box>
  );
}
