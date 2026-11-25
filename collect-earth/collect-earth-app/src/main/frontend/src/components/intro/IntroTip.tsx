import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import { useT } from "../../i18n";
import type { Tip } from "../../intro";

/** How long a tip waits for its control to be on the page before giving up (it is offered again later). */
const ANCHOR_WAIT_MILLIS = 1500;
/** A tip is not closed by the click that brought it (the plot opened, the filter pressed). */
const ARMED_AFTER_MILLIS = 400;

/**
 * A tip: one line beside the control it is about, the first time that control matters. It asks for nothing: any click
 * or key in the panel closes it, the one on its control included, and it is not shown again. `onOff` switches the tips
 * off for good.
 */
export function IntroTip({ tip, onDone, onOff, onNoAnchor }: {
  tip: Tip;
  /** Closed: counted as shown */
  onDone: () => void;
  onOff: () => void;
  /** Its control is not on the page: not counted as shown */
  onNoAnchor: () => void;
}) {
  const t = useT();
  const [anchor, setAnchor] = useState<Element | null>(null);
  const [arrow, setArrow] = useState<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const started = Date.now();
    let timer: number | undefined;
    const find = () => {
      const el = document.querySelector(tip.anchor);
      if (el && el.getBoundingClientRect().width > 0) setAnchor(el);
      else if (Date.now() - started > ANCHOR_WAIT_MILLIS) onNoAnchor();
      else timer = window.setTimeout(find, 150);
    };
    find();
    return () => window.clearTimeout(timer);
  }, [tip, onNoAnchor]);

  useEffect(() => {
    if (!anchor) return;
    const shownAt = Date.now();
    const close = (e: Event) => {
      if (Date.now() - shownAt < ARMED_AFTER_MILLIS) return;
      // its own buttons answer for themselves
      if (bubble.current?.contains(e.target as Node)) return;
      onDone();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
      close(e);
    };
    // This page, and the form of the plot open, which is a page of its own in a frame (of this server, so it can be
    // listened to). Not Google Earth Web around the panel: a click on the map leaves the tip to be read
    const pages = new Set<Document>();
    const listen = (page: Document | null | undefined) => {
      if (!page || pages.has(page)) return;
      pages.add(page);
      page.addEventListener("pointerdown", close, true);
      page.addEventListener("keydown", onKey, true);
    };
    listen(document);
    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-testid=form-frame]");
    // The frame's page as it is now, and the one it has once loaded: a form still loading is replaced by its page
    const listenToForm = () => { try { listen(frame?.contentDocument); } catch { /* not this server's page: its clicks are not heard */ } };
    listenToForm();
    frame?.addEventListener("load", listenToForm);
    return () => {
      frame?.removeEventListener("load", listenToForm);
      pages.forEach((page) => { page.removeEventListener("pointerdown", close, true); page.removeEventListener("keydown", onKey, true); });
    };
  }, [anchor, onDone]);

  if (!anchor) return null;
  return (
    <Popper open anchorEl={anchor} placement="bottom" sx={{ zIndex: 1350 }}
      modifiers={[
        { name: "offset", options: { offset: [0, 10] } },
        { name: "preventOverflow", options: { padding: 8 } },
        { name: "flip", options: { padding: 8 } },
        { name: "arrow", enabled: true, options: { element: arrow, padding: 12 } },
      ]}>
      <Paper ref={bubble} role="status" elevation={6} data-testid={"intro-" + tip.id} sx={{
        position: "relative", maxWidth: "min(320px, calc(100vw - 16px))", p: 1.25, pr: 0.5, borderRadius: 2,
        bgcolor: "#1f2a37", color: "#fff", display: "flex", alignItems: "flex-start", gap: 1,
        // the arrow, on the side of the control whichever way the tip opened
        "[data-popper-placement^=bottom] > & > [data-arrow]": { top: -5 },
        "[data-popper-placement^=top] > & > [data-arrow]": { bottom: -5 },
      }}>
        <Box ref={setArrow} data-arrow aria-hidden sx={{ position: "absolute", width: 10, height: 10, "&::before": {
          content: "\"\"", position: "absolute", inset: 0, bgcolor: "#1f2a37", transform: "rotate(45deg)" } }} />
        <LightbulbOutlinedIcon fontSize="small" sx={{ mt: "2px", color: "#ffd54f", flex: "none" }} aria-hidden />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: "inherit" }}>{t(tip.text)}</Typography>
          <Link component="button" type="button" variant="caption" onClick={onOff} data-testid="intro-tips-off"
            sx={{ color: "#b6c2cf", textDecorationColor: "currentColor", mt: 0.5 }}>{t("tip.off")}</Link>
        </Box>
        <IconButton size="small" aria-label={t("tip.close")} onClick={onDone} sx={{ color: "#b6c2cf", flex: "none" }} data-testid="intro-tip-close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Paper>
    </Popper>
  );
}
