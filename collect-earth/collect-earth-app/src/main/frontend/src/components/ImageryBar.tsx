import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import type { MapController, UiState } from "../controller";
import { useT } from "../i18n";
import { imageryChoices } from "../imagery";
import type { ImagerySource } from "../types";

/**
 * A button per tab of the imagery window, the one shown pressed: brings that tab to the front, and the window over
 * the others. Nothing when there is only one tab or none, as there is nothing to switch between. Scrolls sideways
 * rather than wrapping when the form panel is narrow; sized in rem, so it follows the scale of the UI.
 */
export function ImageryBar({ controller, state }: { controller: MapController; state: UiState }) {
  const t = useT();
  const choices = imageryChoices(state.imagery);
  if (!choices.length) return null;
  const shown = choices.find((choice) => choice.shown)?.source ?? null;
  return (
    <Box data-testid="imagery-bar" sx={{ overflowX: "auto", px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
      <ToggleButtonGroup size="small" exclusive value={shown} aria-label={t("imagery.label")}
        // null: a click on the button already pressed, which leaves the tab where it is
        onChange={(_, source: ImagerySource | null) => { if (source) controller.showImagery(source); }}>
        {choices.map(({ source }) => (
          <ToggleButton key={source} value={source} data-testid={"imagery-" + source}
            sx={{ py: 0.25, px: 1, whiteSpace: "nowrap", textTransform: "none" }}>
            {t(`imagery.source.${source}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
