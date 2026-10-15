# Running Rhythm Remake as a Discord Activity

The game runs inside Discord as an Activity (an embedded web app in a voice channel). The site stays
password-protected; inside Discord, players sign in with Discord instead, and only members of the team
server(s) get in.

## How it works

- `src/discord.ts`: when Discord opens the game (it adds `frame_id` to the URL), the game loads the
  Embedded App SDK, does the handshake, asks Discord to sign the player in (`identify` + `guilds` scopes),
  and sends the code to `/api/discord/token`. Outside Discord none of this runs and the SDK isn't downloaded.
- `api/discord/token.ts`: trades the code for an access token, checks the player is in one of
  `DISCORD_GUILD_IDS`, and returns a session token signed with `SESSION_SECRET` (valid 12 hours).
- `middleware.ts` + `lib/gate.ts`: every request needs the site password **or** that session token. Open to
  all: the code bundle (`/assets/`, same code as the public GitHub repo), the sign-in endpoint, and the page
  itself only when Discord launches it. Game data (`/gba/`, `/skins/`, `/songs/`) is never open.

## One-time setup (Discord Developer Portal)

1. https://discord.com/developers/applications → **New Application** (e.g. "Rhythm Remake").
2. **OAuth2**: copy the **Client ID** and **Client Secret** (reset it to see it). Add a redirect URL
   `https://127.0.0.1` (Discord requires one to be set; Activities don't use it).
3. **Activities → URL Mappings**: root mapping `/` → `rhythm-remake.vercel.app`.
4. **Activities → Settings**: enable Activities; pick the supported platforms (desktop, and mobile if wanted).
5. **Installation**: install the app to the team server. While the app is unverified it can only be
   launched where it is installed.
6. The server ID for `DISCORD_GUILD_IDS`: Discord settings → Advanced → Developer Mode on, then right-click
   the server → **Copy Server ID**.

## Vercel environment variables (production)

| Name | Value |
|---|---|
| `VITE_DISCORD_CLIENT_ID` | the Client ID (built into the page, so it's public) |
| `DISCORD_CLIENT_SECRET` | the Client Secret (server only) |
| `DISCORD_GUILD_IDS` | allowed server ID(s), comma separated |
| `SESSION_SECRET` | a long random string, e.g. `openssl rand -base64 32` |

Then redeploy (`vercel deploy --prod --scope atlantic4`) so the Client ID is built into the page.

## Testing

- Locally, opening `/?frame_id=x` shows the sign-in path: without a client ID it says so; with one but no
  Discord client it gives up after 15 s ("no answer from the Discord client").
- In Discord: join a voice channel in the team server → Activities (rocket icon) → Rhythm Remake.
