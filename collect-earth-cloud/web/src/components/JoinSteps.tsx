import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Download from "@mui/icons-material/Download";
import { useT } from "../i18n";
import { CopyField } from "./CopyField";

export const COLLECT_EARTH_DOWNLOAD_URL = "https://www.openforis.org/tools/collect-earth.html";
/** The menu item exactly as Collect Earth shows it (the desktop app does not translate it). */
export const JOIN_MENU_ITEM = "Join cloud project...";

/** The exact steps a collector follows in Collect Earth with an invitation link. */
export function JoinSteps({ link }: { link: string }) {
  const t = useT();
  return (
    <Box component="ol" sx={{ pl: 3, m: 0, "& > li": { mb: 2 }, "& > li::marker": { fontWeight: 600 } }}>
      <li>
        <Typography>{t("join.step1")}</Typography>
        <Button href={COLLECT_EARTH_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" startIcon={<Download />} sx={{ mt: 0.5 }}>
          {t("join.download")}
        </Button>
      </li>
      <li>
        <Typography>{t("join.step2")}</Typography>
      </li>
      <li>
        <Typography>
          {t("join.step3")} <strong>{t("join.menuFile")}</strong> → <strong>{JOIN_MENU_ITEM}</strong>
        </Typography>
      </li>
      <li>
        <Typography sx={{ mb: 1.5 }}>{t("join.step4")}</Typography>
        <CopyField value={link} label={t("join.linkLabel")} />
      </li>
      <li>
        <Typography>{t("join.step5")}</Typography>
      </li>
    </Box>
  );
}
