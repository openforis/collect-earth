import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
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
import { useApp } from "../appContext";
import { LANGUAGES, LANGUAGE_NAMES, useT, type Language } from "../i18n";
import { linkProps, navigate } from "../router";

function LanguageMenu() {
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

/** The app bar (name, language, account) and the page column. */
export function AppShell({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  const t = useT();
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="primary">
        <Toolbar sx={{ gap: 1 }}>
          <Button color="inherit" {...linkProps("/")} startIcon={<Public />} sx={{ fontSize: "1.1rem", px: 1, mr: "auto", minWidth: 0 }}>
            <Typography component="span" variant="inherit" noWrap>
              {t("app.title")}
            </Typography>
          </Button>
          <LanguageMenu />
          <AccountMenu />
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth={narrow ? "sm" : "md"} sx={{ py: { xs: 2, sm: 4 }, px: { xs: 2, sm: 3 } }}>
        {children}
      </Container>
    </Box>
  );
}
