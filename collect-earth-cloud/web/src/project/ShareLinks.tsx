import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddLink from "@mui/icons-material/AddLink";
import LinkOff from "@mui/icons-material/LinkOff";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createShareLink, listShareLinks, revokeShareLink, type NewShareLink, type ShareLink } from "../api";
import { useApp } from "../appContext";
import { CopyField } from "../components/CopyField";
import { ErrorAlert } from "../components/ErrorAlert";
import { Loading } from "../components/Loading";
import { formatDate } from "../format";
import { useT } from "../i18n";
import { useLoad } from "../useLoad";

/** As the server keeps it (share_links.label). */
export const MAX_LABEL_LENGTH = 100;

function LinkRow({ link, onRevoke }: { link: ShareLink; onRevoke: (link: ShareLink) => Promise<void> }) {
  const t = useT();
  const { language } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // After Cancel, the keyboard goes back to the Revoke button it came from.
  const revokeButton = useRef<HTMLButtonElement>(null);
  const [backToRevoke, setBackToRevoke] = useState(false);
  useEffect(() => {
    if (!confirming && backToRevoke) {
      revokeButton.current?.focus();
      setBackToRevoke(false);
    }
  }, [confirming, backToRevoke]);
  const made = link.createdAt !== null ? formatDate(link.createdAt, language) : "–";
  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onRevoke(link);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <Paper variant="outlined" component="li" sx={{ p: 2, listStyle: "none" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 500, wordBreak: "break-word" }}>{link.label || t("shareLinks.noLabel")}</Typography>
          <Typography variant="body2" color="text.secondary">
            {link.createdBy ? t("shareLinks.madeBy", { time: made, name: link.createdBy }) : t("shareLinks.made", { time: made })}
            {" · "}
            {link.lastUsedAt !== null ? t("shareLinks.lastOpened", { time: formatDate(link.lastUsedAt, language) }) : t("shareLinks.neverOpened")}
          </Typography>
        </Box>
        {confirming ? (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button color="error" variant="contained" onClick={() => void revoke()} aria-describedby={`revoke-${link.id}`} autoFocus>
              {t("shareLinks.revokeConfirm")}
            </Button>
            <Button
              onClick={() => {
                setConfirming(false);
                setBackToRevoke(true);
              }}
            >
              {t("common.cancel")}
            </Button>
          </Stack>
        ) : (
          <Button ref={revokeButton} color="error" startIcon={<LinkOff />} onClick={() => setConfirming(true)} sx={{ flexShrink: 0 }}>
            {t("shareLinks.revoke")}
          </Button>
        )}
      </Stack>
      {confirming && (
        <Typography id={`revoke-${link.id}`} variant="body2" sx={{ mt: 1 }}>
          {t("shareLinks.revokeText")}
        </Typography>
      )}
    </Paper>
  );
}

/**
 * Settings tab: read-only progress links for funders (Task 18). A coordinator makes one (its
 * address is shown once, to copy), sees when each was made and last opened, and revokes them.
 */
export function ShareLinksCard({ projectId }: { projectId: string }) {
  const t = useT();
  const links = useLoad(() => listShareLinks(projectId), [projectId]);
  const [label, setLabel] = useState("");
  const [made, setMade] = useState<NewShareLink | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  // After a revoke the row is gone: the keyboard goes to the card's heading.
  const heading = useRef<HTMLHeadingElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const next = await createShareLink(projectId, label.trim());
      setMade(next);
      setLabel("");
      links.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (link: ShareLink) => {
    setError(null);
    try {
      await revokeShareLink(projectId, link.id);
      if (made?.link.id === link.id) setMade(null);
      setStatus(t("shareLinks.revoked", { label: link.label || t("shareLinks.noLabel") }));
      heading.current?.focus();
      links.reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }} component="section" aria-labelledby="share-links-title">
      <Stack spacing={2}>
        <Typography variant="h2" id="share-links-title" ref={heading} tabIndex={-1} sx={{ outline: "none" }}>
          {t("shareLinks.title")}
        </Typography>
        <Typography>{t("shareLinks.intro")}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t("shareLinks.never")} {t("shareLinks.logs")}
        </Typography>
        <Stack component="form" direction={{ xs: "column", sm: "row" }} spacing={1} onSubmit={submit} noValidate sx={{ alignItems: { sm: "flex-start" } }}>
          <TextField
            label={t("shareLinks.label")}
            placeholder={t("shareLinks.labelExample")}
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, MAX_LABEL_LENGTH))}
            helperText={t("shareLinks.labelHelp")}
            slotProps={{ htmlInput: { maxLength: MAX_LABEL_LENGTH } }}
          />
          <Button type="submit" variant="contained" startIcon={<AddLink />} disabled={busy} sx={{ flexShrink: 0, py: 1.75 }}>
            {t("shareLinks.create")}
          </Button>
        </Stack>
        {made && (
          <Alert severity="success" role="status">
            <Stack spacing={1.5}>
              <Typography>{t("shareLinks.copyOnce")}</Typography>
              <CopyField value={made.url} label={made.link.label || t("shareLinks.noLabel")} />
            </Stack>
          </Alert>
        )}
        {status && (
          <Alert severity="info" role="status">
            {status}
          </Alert>
        )}
        <ErrorAlert error={error} />
        {links.loading && !links.data ? (
          <Loading />
        ) : !links.data ? (
          <ErrorAlert error={links.error} onRetry={links.reload} />
        ) : links.data.length === 0 ? (
          <Typography color="text.secondary">{t("shareLinks.none")}</Typography>
        ) : (
          <Stack component="ul" spacing={1} sx={{ m: 0, p: 0 }} aria-label={t("shareLinks.listLabel")}>
            {links.data.map((link) => (
              <LinkRow key={link.id} link={link} onRevoke={revoke} />
            ))}
          </Stack>
        )}
      </Stack>
    </Paper>
  );
}
