import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { AppInfo } from "../../appInfo";
import { anchorLabel } from "../../project";
import { serverText, type Texts } from "../../serverTexts";
import { formatText } from "../../settings";

const CHANGELOG_URL = "https://github.com/openforis/collect-earth/blob/master/collect-earth/CHANGELOG.md";
const WEBSITE_URL = "https://www.openforis.org";

interface Props { open: boolean; texts: Texts | null; info: AppInfo; onClose: () => void }

/** About (AboutDialog): the version, the build and the Java, Open Foris, the change log. */
export function AboutDialog({ open, texts, info, onClose }: Props) {
  const s = (key: string) => serverText(texts, key);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth data-testid="about-dialog">
      <DialogTitle>{s("CollectEarthWindow.62")}</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{formatText(s("HelpPage.about.version"), info.version ?? "?", info.build ?? "?", info.java ?? "?")}</Typography>
          <Typography variant="body2">{s("AboutDialog.3")}</Typography>
          <Link href={WEBSITE_URL} target="_blank" rel="noopener" variant="body2">{anchorLabel(s("AboutDialog.5"))}</Link>
          <Link href={CHANGELOG_URL} target="_blank" rel="noopener" variant="body2">{anchorLabel(s("AboutDialog.4"))}</Link>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>{s("AboutDialog.8")}</Button>
      </DialogActions>
    </Dialog>
  );
}
