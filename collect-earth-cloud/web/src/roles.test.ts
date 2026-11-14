import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Me, Role, ServerInfo } from "./api";
import { AppContext, type AppState } from "./appContext";
import { ROLE_MATRIX, ROLE_ORDER, RoleChip, RolesContent, ServerAdminChip } from "./components/Roles";
import { I18nContext, translator, type Language } from "./i18n";

/** The markup of a component, for someone signed in (a server administrator or not), on a server or in the local mode. */
function render(node: ReactElement, { local = false, platformAdmin = false, language = "en" as Language } = {}): string {
  const me: Me = { userId: "u1", username: "ana", memberships: [], isPlatformAdmin: platformAdmin, announcement: null, twoFactor: { enabled: false, required: false } };
  const state = { info: { localMode: local } as ServerInfo, me, language } as AppState;
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: translator(language) }, createElement(AppContext.Provider, { value: state }, node)));
}

const ICONS: Record<Role, string> = { admin: "ManageAccountsOutlinedIcon", reviewer: "RateReviewOutlinedIcon", operator: "EditLocationAltOutlinedIcon" };
const NAMES: Record<Role, string> = { admin: "Coordinator", reviewer: "Reviewer", operator: "Collector" };

describe("the role chip in a project's header", () => {
  it.each(ROLE_ORDER)("%s: says the person's role, with the role's icon and an accessible name", (role) => {
    const html = render(createElement(RoleChip, { role }));
    expect(html).toContain(`You: ${NAMES[role]}`);
    expect(html).toContain(`aria-label="You: ${NAMES[role]}, your role in this project"`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(ICONS[role]);
  });

  it("is in the person's language", () => {
    expect(render(createElement(RoleChip, { role: "operator" }), { language: "es" })).toContain("Usted: Recolector");
    expect(render(createElement(RoleChip, { role: "reviewer" }), { language: "tr" })).toContain("Siz: Denetçi");
  });

  it("is not there in the local mode: one person, no accounts or roles", () => {
    for (const role of ROLE_ORDER) expect(render(createElement(RoleChip, { role }), { local: true })).toBe("");
  });
});

describe("the server administrator's badge", () => {
  it("is shown to a server administrator", () => {
    const html = render(createElement(ServerAdminChip), { platformAdmin: true });
    expect(html).toContain("Server administrator");
    expect(html).toContain("DnsIcon");
  });

  it("is not shown to anyone else, nor in the local mode", () => {
    expect(render(createElement(ServerAdminChip))).toBe("");
    expect(render(createElement(ServerAdminChip), { platformAdmin: true, local: true })).toBe("");
  });
});

describe("what each role can do", () => {
  it("names the three roles and marks the reader's own column only", () => {
    const html = render(createElement(RolesContent, { role: "reviewer" }));
    for (const role of ROLE_ORDER) expect(html).toContain(NAMES[role]);
    expect(html).toContain("Reviewer (you)");
    expect(html).not.toContain("Coordinator (you)");
    expect(html.match(/\(you\)/g)).toHaveLength(1);
  });

  it("lists every row and explains server administrators apart, as not a project role", () => {
    const t = translator("en");
    const html = render(createElement(RolesContent, {}));
    for (const row of ROLE_MATRIX) expect(html).toContain(t(row.what).replace(/'/g, "&#x27;"));
    expect(html).toContain("Server administrator");
    expect(html).toContain("Not a role in a project");
    expect(html).toContain("Yes, the plots they give themselves");
    // checks and reference copies: collectors by default (src/sampling.ts checkersOf, src/reference.ts getsReferenceCopy)
    expect(html).toContain("By default, quality checks go to collectors only, and only collectors get copies of reference plots.");
    expect(html).toContain('<title>Yes</title>');
    expect(html).toContain('<title>No</title>');
  });

  it("follows what the server allows: coordinators everything, the project's set-up only theirs, everyone collects", () => {
    const cell = (what: string, role: Role) => ROLE_MATRIX.find((r) => r.what === what)!.cells[role];
    for (const row of ROLE_MATRIX) expect(row.cells.admin, row.what).not.toBe("no");
    // Coordinators collect too, the plots they give themselves
    expect(cell("roles.row.collect", "admin")).toBe("roles.cell.collectSelf");
    expect(cell("roles.row.collect", "reviewer")).toBe("yes");
    expect(cell("roles.row.collect", "operator")).toBe("yes");
    for (const what of ["roles.row.plots", "roles.row.projectFile", "roles.row.people", "roles.row.data", "roles.row.settings"]) {
      expect(cell(what, "reviewer"), what).toBe("no");
      expect(cell(what, "operator"), what).toBe("no");
    }
    // Collectors: their own records only, no review queue, no areas (src/routes/analysis.ts, quality.ts, areas.ts)
    expect(cell("roles.row.analysis", "operator")).toBe("roles.cell.ownPlots");
    expect(cell("roles.row.review", "operator")).toBe("no");
    expect(cell("roles.row.areas", "operator")).toBe("no");
  });
});
