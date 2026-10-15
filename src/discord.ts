// Discord Activity support. Discord opens the game in an iframe with frame_id (and instance_id, platform, ...)
// in the URL; outside Discord nothing here runs and the SDK isn't even downloaded.
// Inside Discord: SDK handshake, sign-in, then every same-origin request carries the session token that the
// site's middleware accepts in place of the password (see lib/gate.ts, api/discord/token.ts).

export const inDiscord = new URLSearchParams(location.search).has('frame_id');

export async function startDiscord(): Promise<void> {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
  if (!clientId) throw new Error('this build has no VITE_DISCORD_CLIENT_ID');
  const { DiscordSDK } = await import('@discord/embedded-app-sdk');
  const sdk = new DiscordSDK(clientId);
  // ready() waits for Discord's client forever; opened outside Discord (frame_id copied by hand) it never comes.
  let timer = 0;
  await Promise.race([
    sdk.ready(),
    new Promise((_, reject) => (timer = window.setTimeout(() => reject(new Error('no answer from the Discord client')), 15000))),
  ]).finally(() => clearTimeout(timer));
  const { code } = await sdk.commands.authorize({ client_id: clientId, response_type: 'code', state: '', prompt: 'none', scope: ['identify', 'guilds'] });
  const r = await fetch('/api/discord/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const body = (await r.json().catch(() => ({}))) as { access_token?: string; session?: string; error?: string };
  if (!r.ok || !body.access_token || !body.session) throw new Error(body.error ?? `sign-in failed (${r.status})`);
  await sdk.commands.authenticate({ access_token: body.access_token });
  useSession(body.session);
}

// Add the session to every request for this site's own files (the game loads everything through fetch).
export function useSession(session: string) {
  const plain = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin) return plain(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${session}`);
    return plain(input, { ...init, headers });
  };
}
