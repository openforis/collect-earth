import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { APP_INFO_CHANGED, changesAppInfo, nextNotice, NOTICES_POLL_MILLIS, opensSendToCloud, SEND_TO_CLOUD, splitOptions, type Notice } from "../../notices";
import { answerNotice, readNotices } from "../../noticesApi";

/**
 * The notices of the server (NoticeService), one at a time, as the Swing window showed them in dialogs: polled while
 * the page is visible, answered with the option chosen. A read that fails is tried again at the next poll: the server
 * may be restarting.
 */
export function NoticeDialog() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const answered = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);

  const poll = useCallback((signal: AbortSignal) => {
    if (document.visibilityState !== "visible") return;
    readNotices(signal).then((list) => { if (!signal.aborted) setNotices(list); }, () => { /* next time */ });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    poll(controller.signal);
    const timer = window.setInterval(() => poll(controller.signal), NOTICES_POLL_MILLIS);
    const onVisible = () => poll(controller.signal);
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [poll]);

  const notice = nextNotice(notices, answered.current);
  const answer = (option: string) => {
    if (!notice) return;
    setBusy(true);
    answered.current.add(notice.id);
    // Gone already (answered from another page) is no error for this page
    answerNotice(notice.id, option).catch(() => undefined).finally(() => {
      setBusy(false);
      setNotices((list) => list.filter((n) => n.id !== notice.id));
      if (changesAppInfo(notice)) window.dispatchEvent(new Event(APP_INFO_CHANGED));
      if (opensSendToCloud(notice, option)) window.dispatchEvent(new Event(SEND_TO_CLOUD));
    });
  };
  if (!notice) return null;
  const Icon = notice.severity === "error" ? ErrorOutlineIcon : notice.severity === "warning" ? WarningAmberIcon : InfoOutlinedIcon;
  const color = notice.severity === "error" ? "error.main" : notice.severity === "warning" ? "warning.main" : "info.main";
  // The choices (the files to work on, say) are listed under the message, one to pick; the other options are the buttons
  const { choices, buttons } = splitOptions(notice.options);

  return (
    <Dialog open fullWidth maxWidth="sm" data-testid="notice-dialog" data-kind={notice.kind}>
      <DialogTitle>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Icon sx={{ color }} />
          <span>{notice.title}</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        {notice.html
          // The HTML comes from Collect Earth's own server and the Open Foris announcements, as the Swing dialogs showed it
          ? <Box sx={{ "& p": { mt: 0 }, "& h2": { fontSize: "1.1rem", mt: 0 } }} dangerouslySetInnerHTML={{ __html: notice.message }} />
          : <Typography component="pre" variant="body2" sx={{ m: 0, whiteSpace: "pre-wrap", fontFamily: notice.kind === "error" ? "monospace" : "inherit", maxHeight: 360, overflow: "auto" }}>{notice.message}</Typography>}
        {choices.length > 0 && (
          <List dense data-testid="notice-choices" sx={{ mt: 1.5, border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 280, overflow: "auto", py: 0 }}>
            {choices.map((o, i) => (
              <ListItemButton key={o.id} onClick={() => answer(o.id)} disabled={busy} divider={i < choices.length - 1} autoFocus={i === 0}>
                <ListItemText primary={o.label} secondary={o.detail} slotProps={{ primary: { sx: { fontWeight: 500 } } }} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        {/* with choices to pick from, the buttons are the ways out (Later): none is the main one */}
        {buttons.map((o, i) => (
          <Button key={o.id} onClick={() => answer(o.id)} disabled={busy} variant={choices.length === 0 && i === buttons.length - 1 ? "contained" : "text"}>{o.label}</Button>
        ))}
      </DialogActions>
    </Dialog>
  );
}
