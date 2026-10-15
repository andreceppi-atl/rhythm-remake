// POST /api/discord/token {code} -> {access_token, session}
// Called by the game when it runs as a Discord Activity (src/discord.ts): trades the OAuth code from
// discordSdk.commands.authorize for an access token, checks the player is in one of DISCORD_GUILD_IDS,
// and returns a signed session that the middleware accepts in place of the site password.
// Env: VITE_DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_IDS (comma separated), SESSION_SECRET.
import { SESSION_HOURS, signSession } from '../../lib/gate.ts';

const API = 'https://discord.com/api/v10';

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request): Promise<Response> {
  const clientId = process.env.VITE_DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const secret = process.env.SESSION_SECRET;
  const guilds = (process.env.DISCORD_GUILD_IDS ?? '').split(',').map((g) => g.trim()).filter(Boolean);
  if (!clientId || !clientSecret || !secret || !guilds.length) return fail(503, 'Discord sign-in is not configured.');

  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    return fail(400, 'Expected a JSON body.');
  }
  if (typeof code !== 'string' || !code) return fail(400, 'Missing code.');

  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code }),
  });
  if (!tokenRes.ok) return fail(401, 'Discord rejected the sign-in code.');
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const auth = { Authorization: `Bearer ${access_token}` };
  const [userRes, guildsRes] = await Promise.all([fetch(`${API}/users/@me`, { headers: auth }), fetch(`${API}/users/@me/guilds`, { headers: auth })]);
  if (!userRes.ok || !guildsRes.ok) return fail(502, 'Could not read the Discord account.');
  const user = (await userRes.json()) as { id: string };
  const member = ((await guildsRes.json()) as { id: string }[]).find((g) => guilds.includes(g.id));
  if (!member) return fail(403, 'This game is only open to members of the team server.');

  const session = await signSession(secret, { user: user.id, guild: member.id, exp: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600 });
  return Response.json({ access_token, session }, { headers: { 'Cache-Control': 'no-store' } });
}
