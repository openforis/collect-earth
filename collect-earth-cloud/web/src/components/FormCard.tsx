import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { FormEvent, ReactNode } from "react";
import { WEBSITE_HEADING } from "./HeroPanel";

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
  plain = false,
}: {
  title: string;
  level?: 1 | 2;
  /** without its card, inside one of its own (HeroPanel), with the website's headings */
  plain?: boolean;
  intro?: ReactNode;
  onSubmit: () => void;
  children: ReactNode;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  const form = (
    <Stack component="form" spacing={2.5} onSubmit={submit} noValidate>
      <Typography variant={level === 1 ? "h1" : "h2"} sx={plain ? WEBSITE_HEADING : undefined}>
        {title}
      </Typography>
      {intro && <Typography color="text.secondary">{intro}</Typography>}
      {children}
    </Stack>
  );
  return plain ? form : <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>{form}</Paper>;
}
