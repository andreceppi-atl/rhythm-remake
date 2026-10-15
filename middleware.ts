// Vercel Routing Middleware in front of every file of the deployed site.
// The password lives in the SITE_PASSWORD environment variable (never in the repo); any username works.
// Inside Discord the game signs in instead (see lib/gate.ts): SESSION_SECRET verifies its session tokens.
import { next } from '@vercel/functions';
import { checkBearer, checkPassword, isOpenPath } from './lib/gate.ts';

export default async function middleware(request: Request): Promise<Response> {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return new Response('Site password is not configured.', { status: 503 });
  const url = new URL(request.url);
  if (isOpenPath(url.pathname, url.search)) return next();
  const header = request.headers.get('authorization') ?? '';
  if (checkPassword(header, expected) || (await checkBearer(header, process.env.SESSION_SECRET))) return next();
  return new Response('Password required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Rhythm Remake", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
