import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { UiState } from "../../controller";
import { countStatuses } from "../../plots";
import { saveIntro } from "../../projectApi";
import { cardFor, tipFor, withSeen, withTips, type IntroCard, type IntroContext, type IntroInfo, type Tip } from "../../intro";
import { ChangesDialog } from "./ChangesDialog";
import { IntroMap } from "./IntroMap";
import { IntroTip } from "./IntroTip";

/** What Help asks for: the map of the screen again, or what changed; `key` tells two asks apart. */
export interface IntroAsk { what: "showAround" | "whatChanged"; key: number }

/** The page has to be the user's for this long before the introduction shows: it never flashes over a page still settling. */
const SETTLE_MILLIS = 700;

/** Something is open over the page: a dialog, the menu, a list of choices, or Collect Earth closing or starting again. */
const OVER_THE_PAGE = ".MuiModal-root:not(.MuiModal-hidden), [data-blocks-intro]";

function subscribeToBody(onChange: () => void) {
  // MUI renders what opens over the page in children of body, and hides one kept mounted with a class
  const observer = new MutationObserver(() => {
    Array.from(document.body.children).forEach((child) => observer.observe(child, { attributes: true, attributeFilter: ["class"] }));
    onChange();
  });
  observer.observe(document.body, { childList: true });
  Array.from(document.body.children).forEach((child) => observer.observe(child, { attributes: true, attributeFilter: ["class"] }));
  return () => observer.disconnect();
}

function useNothingOverThePage(): boolean {
  return useSyncExternalStore(subscribeToBody, () => document.querySelector(OVER_THE_PAGE) === null, () => true);
}

/**
 * The introduction to the interface (intro.ts): what changed from Collect Earth 1, the map of the screen, and the tips,
 * each shown once, when the page is the user's and nothing is open over it. `intro` is what the server remembers; what
 * is shown here is saved there, and kept in `onIntro` meanwhile, so a failed save does not show it twice in a session.
 */
export function Intro({ intro, onIntro, usable, pane, state, cloud, ask }: {
  intro: IntroInfo | null;
  onIntro: (next: IntroInfo) => void;
  /** The app bar shows, with a project and a name or a sign-in, and the page is the plots' (not the settings') */
  usable: boolean;
  pane: "list" | "form";
  state: UiState;
  cloud: boolean;
  ask: IntroAsk | null;
}) {
  const clear = useNothingOverThePage();
  const [card, setCard] = useState<IntroCard | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const lastTipAt = useRef<number | null>(null);
  // The tips whose control was not on the page, left for another session
  const [skipped, setSkipped] = useState<string[]>([]);
  // The plots opened since the page loaded
  const opened = useRef(0);
  const [openedCount, setOpenedCount] = useState(0);
  useEffect(() => { if (state.activeId != null) setOpenedCount(++opened.current); }, [state.activeId]);

  // Settled: usable and clear for a while. A card of its own does not unsettle it (the page of what changed is a dialog)
  const [settled, setSettled] = useState(false);
  const steady = usable && (clear || card !== null);
  useEffect(() => {
    if (!steady) { setSettled(false); return; }
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MILLIS);
    return () => window.clearTimeout(timer);
  }, [steady]);

  const counts = useMemo(() => countStatuses(state.order, state.statuses), [state.order, state.statuses, state.statusesVersion]);
  const ctx: IntroContext = useMemo(() => ({
    intro: intro && skipped.length ? withSeen(intro, skipped) : intro,
    ready: settled, pane, plots: state.loaded ? counts.total : 0, saved: counts.saved, cloud,
    toCorrect: state.corrections ? 0 : state.toCorrect, training: state.training != null && state.order.length > 0, opened: openedCount,
  }), [intro, skipped, settled, pane, state.loaded, counts, cloud, state.corrections, state.toCorrect, state.training, state.order.length, openedCount]);

  const seen = useCallback((ids: string[]) => {
    if (!intro) return;
    onIntro(withSeen(intro, ids));
    saveIntro({ seen: ids }).catch(() => { /* shown once in this session all the same; the next one may show it again */ });
  }, [intro, onIntro]);

  // What is due, once nothing of the introduction shows
  useEffect(() => {
    if (card !== null || !settled) return;
    const due = cardFor(ctx);
    if (due) { setTip(null); setCard(due); return; }
    if (tip === null) {
      const next = tipFor(ctx, Date.now(), lastTipAt.current);
      if (next) setTip(next);
    }
  }, [ctx, card, tip, settled]);

  // A tip goes when something opens over the page or the pane changes, without counting as shown
  useEffect(() => { if (tip && (!clear || !usable)) setTip(null); }, [tip, clear, usable]);
  useEffect(() => { setTip((now) => (now && now.pane !== "any" && now.pane !== pane ? null : now)); }, [pane]);
  // ...and, shown over a form, when another plot is opened: the clicks in the form are its frame's, not this page's
  const tipPlot = useRef<string | null>(null);
  useEffect(() => {
    if (!tip) { tipPlot.current = null; return; }
    if (tipPlot.current === null) { tipPlot.current = state.activeId ?? ""; return; }
    if (tipPlot.current !== (state.activeId ?? "")) doneTip();
  });

  // Help: the map of the pane in sight again, or what changed (the menu has closed by the time it shows)
  useEffect(() => {
    if (!ask) return;
    setTip(null);
    setCard(ask.what === "whatChanged" ? "changes" : pane === "form" ? "map.form" : "map.list");
    // only a new ask opens it again
  }, [ask?.key]);

  function doneTip() {
    if (!tip) return;
    lastTipAt.current = Date.now();
    seen([tip.id]);
    setTip(null);
  }
  const offTips = () => {
    if (!intro || !tip) return;
    onIntro(withTips(withSeen(intro, [tip.id]), false));
    saveIntro({ seen: [tip.id], tips: false }).catch(() => { /* off in this session all the same */ });
    setTip(null);
  };
  const noAnchor = useCallback(() => { setTip((now) => { if (now) setSkipped((s) => [...s, now.id]); return null; }); }, []);
  const doneCard = (id: IntroCard) => { seen([id]); setCard(null); };

  if (!intro) return null;
  return (
    <>
      <ChangesDialog open={card === "changes"} onClose={() => doneCard("changes")}
        onShow={() => { seen(["changes"]); setCard(pane === "form" ? "map.form" : "map.list"); }} />
      {/* Not while something is open over the page (the menu closing, a notice): it comes back once that is gone */}
      {(card === "map.list" || card === "map.form") && clear && (
        <IntroMap key={card} kind={card === "map.list" ? "list" : "form"} onDone={() => doneCard(card)}
          onChanges={() => { seen([card]); setCard("changes"); }} />
      )}
      {tip && card === null && <IntroTip key={tip.id} tip={tip} onDone={doneTip} onOff={offTips} onNoAnchor={noAnchor} />}
    </>
  );
}
