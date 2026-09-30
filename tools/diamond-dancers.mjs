#!/usr/bin/env node
// Power Calligraphy dancers restyled for Young Stoner Life: the man becomes Tezzus, the woman becomes Diamond*.
//   node tools/diamond-dancers.mjs
// Same poses and animation as the original (every cel keeps its silhouette and origin); only the look changes.
// Each original cel is split into parts (face, hands, feet, hair, top, legs, shoes) and re-coloured per character.
// Writes public/skins/diamond-star/calligraphy/dancers.png + dancers.json (a sheet of 1x frames, one cell per cel)
// and reference/specs/power_calligraphy/diamond-dancers_preview_8x.png (original above, restyled below).
// dancers.png can also be repainted by hand: keep each frame inside its cell, anchor at the cell's (ax, ay).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { Image } from './lib/png.mjs';

const dir = join(ROOT, 'public', 'gba', 'power_calligraphy');
const gfx = JSON.parse(readFileSync(join(dir, 'gfx.json'), 'utf8'));
const tiles = readFileSync(join(dir, 'power_calligraphy_obj_dancers.4bpp'));
const pal10 = gfx.palettes.power_calligraphy_pal[10];

const SIZES = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];
function decode(cel) {
  const px = new Map();
  for (let i = cel.length - 1; i >= 0; i--) {
    const [a0, a1, a2] = cel[i];
    const y0 = ((a0 & 0xff) << 24) >> 24, x0 = ((a1 & 0x1ff) << 23) >> 23;
    const [w, h] = SIZES[(a0 >> 14) & 3][(a1 >> 14) & 3];
    const hf = a1 & 0x1000, vf = a1 & 0x2000, tile = a2 & 0x3ff;
    for (let ty = 0; ty < h; ty++)
      for (let tx = 0; tx < w; tx++) {
        const sx = hf ? w - 1 - tx : tx, sy = vf ? h - 1 - ty : ty;
        const b = tiles[(tile + (sy >> 3) * 32 + (sx >> 3)) * 32 + (sy & 7) * 4 + ((sx & 7) >> 1)] ?? 0;
        const c = sx & 1 ? b >> 4 : b & 15;
        if (c) px.set(`${x0 + tx},${y0 + ty}`, c);
      }
  }
  return px;
}

const K = (x, y) => `${x},${y}`;
const XY = (k) => k.split(',').map(Number);
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];
function components(keys, nb = N4) {
  const left = new Set(keys), out = [];
  for (const k of keys) {
    if (!left.has(k)) continue;
    left.delete(k);
    const comp = [k];
    for (let i = 0; i < comp.length; i++) {
      const [x, y] = XY(comp[i]);
      for (const [dx, dy] of nb) {
        const n = K(x + dx, y + dy);
        if (left.has(n)) { left.delete(n); comp.push(n); }
      }
    }
    out.push(comp);
  }
  return out;
}
const bbox = (keys) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of keys) { const [x, y] = XY(k); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
};

// Original palette 10 indices: 13 black (outline / gi), 3 skin, 11 blush + midriff, 6 red outfit, 14 white.
const BLACK = 13, SKIN = 3, BLUSH = 11, RED = 6, WHITE = 14;

// ---- per-cel fixes where the automatic split guesses wrong: [x, y, part] ----
// parts: legs | top | hair | feet | hand
const FIX = {};

// Split one cel into labelled parts.
function segment(n, px) {
  const labels = new Map();
  const skinKeys = [...px].filter(([, c]) => c === SKIN || c === BLUSH).map(([k]) => k);
  const comps = components(skinKeys).sort((a, b) => b.length - a.length);
  const face = new Set(comps[0]);
  const fb = bbox(face);
  const all = bbox(px.keys());
  for (const k of face) labels.set(k, 'face');
  // Hair / head outline: non-skin pixels at or above the chin, near the face.
  for (const [k, c] of px) {
    if (labels.has(k) || c === SKIN || c === BLUSH && face.has(k)) continue;
    const [x, y] = XY(k);
    if (y <= fb.y1 && x >= fb.x0 - 3 && x <= fb.x1 + 3 && !(c === WHITE)) labels.set(k, 'hair');
  }
  // Other skin blobs: feet if they sit at the bottom of the figure, otherwise hands (or midriff for blush).
  for (const comp of comps.slice(1)) {
    const b = bbox(comp);
    const blush = comp.every((k) => px.get(k) === BLUSH);
    const part = blush ? 'midriff' : b.y1 >= all.y1 - 3 && b.y0 >= all.y1 - 6 ? 'feet' : 'hand';
    for (const k of comp) labels.set(k, part);
  }
  // Clothing: everything left. Legs vs top by which it reaches first, walking through the clothing pixels.
  const cloth = [...px.keys()].filter((k) => !labels.has(k));
  const clothSet = new Set(cloth);
  const shoes = cloth.filter((k) => px.get(k) === WHITE && XY(k)[1] >= all.y1 - 4 && n >= 17);
  for (const k of shoes) { labels.set(k, 'shoe'); clothSet.delete(k); }
  const dist = new Map(), queue = [];
  const seed = (k, part) => { if (clothSet.has(k) && !dist.has(k)) { dist.set(k, part); queue.push(k); } };
  const near = (part, test) => {
    for (const k of clothSet) {
      const [x, y] = XY(k);
      if (N8.some(([dx, dy]) => test(K(x + dx, y + dy)))) seed(k, part);
    }
  };
  // Legs start next to feet/shoes; top starts at the lapel / midriff / hands / neck.
  near('legs', (k) => labels.get(k) === 'feet' || labels.get(k) === 'shoe');
  for (const k of clothSet) if (px.get(k) === WHITE) seed(k, 'top');
  near('top', (k) => ['hand', 'midriff', 'hair', 'face'].includes(labels.get(k)));
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = XY(queue[i]);
    for (const [dx, dy] of N4) seed(K(x + dx, y + dy), dist.get(queue[i]));
  }
  for (const k of clothSet) labels.set(k, dist.get(k) ?? 'top');
  for (const [x, y, part] of FIX[n] ?? []) if (px.has(K(x, y))) labels.set(K(x, y), part);
  return { labels, fb, all };
}

const hex = (s) => parseInt(s.slice(1), 16);
const TEZZUS = {
  outline: '#000000', skin: '#7c4c35', ink: '#23160f', hair: '#16110f', lens: '#1c0c0f', glint: '#6a5a66',
  jacket: '#d3272d', jacketEdge: '#7c0f14', jacketLight: '#f2645c', tank: '#f2eee4',
  jeans: '#a9c1db', jeansEdge: '#6886a9', rip: '#eef2f6', shoe: '#c81f26',
};
const DIAMOND = {
  outline: '#000000', skin: '#5c3727', hair: '#0f0c0b', fleece: '#efe6d1', tee: '#f6f5f0',
  green: '#1e6a42', red: '#c9202a', gold: '#e3b53c', jeans: '#3b5a86', vans: '#1d1d1d', sole: '#f2f2f2', stud: '#e4ebf3',
};

function tezzus(n, px) {
  const { labels, fb } = segment(n, px);
  const out = new Map();
  const has = (x, y) => px.has(K(x, y));
  for (const [k, c] of px) {
    const [x, y] = XY(k);
    const part = labels.get(k);
    const edge = N4.some(([dx, dy]) => !has(x + dx, y + dy));
    let col;
    const touchesSkin = N8.some(([dx, dy]) => ['hand', 'feet'].includes(labels.get(K(x + dx, y + dy))));
    if (c === BLACK && (part === 'face' || part === 'hand' || part === 'feet')) col = TEZZUS.outline;
    else if (c === BLACK && touchesSkin && part !== 'hair') col = TEZZUS.outline; // keep hands/feet outlined
    else if (part === 'face') col = TEZZUS.skin;
    else if (part === 'hand') col = TEZZUS.skin;
    else if (part === 'feet') col = TEZZUS.shoe;
    else if (part === 'hair') col = c === BLACK ? TEZZUS.hair : TEZZUS.skin;
    else if (part === 'top') col = c === WHITE ? TEZZUS.tank : edge ? TEZZUS.jacketEdge : (x + 2 * y) % 4 === 0 ? TEZZUS.jacketLight : TEZZUS.jacket;
    else if (part === 'legs') col = edge ? TEZZUS.jeansEdge : ((x * 7 + y * 3) % 11 + 11) % 11 === 0 ? TEZZUS.rip : TEZZUS.jeans;
    else col = TEZZUS.outline;
    out.set(k, col);
  }
  // Hand tattoos: one ink pixel in the middle of each hand.
  for (const comp of components([...labels].filter(([, p]) => p === 'hand').map(([k]) => k))) {
    if (comp.length < 4) continue;
    const b = bbox(comp);
    const k = K(Math.round(b.cx), Math.round(b.cy));
    if (comp.includes(k)) out.set(k, TEZZUS.ink);
  }
  // Shades: eye rows (dark pixels inside the upper face) become a solid lens band.
  const faceKeys = [...labels].filter(([, p]) => p === 'face').map(([k]) => k);
  const rows = new Map();
  for (let y = fb.y0; y <= fb.cy; y++) {
    const xs = faceKeys.map(XY).filter(([, yy]) => yy === y).map(([x]) => x);
    if (!xs.length) continue;
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const eyes = [...px].filter(([k, c]) => { const [x, yy] = XY(k); return yy === y && c === BLACK && x > x0 && x < x1; });
    if (eyes.length) rows.set(y, [x0, x1]);
  }
  let first = true;
  for (const [y, [x0, x1]] of [...rows].slice(0, 2)) {
    for (let x = x0; x <= x1; x++) out.set(K(x, y), first && x === x0 + 1 ? TEZZUS.glint : TEZZUS.lens);
    first = false;
  }
  // Dreads: bushy top and a few hanging locks, outside the original silhouette.
  const hair = [...labels].filter(([, p]) => p === 'hair').map(([k]) => k);
  for (const k of hair) {
    const [x, y] = XY(k);
    if (y > fb.y0 + 2) continue;
    if (!has(x, y - 1) && (x & 1) === 0) out.set(K(x, y - 1), TEZZUS.hair);
    if (!has(x - 1, y) && !out.has(K(x - 1, y))) out.set(K(x - 1, y), TEZZUS.hair);
    if (!has(x + 1, y) && !out.has(K(x + 1, y))) out.set(K(x + 1, y), TEZZUS.hair);
  }
  for (const x of [fb.x0 - 1, fb.x1 + 1])
    for (let y = fb.y0; y <= fb.y0 + 3; y++) if (!out.has(K(x, y))) out.set(K(x, y), TEZZUS.hair);
  return out;
}

function diamond(n, px) {
  const { labels, fb } = segment(n, px);
  const out = new Map();
  for (const [k, c] of px) {
    const [x, y] = XY(k);
    const part = labels.get(k);
    let col;
    if (c === BLACK && part !== 'hair') col = DIAMOND.outline;
    else if (part === 'face' || part === 'hand' || part === 'feet') col = DIAMOND.skin;
    else if (part === 'hair') col = c === BLACK || c === RED ? DIAMOND.hair : DIAMOND.skin;
    else if (part === 'midriff') col = DIAMOND.tee;
    else if (part === 'shoe') col = px.get(K(x, y + 1)) === WHITE ? DIAMOND.vans : DIAMOND.sole;
    else if (part === 'legs') col = c === WHITE ? DIAMOND.sole : DIAMOND.jeans;
    else if (part === 'top') col = c === BLUSH ? DIAMOND.tee : c === WHITE ? DIAMOND.tee : DIAMOND.fleece;
    else col = DIAMOND.outline;
    out.set(k, col);
  }
  // Gucci web stripe (green-red-green) down the front of the fleece, gold G on the red.
  const top = [...labels].filter(([k, p]) => p === 'top' && px.get(k) === RED).map(([k]) => k);
  const torso = components(top).sort((a, b) => b.length - a.length)[0];
  if (torso && torso.length >= 12) {
    const cx = Math.round(fb.cx);
    const inT = new Set(torso);
    const ys = torso.map(XY).filter(([x]) => x === cx).map(([, y]) => y).sort((a, b) => a - b);
    ys.forEach((y, i) => {
      if (inT.has(K(cx - 1, y))) out.set(K(cx - 1, y), DIAMOND.green);
      out.set(K(cx, y), i === Math.floor(ys.length / 2) ? DIAMOND.gold : DIAMOND.red);
      if (inT.has(K(cx + 1, y))) out.set(K(cx + 1, y), DIAMOND.green);
    });
  }
  // Piercings (what fits at 1x): cheekbones where the blush was, and the forehead.
  const blush = [...labels].filter(([k, p]) => p === 'face' && px.get(k) === BLUSH).map(([k]) => k);
  for (const comp of components(blush)) {
    const b = bbox(comp);
    const k = comp.map(XY).sort((p, q) => p[1] - q[1] || Math.abs(p[0] - fb.cx) - Math.abs(q[0] - fb.cx))[0];
    if (b) out.set(K(...k), DIAMOND.stud);
  }
  const forehead = [...labels].filter(([, p]) => p === 'face').map(([k]) => XY(k)).filter(([, y]) => y === fb.y0 + 1)
    .sort((p, q) => Math.abs(p[0] - fb.cx) - Math.abs(q[0] - fb.cx))[0];
  if (forehead) out.set(K(...forehead), DIAMOND.stud);
  return out;
}

// ---- sheet ----
const CELL = { w: 44, h: 40, ax: 22, ay: 36 }; // anchor = sprite origin
const COLS = 9;
const names = Array.from({ length: 34 }, (_, i) => `power_calligraphy_people_cel${String(i).padStart(3, '0')}`);
const rgba = (rgb, a = 255) => ((rgb << 8) | a) >>> 0;
const sheet = new Image(COLS * CELL.w, Math.ceil(names.length / COLS) * CELL.h);
const S = 8, prev = new Image(COLS * CELL.w * S, Math.ceil(names.length / COLS) * CELL.h * S * 2, rgba(0xf4efe6));
const cells = {};
const results = names.map((name, i) => {
  const px = decode(gfx.cels[name]);
  return { name, i, px, out: i < 17 ? tezzus(i, px) : diamond(i, px) };
});
for (const { name, i, px, out } of results) {
  const cx = (i % COLS) * CELL.w, cy = Math.floor(i / COLS) * CELL.h;
  cells[name] = { x: cx, y: cy, w: CELL.w, h: CELL.h, ax: CELL.ax, ay: CELL.ay, who: i < 17 ? 'tezzus' : 'diamond' };
  const rowY = Math.floor(i / COLS) * CELL.h * S * 2;
  prev.rect(cx * S, rowY, CELL.w * S, CELL.h * S * 2, rgba(0xc8c2b8));
  for (const [k, c] of px) {
    const [x, y] = XY(k);
    prev.fill((cx + CELL.ax + x) * S, rowY + (CELL.ay + y) * S, S, S, rgba(pal10[c]));
  }
  for (const [k, col] of out) {
    const [x, y] = XY(k);
    const sx = cx + CELL.ax + x, sy = cy + CELL.ay + y;
    if (sx < cx || sy < cy || sx >= cx + CELL.w || sy >= cy + CELL.h) throw new Error(`${name}: pixel (${x},${y}) outside the cell`);
    sheet.px[sy * sheet.w + sx] = rgba(hex(col));
    prev.fill(sx * S, rowY + CELL.h * S + (CELL.ay + y) * S, S, S, rgba(hex(col)));
  }
  prev.text(cx * S + 4, rowY + 4, String(i), rgba(0x6b6560), 3);
}
const out = join(ROOT, 'public', 'skins', 'diamond-star', 'calligraphy');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'dancers.png'), sheet.png());
writeFileSync(
  join(out, 'dancers.json'),
  JSON.stringify({ note: 'Power Calligraphy dancers for Young Stoner Life (man -> Tezzus, woman -> Diamond*). Generated by tools/diamond-dancers.mjs.', sheet: 'dancers.png', cells }, null, 1) + '\n',
);
const specs = join(ROOT, 'reference', 'specs', 'power_calligraphy');
mkdirSync(specs, { recursive: true });
writeFileSync(join(specs, 'diamond-dancers_preview_8x.png'), prev.png());
console.log('wrote', Object.keys(cells).length, 'frames');
