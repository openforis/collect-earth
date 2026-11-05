import { useCallback, useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormLabel from "@mui/material/FormLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import { IMPORT_KINDS, type ImportKind } from "../../importDialog";
import { serverText, type Texts } from "../../serverTexts";
import { ImportZipSteps } from "./ImportZipSteps";
import { UpdateCsvSteps } from "./UpdateCsvSteps";

interface Props { open: boolean; texts: Texts | null; language: string; onClose: () => void }

/**
 * The Data menu's single import: records from a Collect Earth export (ZIP with XML), new or replacing the ones of the
 * database, or changes to some attributes of the records from a CSV. What to import is chosen first, as the format of
 * the export dialog is; the steps of each kind follow, and the choice is gone once they have started.
 */
export function ImportDialog({ open, texts, language, onClose }: Props) {
  const s = (key: string) => serverText(texts, key);
  const [kind, setKind] = useState<ImportKind>("ZIP");
  const [locked, setLocked] = useState(false);
  const onLocked = useCallback((value: boolean) => setLocked(value), []);

  useEffect(() => {
    if (open) { setKind("ZIP"); setLocked(false); }
  }, [open]);

  const choice = (
    <FormControl>
      <FormLabel>{s("DataPage.import.kind")}</FormLabel>
      <RadioGroup value={kind} onChange={(e) => setKind(e.target.value as ImportKind)}>
        {IMPORT_KINDS.map((k) => (
          <FormControlLabel key={k} value={k} control={<Radio size="small" />} label={s("DataPage.import.kind." + k)} />
        ))}
      </RadioGroup>
    </FormControl>
  );

  return (
    <Dialog open={open} onClose={locked ? undefined : onClose} fullWidth maxWidth="md" data-testid="import-dialog">
      <DialogTitle>{s("DataPage.import.title")}</DialogTitle>
      {/* Keyed by the kind: a kind chosen anew starts from its first step */}
      {kind === "ZIP"
        ? <ImportZipSteps key="ZIP" open={open} texts={texts} language={language} onClose={onClose} choice={choice} onLocked={onLocked} />
        : <UpdateCsvSteps key="CSV" open={open} texts={texts} onClose={onClose} choice={choice} onLocked={onLocked} />}
    </Dialog>
  );
}
