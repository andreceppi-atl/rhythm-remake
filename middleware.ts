// Vercel Routing Middleware: HTTP Basic auth in front of every file of the deployed site.
// The password lives in the SITE_PASSWORD environment variable (never in the repo); any username works.
import { next } from '@vercel/functions';

export default function middleware(request: Request): Response {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) return new Response('Site password is not configured.', { status: 503 });
  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const password = decoded.slice(decoded.indexOf(':') + 1);
      if (password === expected) return next();
    } catch {
      /* malformed header: fall through to the challenge */
    }
  }
  return new Response('Password required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Rhythm Remake", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
