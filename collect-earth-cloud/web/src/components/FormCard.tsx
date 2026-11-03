import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { FormEvent, ReactNode } from "react";

/**
 * A titled card holding a form (log in, setup, password…). Its title is the page's h1 when the card
 * is the page; level 2 when the card sits under a page heading of its own (the account page).
 */
export function FormCard({
  title,
  intro,
  onSubmit,
  children,
  level = 1,
}: {
  title: string;
  level?: 1 | 2;
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
        <Typography variant={level === 1 ? "h1" : "h2"}>{title}</Typography>
        {intro && <Typography color="text.secondary">{intro}</Typography>}
        {children}
      </Stack>
    </Paper>
  );
}
