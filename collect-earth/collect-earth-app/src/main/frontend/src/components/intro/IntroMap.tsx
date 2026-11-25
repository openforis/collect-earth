import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useT } from "../../i18n";
import { BADGE, FORM_MAP, LIST_MAP, badgeAt, legendBand, offset, spot, union, type MapTarget, type Rect } from "../../intro";

/** How long the map waits for the controls of the form (its page loads in a frame) before showing what it found. */
const WAIT_MILLIS = 2500;
/** With this many of its controls found, the map shows at once. */
const ENOUGH = 3;
/** The frame of the form of the plot open (FormPanel) */
const FRAME = "iframe[data-testid=form-frame]";

interface Found { target: MapTarget; box: Rect }

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** The controls of the map that are on the page now, each with the box to draw around it. */
function measure(targets: readonly MapTarget[]): Found[] {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const frame = document.querySelector<HTMLIFrameElement>(FRAME);
  let inner: Document | null = null;
  // The form is a page of this server: its controls can be measured, in its frame's own coordinates
  try { inner = frame?.contentDocument ?? null; } catch { inner = null; }
  const found: Found[] = [];
  for (const target of targets) {
    const root: Document | null = target.frame ? inner : document;
    if (!root) continue;
    const rects = target.selectors.map((s) => root.querySelector(s)).filter((el): el is Element => el !== null).map(rectOf)
      .filter((r) => r.width > 0 && r.height > 0);
    const around = union(rects);
    if (!around) continue;
    const inPage = target.frame && frame ? offset(around, rectOf(frame)) : around;
    // Scrolled out of sight (a long list of steps): not pointed at
    if (inPage.top + inPage.height < 0 || inPage.top > viewport.height) continue;
    found.push({ target, box: spot(inPage, viewport) });
  }
  return found;
}

/**
 * The map of the screen: the panel dimmed, the controls that matter left bright and numbered, and one legend that says
 * what each is, all at once, with a single button to close it (a click anywhere else, or Esc, closes it too). Not a MUI
 * dialog: one would widen the panel's frame over Google Earth Web (panelDialogs.ts) and move what it points at.
 */
export function IntroMap({ kind, onDone, onChanges }: {
  kind: "list" | "form";
  onDone: () => void;
  /** Opens "What changed from Collect Earth 1" (the link under the legend) */
  onChanges: () => void;
}) {
  const t = useT();
  const targets = kind === "list" ? LIST_MAP : FORM_MAP;
  const [found, setFound] = useState<Found[] | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const titleId = useId();
  const maskId = useId();
  const button = useRef<HTMLButtonElement>(null);

  // Measured once the controls are there (the form's load in their frame), and again when the window changes
  const read = useCallback(() => {
    setViewport({ width: window.innerWidth, height: window.innerHeight });
    return measure(targets);
  }, [targets]);
  useLayoutEffect(() => {
    const started = Date.now();
    let timer: number | undefined;
    const attempt = () => {
      const now = read();
      if (now.length >= Math.min(ENOUGH, targets.length) && (kind === "list" || now.some((f) => f.target.frame)) || Date.now() - started > WAIT_MILLIS) {
        setFound(now);
      } else {
        timer = window.setTimeout(attempt, 150);
      }
    };
    attempt();
    const onResize = () => setFound(read());
    window.addEventListener("resize", onResize);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", onResize); };
  }, [read, kind, targets.length]);

  // Its button has the focus, and gives it back; Esc closes
  useEffect(() => {
    if (!found) return;
    const before = document.activeElement as HTMLElement | null;
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onDone();
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); before?.focus?.(); };
  }, [found !== null, onDone]);

  if (!found) return null;
  // Nothing to point at (the page changed meanwhile): nothing is shown, and it is not counted as seen
  if (found.length === 0) return null;
  const band = legendBand(found.map((f) => f.box), viewport);
  const width = Math.min(viewport.width - 24, 440);

  return createPortal(
    <Box role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid={"intro-map-" + kind}
      onClick={onDone} sx={{ position: "fixed", inset: 0, zIndex: 1400 }}>
      {/* The page dimmed but for the controls */}
      <Box component="svg" aria-hidden width={viewport.width} height={viewport.height} sx={{ position: "absolute", inset: 0, display: "block" }}>
        <defs>
          <mask id={maskId}>
            <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="white" />
            {found.map(({ target, box }) => <rect key={target.id} x={box.left} y={box.top} width={box.width} height={box.height} rx={8} fill="black" />)}
          </mask>
        </defs>
        <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="rgba(16, 24, 40, 0.66)" mask={`url(#${maskId})`} />
        {found.map(({ target, box }) => (
          <rect key={target.id} x={box.left} y={box.top} width={box.width} height={box.height} rx={8} fill="none" stroke="#fff" strokeWidth={2} />
        ))}
      </Box>
      {found.map(({ target, box }, i) => {
        const at = badgeAt(box, viewport);
        return <Number key={target.id} n={i + 1} sx={{ position: "absolute", left: at.left, top: at.top }} />;
      })}
      <Paper elevation={8} onClick={(e) => e.stopPropagation()} data-testid="intro-legend" sx={{
        position: "absolute", top: band.top, left: Math.max(12, (viewport.width - width) / 2), width,
        maxHeight: band.height, overflowY: "auto", p: 2, borderRadius: 2,
      }}>
        <Typography id={titleId} variant="subtitle1" component="h2" sx={{ fontWeight: 600, mb: 1 }}>{t(kind === "list" ? "intro.list.title" : "intro.form.title")}</Typography>
        <Stack component="ol" spacing={0.75} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {found.map(({ target }, i) => (
            <Stack key={target.id} component="li" direction="row" spacing={1} sx={{ alignItems: "flex-start" }} data-intro-item={target.id}>
              <Number n={i + 1} sx={{ mt: "1px" }} />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{t(target.text)}</Typography>
            </Stack>
          ))}
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mt: 1.5, flexWrap: "wrap", rowGap: 1 }}>
          <Button ref={button} variant="contained" disableElevation onClick={onDone} data-testid="intro-got-it">{t("intro.gotIt")}</Button>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 160 }}>{t("intro.again")}</Typography>
        </Stack>
        <Link component="button" type="button" variant="caption" onClick={onChanges} data-testid="intro-changes-link" sx={{ mt: 1, textAlign: "left" }}>
          {t("intro.changesLink")}
        </Link>
      </Paper>
    </Box>,
    document.body,
  );
}

/** A number in a disc: on a control, and beside its line of the legend. */
function Number({ n, sx }: { n: number; sx?: object }) {
  return (
    <Box aria-hidden sx={{
      width: BADGE, height: BADGE, flex: "none", borderRadius: "50%", bgcolor: "primary.main", color: "primary.contrastText",
      border: "2px solid #fff", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums", boxShadow: 2, ...sx,
    }}>{n}</Box>
  );
}
