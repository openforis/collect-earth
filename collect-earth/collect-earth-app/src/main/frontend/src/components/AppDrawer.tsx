import { Fragment, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import logo from "../form/collect-earth-logo.png";
import { comingSoon } from "../appBar";
import { useT } from "../i18n";
import { drawerSections, nextEntry, type Menu, type MenuItem } from "../menus";
import { MenuEntryIcon } from "../menuIcons";
import { serverText, type Texts } from "../serverTexts";

export const DRAWER_ID = "app-drawer";

interface Props {
  open: boolean;
  onClose: () => void;
  menus: Menu[];
  project: string | null | undefined;
  texts: Texts | null;
  /** The state of the toggles, by id */
  toggles: Record<string, boolean>;
  onRun: (item: MenuItem) => void;
}

/**
 * The menus of the compact bar (a narrow window, Google Earth Web's panel): a navigation drawer, every entry with its
 * icon, the everyday menus first and the rare ones folded (menus.ts, drawerSections), Quit last. The keys of a menu move
 * through it (up, down, Home, End), Tab too; Esc closes it, and the focus goes back to the button that opened it.
 */
export function AppDrawer({ open, onClose, menus, project, texts, toggles, onRun }: Props) {
  const t = useT();
  const s = (key: string) => serverText(texts, key);
  const { sections, quit } = useMemo(() => drawerSections(menus), [menus]);
  // The folded menus unfolded, kept from one opening to the next
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  let first = true;

  const onKeyDown = (e: KeyboardEvent) => {
    const entries = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-drawer-entry]:not(.Mui-disabled)") ?? []);
    const next = nextEntry(entries.indexOf(document.activeElement as HTMLElement), entries.length, e.key);
    if (next === null) return;
    e.preventDefault();
    entries[next].focus();
  };

  const entry = (item: MenuItem): ReactNode => {
    const soon = comingSoon(item);
    const toggle = item.kind === "toggle";
    // The first entry has the focus as the drawer opens, as the first of a menu has
    const autoFocus = first && !soon;
    if (autoFocus) first = false;
    return (
      <ListItemButton key={item.id} data-drawer-entry disabled={soon} autoFocus={autoFocus} onClick={() => onRun(item)}
        {...(toggle && !soon ? { role: "switch", "aria-checked": toggles[item.id] ?? false } : {})}>
        <ListItemIcon sx={{ minWidth: 36 }}><MenuEntryIcon id={item.id} /></ListItemIcon>
        {/* "Coming soon" is written under the entry: a disabled one gets no pointer events for a tooltip */}
        <ListItemText primary={s(item.label)} secondary={soon ? t("appBar.comingSoon") : undefined} />
        {toggle && (
          <Checkbox edge="end" size="small" checked={!soon && (toggles[item.id] ?? false)} disabled={soon} tabIndex={-1}
            disableRipple sx={{ py: 0 }} slotProps={{ input: { "aria-hidden": true } }} />
        )}
      </ListItemButton>
    );
  };

  return (
    <Drawer anchor="left" open={open} onClose={onClose}
      slotProps={{ paper: { id: DRAWER_ID, sx: { width: 300, maxWidth: "calc(100vw - 48px)" } } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 1, minHeight: 48 }}>
        {/* The logo is drawn for a white background, also in the dark scheme */}
        <Box component="img" src={logo} alt="Open Foris Collect Earth"
          sx={{ height: 26, px: 0.5, py: "2px", bgcolor: "#fff", borderRadius: 1, flexShrink: 0 }} />
        <Typography variant="subtitle2" noWrap title={project ?? undefined} sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
          {project}
        </Typography>
        <IconButton edge="end" size="small" aria-label={t("appBar.closeMenu")} onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Divider />
      <Box component="nav" aria-label={t("appBar.menu")} ref={listRef} onKeyDown={onKeyDown} sx={{ flex: 1, overflowY: "auto" }}>
        <List dense disablePadding sx={{ pb: 1 }}>
          {sections.map((section, i) => {
            // A line between the menus with headings and the rest: a lone entry (Settings), then the folded ones
            const before = i > 0 && (!section.heading || section.folds) && !(section.folds && sections[i - 1].folds);
            if (!section.heading) {
              return <Fragment key={section.id}>{before && <Divider sx={{ my: 0.5 }} />}{section.items.map(entry)}</Fragment>;
            }
            if (!section.folds) {
              return (
                <Fragment key={section.id}>
                  <ListSubheader disableSticky sx={{ lineHeight: "32px", mt: i > 0 ? 0.5 : 0, bgcolor: "transparent" }}>{s(section.label)}</ListSubheader>
                  {section.items.map(entry)}
                </Fragment>
              );
            }
            const unfoldedNow = unfolded[section.id] ?? false;
            const listId = DRAWER_ID + "-" + section.id;
            return (
              <Fragment key={section.id}>
                {before && <Divider sx={{ my: 0.5 }} />}
                <ListItemButton data-drawer-entry aria-expanded={unfoldedNow} aria-controls={listId}
                  onClick={() => setUnfolded((u) => ({ ...u, [section.id]: !unfoldedNow }))}>
                  <ListItemText primary={s(section.label)}
                    slotProps={{ primary: { variant: "body2", sx: { fontWeight: 500, color: "text.secondary" } } }} />
                  {unfoldedNow ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </ListItemButton>
                <Collapse in={unfoldedNow} unmountOnExit id={listId}>
                  <List dense disablePadding>{section.items.map(entry)}</List>
                </Collapse>
              </Fragment>
            );
          })}
          {quit && <><Divider sx={{ my: 0.5 }} />{entry(quit)}</>}
        </List>
      </Box>
    </Drawer>
  );
}
