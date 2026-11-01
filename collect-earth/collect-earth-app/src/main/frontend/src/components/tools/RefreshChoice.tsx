import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { serverText, type Texts } from "../../serverTexts";

/**
 * The question the Swing listeners asked when a dataset had been generated before (CollectEarthWindow.59,
 * IPCCGeneratorListener.6): generate it again with the latest data, or use it as it is. Nothing when none was.
 */
export function RefreshChoice({ generated, refresh, onChange, texts }: { generated: boolean; refresh: boolean; onChange: (refresh: boolean) => void; texts: Texts | null }) {
  const s = (key: string) => serverText(texts, key);
  if (!generated) return null;
  return (
    <FormControl data-testid="refresh-choice">
      <FormLabel>{s("ToolsPage.refresh.question")}</FormLabel>
      <RadioGroup value={refresh ? "yes" : "no"} onChange={(e) => onChange(e.target.value === "yes")}>
        <FormControlLabel value="no" control={<Radio size="small" />} label={s("ToolsPage.refresh.no")} />
        <FormControlLabel value="yes" control={<Radio size="small" />} label={s("ToolsPage.refresh.yes")} />
      </RadioGroup>
    </FormControl>
  );
}
