import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography, { type TypographyProps } from "@mui/material/Typography";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import { useState, type ReactNode } from "react";
import { useT } from "../i18n";

/**
 * A small "i" whose tip holds the full explanation of something on the page: how it is counted, what it is for and
 * how to use it. It opens on hover and keyboard focus, and on a tap (touch screens have no hover); screen readers
 * read it as the button's description. Printed pages show the text instead (AppShell's print styles).
 */
export function MoreInfo({ text, label }: { text: ReactNode; label?: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip
        title={<Box sx={{ whiteSpace: "pre-line" }}>{text}</Box>}
        describeChild
        disableTouchListener
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        slotProps={{ tooltip: { sx: { maxWidth: 380, fontSize: "0.8rem", lineHeight: 1.5, p: 1.25 } } }}
      >
        <IconButton
          size="small"
          aria-label={label ?? t("common.moreInfo")}
          onClick={() => setOpen((o) => !o)}
          sx={{ p: 0.25, ml: 0.25, mt: "-2px", color: "text.secondary", verticalAlign: "middle" }}
        >
          <InfoOutlined sx={{ fontSize: "1.05rem" }} />
        </IconButton>
      </Tooltip>
      <Box component="span" className="print-only">
        {" "}
        {text}
      </Box>
    </>
  );
}

/**
 * A short explanation in a sentence, with the full one in a "more about this" tip after it. `more` left out: the short
 * text alone.
 */
export function Explain({ text, more, ...props }: { text: ReactNode; more?: ReactNode } & Omit<TypographyProps, "children">) {
  return (
    <Typography color="text.secondary" {...props}>
      {text}
      {more && <MoreInfo text={more} />}
    </Typography>
  );
}
