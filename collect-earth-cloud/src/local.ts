// The local mode (LOCAL_MODE=1): the dashboard Collect Earth runs on the person's own computer,
// for one person working alone (docs/plans/2026-11-03-desktop-dashboard.md, Task 3).
//
// - One account and one project, made at start (startLocal); the project's id is the one the
//   desktop keeps (LOCAL_PROJECT_ID), so the dashboard's links survive restarts. The state is in
//   memory: the desktop feeds it again from its own database at each start.
// - The desktop works with `apiToken`, a session of that account: records:batch, the project file
//   and the plot files go through the routes the cloud sync already uses, and the records are
//   stored under the account's username, as a signed-in collector's are in the cloud.
// - The browser signs in with a one-time link (/local-sign-in/<token>): the page it opens keeps a
//   new session where the dashboard keeps it (localStorage, web/src/storage.ts) and goes on to the
//   project's Progress tab. The desktop asks for a new link each time it opens the dashboard
//   (POST /v1/local/sign-in-links, with apiToken).
// - The routes about other people or about the server answer 404 (LOCAL_OFF_ROUTES).
import type { AddressInfo } from 'node:net';
import type { FastifyInstance, FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify';
import { isValidUsername } from './accountRules.js';
import { generateToken, hashToken } from './auth.js';
import type { Config } from './config.js';
import { hashPassword } from './password.js';
import { requireSession } from './plugins/projectAuth.js';
import type { InMemoryStore } from './store/memory.js';

/** What startLocal made: the one account, the one project and the desktop's credential. */
export interface LocalSetup {
  userId: string;
  username: string;
  projectId: string;
  /** A session of the account, for the desktop (Authorization: Bearer). */
  apiToken: string;
  signIn: LocalSignIn;
}

/** The project's name when LOCAL_PROJECT_NAME is not set. */
export const DEFAULT_LOCAL_PROJECT_NAME = 'My project';
/** How long a sign-in link can be opened. */
export const SIGN_IN_TTL_MS = 15 * 60 * 1000;
/** Sign-in links kept unused at most; the oldest goes first. */
const MAX_SIGN_IN_LINKS = 20;
/** Where the dashboard keeps its session (web/src/storage.ts, TOKEN_KEY). */
const WEB_SESSION_KEY = 'collectEarthCloud.session';

/**
 * The routes that answer 404 in the local mode: what is about other people (accounts, invitations,
 * roles, dividing plots, assignments, checks, reference plots, the review queue and its decisions,
 * progress links, mail) or about the server (setup, its owner's panel, the AI assistant). Each is
 * `METHOD path`, as the route is registered; a path here that no route has stops the start
 * (disableLocalOffRoutes), so the list cannot drift from the routes.
 */
export const LOCAL_OFF_ROUTES: readonly string[] = [
  // Accounts: the one account is made at start and has no password anyone knows.
  'POST /v1/setup',
  'POST /v1/auth/signup',
  'POST /v1/auth/register',
  'POST /v1/auth/login',
  'POST /v1/auth/reset',
  'POST /v1/auth/forgot',
  'GET /v1/auth/reset/:token',
  'PUT /v1/me/password',
  'GET /v1/me/deletion',
  'DELETE /v1/me',
  // The server owner's panel.
  'GET /v1/admin/settings',
  'PUT /v1/admin/settings',
  'GET /v1/admin/users',
  'GET /v1/admin/ai-usage',
  'GET /v1/admin/overview',
  'POST /v1/admin/users/:uid/disable',
  'POST /v1/admin/users/:uid/enable',
  'POST /v1/admin/users/:uid/password-reset',
  // One project, the desktop's.
  'POST /v1/projects',
  'DELETE /v1/projects/:pid',
  'PUT /v1/projects/:pid/status',
  'POST /v1/projects/:pid/copy',
  // Invitations and members.
  'POST /v1/projects/:pid/invites',
  'GET /v1/projects/:pid/invites',
  'DELETE /v1/projects/:pid/invites/:id',
  'GET /v1/join/:token',
  'PUT /v1/projects/:pid/members/:uid',
  'PUT /v1/projects/:pid/members/:uid/excluded',
  'DELETE /v1/projects/:pid/members/:uid',
  'GET /v1/projects/:pid/people',
  'GET /v1/projects/:pid/people/:userId',
  // Dividing plots and assignments.
  'PUT /v1/projects/:pid/assignments',
  'GET /v1/projects/:pid/assignments',
  'GET /v1/projects/:pid/my-assignment',
  'GET /v1/projects/:pid/csv-files/:id/columns',
  'GET /v1/projects/:pid/csv-files/:id/distribution',
  'PUT /v1/projects/:pid/csv-files/:id/distribution',
  'POST /v1/projects/:pid/csv-files/:id/move-unfinished',
  // Checks: sampling, reference plots, the review queue, its decisions and what goes with them.
  'GET /v1/projects/:pid/sampling',
  'PUT /v1/projects/:pid/sampling',
  'POST /v1/projects/:pid/sampling/draw',
  'GET /v1/projects/:pid/reference',
  'POST /v1/projects/:pid/reference/plots',
  'POST /v1/projects/:pid/reference/remove',
  'GET /v1/projects/:pid/quality/queue',
  'POST /v1/projects/:pid/quality/decisions:bulk',
  'PUT /v1/projects/:pid/quality/decisions/:plot',
  'DELETE /v1/projects/:pid/quality/decisions/:plot',
  'POST /v1/projects/:pid/quality/places',
  'GET /v1/projects/:pid/quality/notes',
  'POST /v1/projects/:pid/quality/notes',
  'PUT /v1/projects/:pid/quality/notes/:id',
  'DELETE /v1/projects/:pid/quality/notes/:id',
  'GET /v1/projects/:pid/quality/team-report',
  'GET /v1/projects/:pid/my-quality',
  // Progress links and their public page.
  'GET /v1/projects/:pid/share-links',
  'POST /v1/projects/:pid/share-links',
  'DELETE /v1/projects/:pid/share-links/:id',
  'GET /v1/public/progress/:token',
  // Mail and digests.
  'GET /v1/me/notifications',
  'PUT /v1/me/notifications',
  'PUT /v1/me/email',
  'POST /v1/me/email/confirmation',
  'POST /v1/email/confirm',
  'GET /v1/unsubscribe/:token',
  'POST /v1/unsubscribe/:token',
  'POST /v1/internal/digest',
  // The AI assistant.
  'GET /v1/projects/:pid/ai',
  'PUT /v1/projects/:pid/ai',
  'POST /v1/projects/:pid/ai/runs',
  'GET /v1/projects/:pid/ai/runs',
  'GET /v1/projects/:pid/ai/runs/:id',
  'POST /v1/projects/:pid/analysis/proposals',
];

const notFound: onRequestHookHandler = async (_request, reply) => {
  await reply.code(404).send({ error: 'not_found' });
};

/**
 * Makes every route of LOCAL_OFF_ROUTES answer 404 before anything else runs (no session check,
 * no body read), as a route that does not exist. Called on the app before any route is
 * registered (onRoute sees only the routes added after it).
 */
export function disableLocalOffRoutes(app: FastifyInstance): void {
  const off = new Set(LOCAL_OFF_ROUTES);
  const seen = new Set<string>();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      // Fastify adds a HEAD route for each GET.
      const key = `${method === 'HEAD' ? 'GET' : method} ${route.url}`;
      if (!off.has(key)) continue;
      seen.add(key);
      const own = route.onRequest === undefined ? [] : Array.isArray(route.onRequest) ? route.onRequest : [route.onRequest];
      route.onRequest = [notFound, ...own];
      return;
    }
  });
  app.addHook('onReady', async () => {
    const missing = LOCAL_OFF_ROUTES.filter((key) => !seen.has(key));
    if (missing.length > 0) {
      throw new Error(`LOCAL_OFF_ROUTES names routes that do not exist: ${missing.join(', ')}`);
    }
  });
}

/**
 * The account's username, from the person's name the desktop sends (LOCAL_USER): the name itself
 * when it follows the account rules (accountRules.ts), else the name without accents, with dots for
 * spaces and the characters the rules do not allow left out ("José Pérez" -> "Jose.Perez"); "you"
 * when nothing is left.
 */
export function localUsername(name: string | undefined): string {
  const raw = (name ?? '').trim();
  if (isValidUsername(raw)) {
    return raw;
  }
  const made = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '.')
    .replace(/[^A-Za-z0-9._@-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64);
  if (made.length === 0) {
    return 'you';
  }
  return made.length < 3 ? made.padEnd(3, '_') : made;
}

/**
 * One-time sign-in links for the browser: each token opens one dashboard session, once, within
 * SIGN_IN_TTL_MS. Kept as hashes, in memory.
 */
export class LocalSignIn {
  /** Token hash -> when it stops working. */
  private readonly tokens = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(): string {
    this.prune();
    while (this.tokens.size >= MAX_SIGN_IN_LINKS) {
      this.tokens.delete(this.tokens.keys().next().value!);
    }
    const token = generateToken();
    this.tokens.set(hashToken(token), this.now() + SIGN_IN_TTL_MS);
    return token;
  }

  /** Whether the token is one issued, not used and not expired; it cannot be used again either way. */
  consume(token: string): boolean {
    const key = hashToken(token);
    const until = this.tokens.get(key);
    this.tokens.delete(key);
    return until !== undefined && until > this.now();
  }

  private prune(): void {
    const now = this.now();
    for (const [key, until] of this.tokens) {
      if (until <= now) this.tokens.delete(key);
    }
  }
}

/** Makes the account, the project (the account as its coordinator) and the desktop's session. */
export async function startLocal(store: InMemoryStore, config: Config, now: () => number = Date.now): Promise<LocalSetup> {
  if (!config.localMode) {
    throw new Error('startLocal is for LOCAL_MODE=1');
  }
  const username = localUsername(config.localUser);
  // A password no one knows: the account signs in only through the local start.
  const user = await store.createUser({ username, passwordHash: await hashPassword(generateToken()), email: null });
  const { projectId } = await store.createProject({
    name: config.localProjectName ?? DEFAULT_LOCAL_PROJECT_NAME,
    ...(config.localProjectId ? { projectId: config.localProjectId } : {}),
  });
  await store.addMembership(projectId, user.id, 'admin');
  const apiToken = await store.createSession(user.id);
  return { userId: user.id, username, projectId, apiToken, signIn: new LocalSignIn(now) };
}

/** http://127.0.0.1:<port> of the listening server; from the request's Host before it listens (tests). */
function baseUrlOf(app: FastifyInstance, request?: FastifyRequest): string {
  const address = app.server.address() as AddressInfo | null;
  if (address && typeof address === 'object') {
    return `http://${address.address}:${address.port}`;
  }
  return `http://${request?.headers.host ?? '127.0.0.1'}`;
}

/** A sign-in link's path. */
export function signInPath(token: string): string {
  return `/local-sign-in/${token}`;
}

/** The sign-in link the desktop opens in the browser. */
export function signInUrl(app: FastifyInstance, token: string, request?: FastifyRequest): string {
  return `${baseUrlOf(app, request)}${signInPath(token)}`;
}

/** What the desktop reads on stdout once the server listens: one JSON line. */
export function readyLine(app: FastifyInstance, local: LocalSetup): string {
  const { port } = app.server.address() as AddressInfo;
  return JSON.stringify({
    ready: true,
    port,
    projectId: local.projectId,
    username: local.username,
    signInUrl: signInUrl(app, local.signIn.issue()),
    apiToken: local.apiToken,
  });
}

/** A small page: no cache, no referrer, never indexed (the address held a token). */
function page(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('x-robots-tag', 'noindex, nofollow')
    .send(`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Collect Earth</title></head><body>${html}</body></html>`);
}

/**
 * The pages a sign-in link may open (`?to=`), beside the project's own: Collect Earth's "Analyse the data" opens the
 * analysis page. A list, so the link can never send the browser anywhere else.
 */
export const SIGN_IN_PAGES = ['analysis', 'data', 'map', 'quality', 'activity', 'settings'] as const;

/** The sign-in link and the route the desktop asks new links from. */
export async function registerLocalRoutes(app: FastifyInstance, store: InMemoryStore, local: LocalSetup): Promise<void> {
  const projectPage = `/projects/${local.projectId}`;

  app.get('/local-sign-in/:token', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.params as { token: string }).token;
    const to = (request.query as { to?: unknown }).to;
    const target = typeof to === 'string' && (SIGN_IN_PAGES as readonly string[]).includes(to) ? `${projectPage}/${to}` : projectPage;
    if (!local.signIn.consume(token)) {
      // Used or expired (a reload of the page, say): a browser that already signed in goes on.
      return page(
        reply,
        410,
        `<p>This sign-in link has already been used. Open the dashboard again from Collect Earth.</p>` +
          `<script>try{if(localStorage.getItem(${JSON.stringify(WEB_SESSION_KEY)}))location.replace(${JSON.stringify(target)})}catch(e){}</script>`,
      );
    }
    const session = await store.createSession(local.userId);
    return page(
      reply,
      200,
      `<p>Opening your dashboard…</p>` +
        `<script>try{localStorage.setItem(${JSON.stringify(WEB_SESSION_KEY)},${JSON.stringify(session)})}catch(e){}location.replace(${JSON.stringify(target)})</script>`,
    );
  });

  // A new sign-in link, for the desktop's "My dashboard" (its session only: the one account).
  app.post('/v1/local/sign-in-links', { preHandler: requireSession(store) }, async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.userId !== local.userId) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const token = local.signIn.issue();
    return reply.code(201).send({ path: signInPath(token), url: signInUrl(app, token, request), expiresInMs: SIGN_IN_TTL_MS });
  });
}
