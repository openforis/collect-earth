import { createTheme } from "@mui/material/styles";
import { collectEarthColors, collectEarthComponents, collectEarthShape, collectEarthTypography } from "@shared/collectEarthTheme";

// Collect Earth's look, shared with the dashboard (collect-earth-cloud/web/src/shared/collectEarthTheme.ts)
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
  colorSchemes: {
    light: { palette: collectEarthColors.light },
    dark: { palette: collectEarthColors.dark },
  },
  shape: collectEarthShape,
  typography: collectEarthTypography,
  components: collectEarthComponents,
});
