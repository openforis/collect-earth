import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import CloudUpload from "@mui/icons-material/CloudUpload";
import { useRef, useState, type DragEvent } from "react";
import { useT } from "../i18n";

interface Props {
  /** "Drag the .cep file here" */
  label: string;
  buttonLabel: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/** A drop area plus a button, for people who do not drag and drop. */
export function FileDrop({ label, buttonLabel, accept, multiple, disabled, onFiles }: Props) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!disabled) take(event.dataTransfer.files);
  };

  return (
    <Box
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      sx={{
        border: "2px dashed",
        borderColor: over ? "primary.main" : "divider",
        bgcolor: over ? "action.hover" : "background.paper",
        borderRadius: 2,
        p: { xs: 2, sm: 4 },
        textAlign: "center",
        transition: "border-color 120ms, background-color 120ms",
      }}
    >
      <CloudUpload color={over ? "primary" : "action"} sx={{ fontSize: 44 }} aria-hidden />
      <Typography sx={{ mt: 1 }}>{label}</Typography>
      <Typography color="text.secondary" sx={{ my: 1 }}>
        {t("common.or")}
      </Typography>
      <Button variant="outlined" disabled={disabled} onClick={() => input.current?.click()}>
        {buttonLabel}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        aria-label={buttonLabel}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </Box>
  );
}
