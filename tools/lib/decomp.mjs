// Read-only access to the Rhythm Tengoku decomp (github.com/arthurtilly/rhythmtengoku).
// Files are fetched once through the `gh` CLI and cached under decomp-cache/ (gitignored).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = join(ROOT, 'decomp-cache');
const REPO = 'arthurtilly/rhythmtengoku';

export function decompPath(path) {
  return join(CACHE, path);
}

// Returns a Buffer. Throws if the file does not exist in the repo.
export function fetchBuffer(path) {
  const local = decompPath(path);
  if (existsSync(local)) return readFileSync(local);
  const buf = execFileSync('gh', ['api', `repos/${REPO}/contents/${path}`, '-H', 'Accept: application/vnd.github.raw'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, buf);
  return buf;
}

export function fetchText(path) {
  return fetchBuffer(path).toString('utf8').replace(/\r\n?/g, '\n');
}

export function tryFetchText(path) {
  try {
    return fetchText(path);
  } catch {
    return null;
  }
}

let treeCache = null;
export function repoTree() {
  const local = join(CACHE, '_tree.txt');
  if (treeCache) return treeCache;
  if (!existsSync(local)) {
    const out = execFileSync('gh', ['api', `repos/${REPO}/git/trees/HEAD?recursive=1`, '--jq', '.tree[].path'], {
      maxBuffer: 64 * 1024 * 1024,
    });
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(local, out);
  }
  treeCache = readFileSync(local, 'utf8').split('\n').filter(Boolean);
  return treeCache;
}
