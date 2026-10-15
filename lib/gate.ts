// Access rules for the deployed site, shared by middleware.ts and api/discord/token.ts.
// Two ways in: the site password (HTTP Basic, for the browser) or a session token issued to a Discord member
// of an allowed server (Authorization: Bearer, sent by the game when it runs as a Discord Activity).
// Plain TypeScript with Web Crypto only, so it runs in the middleware, the API function and node --test alike.

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text: string): Uint8Array {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export interface Session {
  user: string; // Discord user id
  guild: string; // the allowed server the user was found in
  exp: number; // unix seconds
}

export const SESSION_HOURS = 12;

export async function signSession(secret: string, session: Session): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(session)));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

// The session inside a token, or null if it is malformed, forged or expired.
export async function verifySession(secret: string, token: string, now = Date.now() / 1000): Promise<Session | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let given: Uint8Array;
  try {
    given = unb64url(sig);
  } catch {
    return null;
  }
  const expected = await hmac(secret, body);
  if (given.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given[i] ^ expected[i];
  if (diff) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(unb64url(body))) as Session;
    return typeof session.exp === 'number' && session.exp > now ? session : null;
  } catch {
    return null;
  }
}

// Paths anyone may load. Discord's proxy can't answer a password prompt, so the game's page, its code bundle
// (the same code is public on GitHub) and the sign-in endpoint are open; game data (public/gba, skins, songs)
// still needs the password or a Discord session. The page itself is only open when Discord launches it
// (Discord adds frame_id to the URL), so a plain browser visit still gets the password prompt.
export function isOpenPath(pathname: string, search: string): boolean {
  if (pathname.startsWith('/assets/') || pathname.startsWith('/api/discord/')) return true;
  if (pathname === '/' || pathname === '/index.html') return new URLSearchParams(search).has('frame_id');
  return false;
}

export function checkPassword(header: string, expected: string): boolean {
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6));
    return decoded.slice(decoded.indexOf(':') + 1) === expected;
  } catch {
    return false;
  }
}

export async function checkBearer(header: string, secret: string | undefined): Promise<boolean> {
  if (!secret || !header.startsWith('Bearer ')) return false;
  return (await verifySession(secret, header.slice(7))) !== null;
}
