#!/usr/bin/env node
// KanjiVG -> stroke polylines for Power Calligraphy custom characters.
//   node tools/kanji-fetch.mjs 若 少 石 草 生
// Writes src/games/power-calligraphy/ysl/kanji-data.json: per character, strokes in drawing order,
// each a polyline in game pixels relative to the paper centre (120, 84), plus the KanjiVG stroke type.
//
// Stroke data: KanjiVG (https://kanjivg.tagaini.net), © Ulrich Apel, CC BY-SA 3.0.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';

const chars = process.argv.slice(2);
if (!chars.length) throw new Error('usage: node tools/kanji-fetch.mjs 若 少 ...');

// Placement: KanjiVG's 109x109 box -> ~87 px, centred where the original characters sit.
const SCALE = 0.8;
const CENTER = { x: 4, y: -8 };

function fetchSvg(ch) {
  const code = ch.codePointAt(0).toString(16).padStart(5, '0');
  const dir = join(ROOT, 'decomp-cache', 'kanjivg');
  const file = join(dir, `${code}.svg`);
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('curl', ['-sfL', '-o', file, `https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji/${code}.svg`]);
  }
  return readFileSync(file, 'utf8');
}

// Minimal SVG path sampler (M/m L/l H/h V/v C/c S/s Z) -> points every ~1 KanjiVG unit.
function samplePath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const pts = [];
  let i = 0, cmd = '', x = 0, y = 0, lastC = null;
  const num = () => Number(tokens[i++]);
  const push = (px, py) => pts.push([px, py]);
  const cubic = (x1, y1, x2, y2, ex, ey) => {
    const n = Math.max(4, Math.ceil(Math.hypot(ex - x, ey - y) / 1.5));
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      push(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
    }
    lastC = [x2, y2];
    x = ex;
    y = ey;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toLowerCase()) {
      case 'm': x = ox + num(); y = oy + num(); push(x, y); lastC = null; cmd = rel ? 'l' : 'L'; break;
      case 'l': { const ex = ox + num(), ey = oy + num(); cubic(x, y, ex, ey, ex, ey); lastC = null; break; }
      case 'h': { const ex = ox + num(); cubic(x, y, ex, y, ex, y); lastC = null; break; }
      case 'v': { const ey = oy + num(); cubic(x, y, x, ey, x, ey); lastC = null; break; }
      case 'c': { const a = [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()]; cubic(...a); break; }
      case 's': {
        const [rx, ry] = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const a = [ox + num(), oy + num(), ox + num(), oy + num()];
        cubic(rx, ry, ...a);
        break;
      }
      case 'z': i++; break;
      default: i++;
    }
  }
  return pts;
}

const out = { source: 'KanjiVG (https://kanjivg.tagaini.net), © Ulrich Apel, CC BY-SA 3.0', scale: SCALE, center: CENTER, kanji: {} };
for (const ch of chars) {
  const svg = fetchSvg(ch);
  const strokes = [...svg.matchAll(/<path id="kvg:[0-9a-f]+-s(\d+)"(?: kvg:type="([^"]*)")?[^>]*? d="([^"]+)"/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => ({
      type: m[2] ?? '',
      points: samplePath(m[3]).map(([px, py]) => [+((px - 54.5) * SCALE + CENTER.x).toFixed(2), +((py - 54.5) * SCALE + CENTER.y).toFixed(2)]),
    }));
  out.kanji[ch] = { strokes };
  console.log(ch, strokes.length, 'strokes:', strokes.map((s) => s.type).join(' '));
}
const dest = join(ROOT, 'src', 'games', 'power-calligraphy', 'ysl');
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, 'kanji-data.json'), JSON.stringify(out));
