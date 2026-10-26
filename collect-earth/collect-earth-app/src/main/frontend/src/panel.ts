/**
 * Whether this page is the plots map in a panel of Google Earth Web's page (the "plots map inside Google Earth Web"
 * window layout, see javascript_plots_map_panel.fmt), which loads it with ?panel: Google Earth Web is the map there, so
 * the page shows only the plot list and the form, and leaves Google Earth Web's page alone.
 */
export function isInPanel(search: string): boolean {
  return new URLSearchParams(search).has("panel");
}

export const IN_PANEL = typeof window !== "undefined" && isInPanel(window.location.search);
