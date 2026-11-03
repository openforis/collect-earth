import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Check from "@mui/icons-material/Check";
import ContentCopy from "@mui/icons-material/ContentCopy";
import { useRef, useState } from "react";
import { useT } from "../i18n";

async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission: select and copy.
    if (!input) return false;
    input.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/** A read-only link with a big copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (await copyText(value, input.current)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } else {
      input.current?.select();
    }
  };
  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { sm: "center" } }}>
      <TextField
        label={label}
        value={value}
        inputRef={input}
        onFocus={(e) => e.target.select()}
        slotProps={{ htmlInput: { readOnly: true, spellCheck: false, style: { fontFamily: "monospace" } } }}
      />
      <Button
        variant="contained"
        onClick={copy}
        startIcon={copied ? <Check /> : <ContentCopy />}
        sx={{ flexShrink: 0, minWidth: 150, py: 1.5 }}
      >
        <span aria-live="polite">{copied ? t("common.copied") : t("common.copyLink")}</span>
      </Button>
    </Stack>
  );
}
