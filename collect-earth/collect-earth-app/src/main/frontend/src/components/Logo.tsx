import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import logo from "@shared/collect-earth-logo.png";
import logoWhite from "@shared/collect-earth-logo-white.png";

/**
 * The Collect Earth logo, with its white-text version in the dark scheme, which follows the system's (theme.ts,
 * colorSchemeSelector "media"), as the picture's source does.
 */
export function Logo({ sx }: { sx?: SxProps<Theme> }) {
  return (
    <picture style={{ display: "contents" }}>
      <source srcSet={logoWhite} media="(prefers-color-scheme: dark)" />
      <Box component="img" src={logo} alt="Open Foris Collect Earth" sx={sx} />
    </picture>
  );
}
