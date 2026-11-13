// The project calls of Setup (name, status, copy, the AI assistant, progress links) as the server
// answers them. Types only: see README.md in this folder.


/**
 * A project's lifecycle: draft (being set up: collectors cannot sync yet), active, closed (read-only:
 * no syncs, no changes; reading and exports work) and archived (closed and out of the normal list).
 */
export type ProjectStatus = 'draft' | 'active' | 'closed' | 'archived';

/** PUT /v1/projects/:pid/status */
export interface ProjectStatusAnswer {
  projectId: string;
  status: ProjectStatus;
}

/** PATCH /v1/projects/:pid (the new name) */
export interface ProjectRenameAnswer {
  projectId: string;
  name: string;
}

/** POST /v1/projects/:pid/copy: the new project, a draft. */
export interface ProjectCopyAnswer {
  projectId: string;
  name: string;
  status: 'draft';
}

/** GET and PUT /v1/projects/:pid/ai: whether the assistant is on, whether the server offers one, and where it runs. */
export interface ProjectAi {
  enabled: boolean;
  available: boolean;
  /** Who processes what is sent, and where (region "global": any of the provider's regions); null while unavailable. */
  where: { provider: string; model: string; region: string } | null;
}

/**
 * A read-only progress link of a project (Task 18), as coordinators list it. The token is shown
 * once, when it is made; only its sha256 is stored (share_links.token_hash).
 */
export interface ShareLink {
  id: string;
  /** The coordinator's note to tell links apart ("For the donor"); may be empty. */
  label: string;
  createdAt: number;
  /** The username of who made it; null for a project admin token or an account since deleted. */
  createdBy: string | null;
  /** When the page was last opened with it (kept to the minute); null when never. */
  lastUsedAt: number | null;
}

/** GET /v1/projects/:pid/share-links */
export interface ShareLinksAnswer {
  links: ShareLink[];
}

/** POST /v1/projects/:pid/share-links: the new link; its token and address are shown this once. */
export interface NewShareLinkAnswer {
  token: string;
  /** /p/<token> */
  path: string;
  /** The whole address to give out. */
  url: string;
  link: ShareLink;
}
