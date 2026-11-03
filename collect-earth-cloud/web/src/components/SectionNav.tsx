import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import { useEffect, useState, type RefObject } from "react";

interface Entry {
  id: string;
  text: string;
}

/** The h2 headings directly in a page's sections, each given an id when it has none. */
function headingsOf(root: HTMLElement, prefix: string): Entry[] {
  return [...root.querySelectorAll<HTMLElement>("h2")].flatMap((h, i) => {
    const text = (h.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return [];
    if (!h.id) h.id = `${prefix}-${i}`;
    return [{ id: h.id, text }];
  });
}

/**
 * "On this page": a row of links to the sections (their h2 headings) of a long page, kept in sight
 * below the app bar on larger screens. Built from the headings shown, so a section that is not
 * there (no checks yet, no assistant) has no link. A link scrolls to its heading and gives it the focus.
 */
export function SectionNav({ root, label, prefix }: { root: RefObject<HTMLElement | null>; label: string; prefix: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const read = () =>
      setEntries((prev) => {
        const next = headingsOf(element, prefix);
        return prev.length === next.length && prev.every((e, i) => e.id === next[i].id && e.text === next[i].text) ? prev : next;
      });
    read();
    const observer = new MutationObserver(read);
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [root, prefix]);

  if (entries.length < 3) return null;
  const go = (id: string) => {
    const heading = document.getElementById(id);
    if (!heading) return;
    heading.scrollIntoView({ block: "start" });
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  };
  return (
    <Box
      component="nav"
      aria-label={label}
      className="no-print"
      sx={{
        position: { xs: "static", sm: "sticky" },
        top: { sm: 64 },
        zIndex: 2,
        bgcolor: "background.default",
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none", display: "flex", flexWrap: { xs: "nowrap", sm: "wrap" }, overflowX: { xs: "auto", sm: "visible" }, gap: 0.5 }}>
        {entries.map((e) => (
          <li key={e.id} style={{ flexShrink: 0 }}>
            <Link
              href={`#${e.id}`}
              onClick={(event) => {
                event.preventDefault();
                go(e.id);
              }}
              underline="hover"
              variant="body2"
              sx={{ display: "inline-block", px: 1, py: 0.5, borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "background.paper", whiteSpace: "nowrap" }}
            >
              {e.text}
            </Link>
          </li>
        ))}
      </Box>
    </Box>
  );
}
