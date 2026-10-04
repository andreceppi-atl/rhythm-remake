#!/usr/bin/env node
// Import hand-made dancer sprite sheets for Young Stoner Life (Tezzus + Diamond*) into the game.
//   node tools/import-dancer-sheets.mjs [art/ysl-dancers/tezzus-sheet.png] [art/ysl-dancers/diamond-sheet.png]
// Each sheet: two rows, 17 frames in the original cel order (row 1: dance x9, row 2: bow x6 + fall x2), drawn
// at ~4 px per game pixel on a transparent background. Frames are found as column runs per row (tiny stray
// slivers are dropped), then placed so each one stands where the original cel stands: bottom on the original's
// lowest row, centred on the original's centre. Soft (anti-aliased) edges are kept on the 4x detail layer.
// Writes public/skins/diamond-star/calligraphy/dancers.png (1x mask), dancers@4x.png, dancers.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { decodePng, Image } from './lib/png.mjs';

const D = 4; // detail pixels per game pixel (the sheets are drawn at this density)
const CELL = { w: 56, h: 46, ax: 28, ay: 42 };
const COLS = 9;
const sheets = [
  { who: 'tezzus', file: process.argv[2] ?? join(ROOT, 'art', 'ysl-dancers', 'tezzus-sheet.png'), first: 0 },
  { who: 'diamond', file: process.argv[3] ?? join(ROOT, 'art', 'ysl-dancers', 'diamond-sheet.png'), first: 17 },
];

// Original cel bounds (1x), to stand each new frame where the old one stood.
const gfx = JSON.parse(readFileSync(join(ROOT, 'public', 'gba', 'power_calligraphy', 'gfx.json'), 'utf8'));
const tiles = readFileSync(join(ROOT, 'public', 'gba', 'power_calligraphy', 'power_calligraphy_obj_dancers.4bpp'));
const SIZES = [[[8, 8], [16, 16], [32, 32], [64, 64]], [[16, 8], [32, 8], [32, 16], [64, 32]], [[8, 16], [8, 32], [16, 32], [32, 64]]];
function bounds(n) {
  const cel = gfx.cels[`power_calligraphy_people_cel${String(n).padStart(3, '0')}`];
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [a0, a1, a2] of cel) {
    const ys = ((a0 & 0xff) << 24) >> 24, xs = ((a1 & 0x1ff) << 23) >> 23;
    const [w, h] = SIZES[(a0 >> 14) & 3][(a1 >> 14) & 3];
    const hf = a1 & 0x1000, vf = a1 & 0x2000, tile = a2 & 0x3ff;
    for (let ty = 0; ty < h; ty++)
      for (let tx = 0; tx < w; tx++) {
        const sx = hf ? w - 1 - tx : tx, sy = vf ? h - 1 - ty : ty;
        const b = tiles[(tile + (sy >> 3) * 32 + (sx >> 3)) * 32 + (sy & 7) * 4 + ((sx & 7) >> 1)] ?? 0;
        if (sx & 1 ? b >> 4 : b & 15) { x0 = Math.min(x0, xs + tx); x1 = Math.max(x1, xs + tx); y1 = Math.max(y1, ys + ty); }
      }
  }
  return { cx: (x0 + x1 + 1) / 2, bottom: y1 + 1 };
}

// Frames in one row band: runs of occupied columns, merging small gaps, dropping slivers.
function frames(im, y0, y1) {
  const A = (x, y) => im.px[y * im.w + x] & 255;
  const used = [];
  for (let x = 0; x < im.w; x++) { let any = false; for (let y = y0; y < y1 && !any; y++) any = A(x, y) > 40; used.push(any); }
  let runs = [];
  for (let x = 0; x < im.w; x++) if (used[x]) { const last = runs[runs.length - 1]; if (last && x - last[1] <= 8) last[1] = x; else runs.push([x, x]); }
  runs = runs.filter(([s, e]) => e - s + 1 >= 20);
  return runs.map(([s, e]) => {
    let t = Infinity, b = -1;
    for (let x = s; x <= e; x++) for (let y = y0; y < y1; y++) if (A(x, y) > 40) { t = Math.min(t, y); b = Math.max(b, y); }
    return { x0: s, x1: e, y0: t, y1: b };
  });
}

const sheet1 = new Image(COLS * CELL.w, Math.ceil(34 / COLS) * CELL.h);
const sheet4 = new Image(COLS * CELL.w * D, Math.ceil(34 / COLS) * CELL.h * D);
const cells = {};
for (const s of sheets) {
  const im = decodePng(readFileSync(s.file));
  const mid = Math.floor(im.h / 2);
  const found = [...frames(im, 0, mid), ...frames(im, mid, im.h)];
  if (found.length !== 17) throw new Error(`${s.file}: found ${found.length} frames, expected 17 (9 + 8)`);
  found.forEach((f, i) => {
    const n = s.first + i;
    const name = `power_calligraphy_people_cel${String(n).padStart(3, '0')}`;
    const o = bounds(n);
    const cx = (n % COLS) * CELL.w, cy = Math.floor(n / COLS) * CELL.h;
    // frame placement in detail pixels: bottom on the original's bottom row, centred on its centre
    const left = Math.round((CELL.ax + o.cx) * D - (f.x1 - f.x0 + 1) / 2);
    const top = (CELL.ay + o.bottom) * D - (f.y1 - f.y0 + 1);
    for (let y = f.y0; y <= f.y1; y++)
      for (let x = f.x0; x <= f.x1; x++) {
        const p = im.px[y * im.w + x];
        if ((p & 255) < 16) continue;
        const X = left + x - f.x0, Y = top + y - f.y0;
        if (X < 0 || Y < 0 || X >= CELL.w * D || Y >= CELL.h * D) throw new Error(`${name}: frame doesn't fit the ${CELL.w}x${CELL.h} cell`);
        sheet4.px[(cy * D + Y) * sheet4.w + cx * D + X] = p;
        if ((p & 255) >= 128) sheet1.px[(cy + (Y >> 2)) * sheet1.w + cx + (X >> 2)] = (p | 255) >>> 0; // 1x mask
      }
    cells[name] = { x: cx, y: cy, w: CELL.w, h: CELL.h, ax: CELL.ax, ay: CELL.ay, who: s.who };
  });
  console.log(`${s.who}: 17 frames (${found.map((f) => f.x1 - f.x0 + 1 + 'x' + (f.y1 - f.y0 + 1)).join(' ')})`);
}
const out = join(ROOT, 'public', 'skins', 'diamond-star', 'calligraphy');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'dancers.png'), sheet1.png());
writeFileSync(join(out, 'dancers@4x.png'), sheet4.png());
writeFileSync(join(out, 'dancers.json'), JSON.stringify({
  note: 'Young Stoner Life dancers (man cels -> Tezzus, woman cels -> Diamond*), hand-made sheets in art/ysl-dancers imported by tools/import-dancer-sheets.mjs.',
  sheet: 'dancers.png', detail: { sheet: 'dancers@4x.png', scale: D }, cells,
}, null, 1) + '\n');
console.log('wrote', Object.keys(cells).length, 'frames');
