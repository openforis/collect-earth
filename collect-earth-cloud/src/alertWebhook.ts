// The owner alerts posted to a chat channel as well as mailed (stage D of docs/plans/2026-11-12-server-admin.md): a Slack
// or Microsoft Teams incoming webhook the server administrator gives. Only those services' hosts, over https, so the
// setting cannot make the server call an address of its own network. The message says what happened and a project by
// its id only: the channel is outside the server, and a project's name stays with its people.

/** Slack's, Teams' older connectors', and Teams' workflows (Power Automate) webhook hosts. */
const HOSTS: { kind: WebhookKind; test: (host: string) => boolean }[] = [
  { kind: 'slack', test: (h) => h === 'hooks.slack.com' },
  { kind: 'teams', test: (h) => h.endsWith('.webhook.office.com') },
  { kind: 'teams', test: (h) => h.endsWith('.logic.azure.com') },
  { kind: 'teams', test: (h) => h.endsWith('.api.powerplatform.com') },
];
export type WebhookKind = 'slack' | 'teams';
const MAX_URL = 1000;
const TIMEOUT_MS = 5000;

/** The webhook's service and host, or null when the address is not one the server posts to. */
export function parseWebhookUrl(raw: string): { kind: WebhookKind; host: string } | null {
  if (raw.length > MAX_URL) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port !== '' && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase();
  const match = HOSTS.find((h) => h.test(host));
  return match ? { kind: match.kind, host } : null;
}

/** What is posted: Slack's `text`; for Teams the same text and an Adaptive Card, which its workflows need. */
export function webhookBody(kind: WebhookKind, title: string, text: string): unknown {
  if (kind === 'slack') return { text: `*${title}*\n${text}` };
  return {
    type: 'message',
    text: `${title}: ${text}`,
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: title, weight: 'Bolder', wrap: true },
            { type: 'TextBlock', text, wrap: true },
          ],
        },
      },
    ],
  };
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error' }) => Promise<{ ok: boolean; status: number }>;

/** Posts to the webhook (no redirects followed, five seconds at most): 'sent', or why not (the status, or 'failed'). */
export async function postWebhook(url: string, title: string, text: string, fetchImpl: Fetch = fetch as unknown as Fetch): Promise<{ sent: true } | { sent: false; status: number | null }> {
  const parsed = parseWebhookUrl(url);
  if (!parsed) return { sent: false, status: null };
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(webhookBody(parsed.kind, title, text)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    return res.ok ? { sent: true } : { sent: false, status: res.status };
  } catch {
    return { sent: false, status: null };
  }
}
