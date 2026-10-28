import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { FormEvent, ReactNode } from "react";

/** A titled card holding a form (log in, setup, password…). */
export function FormCard({
  title,
  intro,
  onSubmit,
  children,
}: {
  title: string;
  intro?: ReactNode;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
      <Stack component="form" spacing={2.5} onSubmit={submit} noValidate>
        <Typography variant="h1">{title}</Typography>
        {intro && <Typography color="text.secondary">{intro}</Typography>}
        {children}
      </Stack>
    </Paper>
  );
}
