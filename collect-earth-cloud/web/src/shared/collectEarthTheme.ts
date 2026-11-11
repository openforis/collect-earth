// The look of Collect Earth, shared by its pages (collect-earth/collect-earth-app/src/main/frontend: the plots map, the
// menus and the panel) and by the dashboard (this web app, local and cloud), so that both read as one product.
//
// It lives here because the dashboard's Docker build sees only collect-earth-cloud; Collect Earth's frontend imports it
// from here (its builds see the whole repository). It imports nothing, MUI included: each app passes these options to
// createTheme with its own copy of MUI, so neither resolves a package from the other's node_modules. A change here
// changes both apps.

/** Collect Earth's colours, light and dark. */
export const collectEarthColors = {
  light: {
    primary: { main: "#1565c0" },
    background: { default: "#f4f6f8" },
  },
  dark: {
    primary: { main: "#64a8f0", contrastText: "#0b1420" },
    background: { default: "#101418", paper: "#171c22" },
  },
} as const;

export const collectEarthShape = { borderRadius: 10 } as const;

export const collectEarthTypography = {
  fontFamily: "Roboto, system-ui, -apple-system, 'Segoe UI', Arial, sans-serif",
  button: { textTransform: "none", fontWeight: 600 },
} as const;

/** The defaults and overrides of MUI's components that both apps share. */
export const collectEarthComponents = {
  MuiToggleButton: { styleOverrides: { root: { textTransform: "none" } } },
  MuiTooltip: { defaultProps: { arrow: true } },
} as const;

/** The app bar: light, with the Collect Earth logo. */
export const collectEarthAppBar = {
  color: "default",
  elevation: 1,
  logoSx: { height: 40, flexShrink: 0 },
} as const;
