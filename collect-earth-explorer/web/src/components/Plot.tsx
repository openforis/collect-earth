import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-basic-dist-min";
import { dayNames, lang, monthNames, t } from "../lib/i18n";

// The page's language for Plotly (chartStyle CONFIG.locale): month and day names in dates, the toolbar's tooltips.
// Numbers keep Plotly's decimal point, as in the CSV.
if (lang !== "en")
  Plotly.register({
    moduleType: "locale",
    name: lang,
    dictionary: { Zoom: t("plotly.zoom"), Pan: t("plotly.pan"), "Reset axes": t("plotly.reset") },
    format: { months: monthNames("long"), shortMonths: monthNames("short"), days: dayNames("long"), shortDays: dayNames("short") },
  });
const Plot = createPlotlyComponent(Plotly);
export default Plot;
