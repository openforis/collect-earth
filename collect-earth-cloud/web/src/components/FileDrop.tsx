import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import UploadFile from "@mui/icons-material/UploadFileOutlined";
import { useRef, useState, type DragEvent } from "react";

interface Props {
  /** "Drag the .cep file here" */
  label: string;
  buttonLabel: string;
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}

/**
 * A slim drop strip with its button, for people who do not drag and drop: one line, the size of a text field, so it
 * reads as one more way to give a file rather than as the page's main content. It lights up while a file is dragged over.
 */
export function FileDrop({ label, buttonLabel, accept, multiple, disabled, onFiles }: Props) {
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
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 1.5,
        border: "1px dashed",
        borderColor: over ? "primary.main" : "divider",
        bgcolor: over ? "action.hover" : "transparent",
        borderRadius: 1,
        px: 1.5,
        py: 1,
        opacity: disabled ? 0.6 : 1,
        transition: "border-color 120ms, background-color 120ms",
      }}
    >
      <UploadFile fontSize="small" color={over ? "primary" : "action"} aria-hidden />
      <Typography variant="body2" color="text.secondary" sx={{ flex: "1 1 200px", minWidth: 0 }}>
        {label}
      </Typography>
      <Button variant="outlined" size="small" disabled={disabled} onClick={() => input.current?.click()}>
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
