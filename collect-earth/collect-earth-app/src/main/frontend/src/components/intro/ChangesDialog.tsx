import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Typography from "@mui/material/Typography";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import { useT, type MessageKey } from "../../i18n";

/** What moved, in the order someone used to Collect Earth 1 meets it */
const ROWS = ["window", "earth", "plot", "imagery", "save", "status", "analysis", "team"] as const;

/**
 * "What changed from Collect Earth 1": each thing of the old program, and where it is now. Shown once to those who used
 * Collect Earth before 2.0, and from Help. A real dialog, over the whole of Google Earth Web's page: it is read, not
 * pointed with.
 */
export function ChangesDialog({ open, onShow, onClose }: {
  open: boolean;
  /** Closes it and shows the map of the screen */
  onShow: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" data-testid="intro-changes">
      <DialogTitle>{t("changes.title")}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t("changes.intro")}</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, columnGap: 2, rowGap: { xs: 0, sm: 0 } }}>
          {/* The headings of the two columns: on a narrow window each row says them itself */}
          <Typography variant="overline" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>{t("changes.before")}</Typography>
          <Typography variant="overline" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>{t("changes.now")}</Typography>
          {ROWS.map((row) => (
            <Box key={row} data-testid={"changes-" + row} sx={{ display: "contents" }}>
              <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.25, pb: { xs: 0.5, sm: 1.25 } }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: { xs: "block", sm: "none" }, lineHeight: 1.6 }}>{t("changes.before")}</Typography>
                <Typography variant="body2" color="text.secondary">{t(`changes.${row}.before` as MessageKey)}</Typography>
              </Box>
              <Box sx={{ borderTop: { xs: 0, sm: 1 }, borderColor: { sm: "divider" }, pt: { xs: 0, sm: 1.25 }, pb: 1.25 }}>
                <ArrowDownwardIcon aria-hidden sx={{ display: { xs: "block", sm: "none" }, fontSize: 16, color: "text.disabled", my: 0.25 }} />
                <Typography variant="body2" sx={{ fontWeight: 500 }}>{t(`changes.${row}.now` as MessageKey)}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} data-testid="changes-close">{t("changes.close")}</Button>
        <Button variant="contained" disableElevation onClick={onShow} autoFocus data-testid="changes-show">{t("changes.show")}</Button>
      </DialogActions>
    </Dialog>
  );
}
