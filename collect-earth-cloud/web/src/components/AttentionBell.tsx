import Badge from "@mui/material/Badge";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Popover from "@mui/material/Popover";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import NotificationsNone from "@mui/icons-material/NotificationsNone";
import { useEffect, useId, useState } from "react";
import { getAttention, markAttentionRead, type BellData, type BellItem } from "../api";
import { useApp } from "../appContext";
import { useT } from "../i18n";
import { attentionAction, attentionText } from "../progressView";
import { navigate, pathFor } from "../router";
import { onceVisibleAfter } from "../visibility";
import { ErrorAlert } from "./ErrorAlert";

/** The bell is asked again this long after each load, while the page is visible. */
const BELL_REFRESH_MS = 120_000;

function BellRow({ projectId, entry, onRead, onClose }: { projectId: string; entry: BellItem; onRead: (key: string) => void; onClose: () => void }) {
  const t = useT();
  const { language } = useApp();
  const { title, text } = attentionText(t, entry.item, language);
  const action = attentionAction(t, entry.item.kind);
  return (
    <Box component="li" sx={{ py: 1.5, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Typography variant="subtitle2" component="h3" sx={{ fontWeight: entry.read ? 400 : 700 }}>
          {title}
        </Typography>
        {!entry.read && <Chip size="small" color="primary" label={t("bell.new")} />}
      </Stack>
      {text.map((s) => (
        <Typography key={s} variant="body2" color="text.secondary">
          {s}
        </Typography>
      ))}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => {
            onClose();
            navigate(pathFor({ name: "project", projectId, tab: action.tab }));
          }}
        >
          {action.label}
        </Button>
        {!entry.read && (
          <Button size="small" onClick={() => onRead(entry.key)}>
            {t("bell.markRead")}
          </Button>
        )}
      </Stack>
    </Box>
  );
}

/**
 * The bell in the project's header (coordinators): the Progress tab's "needs attention" items,
 * each new until this coordinator marks it read, and new again when what it says changes.
 */
export function AttentionBell({ projectId }: { projectId: string }) {
  const t = useT();
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<BellData | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    getAttention(projectId).then(
      (d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      },
      (err: unknown) => {
        if (live) setError(err);
      },
    );
    const stop = onceVisibleAfter(BELL_REFRESH_MS, document, () => setTick((n) => n + 1));
    return () => {
      live = false;
      stop();
    };
  }, [projectId, tick]);

  const mark = async (keys: string[]) => {
    try {
      setData(await markAttentionRead(projectId, keys));
    } catch (err) {
      setError(err);
    }
  };
  const unread = data?.unread ?? 0;
  const label = unread > 0 ? t("bell.labelUnread", { n: unread }) : t("bell.label");
  const open = anchor !== null;
  return (
    <>
      <Tooltip title={label}>
        <IconButton
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={(e) => {
            setAnchor(e.currentTarget);
            setTick((n) => n + 1);
          }}
        >
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsNone />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        id={id}
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { role: "dialog", "aria-label": t("bell.title"), sx: { width: 380, maxWidth: "calc(100vw - 32px)", maxHeight: "70vh", p: 2 } } }}
      >
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", mb: 1, gap: 1, flexWrap: "wrap" }}>
          <Typography variant="h3" component="h2">
            {t("bell.title")}
          </Typography>
          {unread > 0 && (
            // The items shown: one that arrived or changed since this list was loaded stays new.
            <Button size="small" onClick={() => void mark(data!.items.filter((x) => !x.read).map((x) => x.key))}>
              {t("bell.markAll")}
            </Button>
          )}
        </Stack>
        {error !== null && <ErrorAlert error={error} />}
        {data && data.items.length === 0 && <Typography variant="body2">{t("bell.none")}</Typography>}
        {data && data.items.length > 0 && (
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
            {data.items.map((entry) => (
              <BellRow key={entry.key} projectId={projectId} entry={entry} onRead={(key) => void mark([key])} onClose={() => setAnchor(null)} />
            ))}
          </Box>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("bell.help")}
        </Typography>
      </Popover>
    </>
  );
}
