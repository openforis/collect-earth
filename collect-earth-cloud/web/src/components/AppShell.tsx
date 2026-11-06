import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import GlobalStyles from "@mui/material/GlobalStyles";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import AccountCircle from "@mui/icons-material/AccountCircle";
import Dns from "@mui/icons-material/Dns";
import FolderOpen from "@mui/icons-material/FolderOpen";
import Logout from "@mui/icons-material/Logout";
import Person from "@mui/icons-material/Person";
import Public from "@mui/icons-material/Public";
import Translate from "@mui/icons-material/Translate";
import { useState, type ReactNode } from "react";
import { useApp, useLocalMode } from "../appContext";
import { LANGUAGES, LANGUAGE_NAMES, useT, type Language } from "../i18n";
import { linkProps, navigate } from "../router";

export function LanguageMenu() {
  const t = useT();
  const { language, setLanguage } = useApp();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const choose = (l: Language) => {
    setLanguage(l);
    setAnchor(null);
  };
  return (
    <>
      <Button
        color="inherit"
        startIcon={<Translate />}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={t("nav.language")}
        aria-haspopup="menu"
        sx={{ minWidth: 0 }}
      >
        {language.toUpperCase()}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {LANGUAGES.map((l) => (
          <MenuItem key={l} selected={l === language} onClick={() => choose(l)} lang={l}>
            {LANGUAGE_NAMES[l]}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

function AccountMenu() {
  const t = useT();
  const { me, logOut } = useApp();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!me) return null;
  const go = (path: string) => {
    setAnchor(null);
    navigate(path);
  };
  return (
    <>
      <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)} aria-label={t("nav.accountMenu")} aria-haspopup="menu">
        <AccountCircle />
      </IconButton>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <MenuItem disabled sx={{ opacity: "1 !important" }}>
          <Typography variant="body2" color="text.secondary">
            {t("account.loggedInAs", { name: me.username })}
          </Typography>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => go("/")}>
          <ListItemIcon>
            <FolderOpen fontSize="small" />
          </ListItemIcon>
          {t("nav.projects")}
        </MenuItem>
        <MenuItem onClick={() => go("/account")}>
          <ListItemIcon>
            <Person fontSize="small" />
          </ListItemIcon>
          {t("nav.account")}
        </MenuItem>
        {me.isPlatformAdmin && (
          <MenuItem onClick={() => go("/server")}>
            <ListItemIcon>
              <Dns fontSize="small" />
            </ListItemIcon>
            {t("nav.server")}
          </MenuItem>
        )}
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void logOut();
          }}
        >
          <ListItemIcon>
            <Logout fontSize="small" />
          </ListItemIcon>
          {t("nav.logout")}
        </MenuItem>
      </Menu>
    </>
  );
}

/** Terms of use and the contact address, when the server administrator set them. */
function Footer() {
  const t = useT();
  const { info } = useApp();
  if (!info.termsUrl && !info.contactEmail) return null;
  return (
    <Box
      component="footer"
      sx={{ mt: "auto", py: 2, px: 2, display: "flex", gap: 3, justifyContent: "center", flexWrap: "wrap", color: "text.secondary" }}
    >
      {info.termsUrl && (
        <Link href={info.termsUrl} target="_blank" rel="noopener noreferrer" variant="body2" color="inherit">
          {t("footer.terms")}
        </Link>
      )}
      {info.contactEmail && (
        <Link href={`mailto:${info.contactEmail}`} variant="body2" color="inherit" sx={{ wordBreak: "break-word" }}>
          {t("footer.contact", { email: info.contactEmail })}
        </Link>
      )}
    </Box>
  );
}

/** Printed pages (the reports): no app bar, footer or buttons, on white, with margins on the paper. */
const PRINT_STYLES = {
  // Space between the paper's edge and the cards, whatever the browser's own margins.
  "@page": { margin: "15mm 12mm" },
  "@media print": {
    ".MuiAppBar-root, footer, .MuiButton-root, .MuiIconButton-root, .no-print": { display: "none !important" },
    "body, .app-page": { background: "#fff !important" },
    "main.MuiContainer-root": { maxWidth: "none !important", padding: "0 !important" },
    "a[href]": { color: "inherit", textDecoration: "none" },
  },
} as const;

/**
 * The app bar (name, language, account), the page column and the footer. `bare`: a public page
 * (the progress link) shows the server's name only, not as a link, and no account menu.
 */
/** `wide`: a page of tabs and tables (a project), which uses more of a large screen. */
export function AppShell({ children, narrow, bare, wide }: { children: ReactNode; narrow?: boolean; bare?: boolean; wide?: boolean }) {
  const t = useT();
  const { info } = useApp();
  // The local mode (one person, on their own computer): one account and one project, so no
  // account menu (no other project, account page, password or log-out).
  const local = useLocalMode();
  const name = local ? t("app.titleLocal") : (info.serverName ?? t("app.title"));
  return (
    <Box className="app-page" sx={{ minHeight: "100vh", bgcolor: "background.default", display: "flex", flexDirection: "column" }}>
      <GlobalStyles styles={PRINT_STYLES} />
      <AppBar position="sticky" color="primary">
        <Toolbar sx={{ gap: 1 }}>
          {bare ? (
            <Typography component="p" noWrap sx={{ fontSize: "1.1rem", fontWeight: 500, px: 1, mr: "auto", minWidth: 0, display: "flex", alignItems: "center", gap: 1 }}>
              <Public aria-hidden />
              {name}
            </Typography>
          ) : (
            <Button color="inherit" {...linkProps("/")} startIcon={<Public />} sx={{ fontSize: "1.1rem", px: 1, mr: "auto", minWidth: 0 }}>
              <Typography component="span" variant="inherit" noWrap>
                {name}
              </Typography>
            </Button>
          )}
          <LanguageMenu />
          {!bare && !local && <AccountMenu />}
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth={narrow ? "sm" : wide ? "lg" : "md"} sx={{ py: { xs: 2, sm: 4 }, px: { xs: 2, sm: 3 } }}>
        {children}
      </Container>
      <Footer />
    </Box>
  );
}
