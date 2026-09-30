#!/usr/bin/env node
// Power Calligraphy dancers restyled for Young Stoner Life: the man becomes Tezzus, the woman becomes Diamond*.
//   node tools/diamond-dancers.mjs
// Same poses and animation as the original (every cel keeps its silhouette and origin); only the look changes.
// Each original cel is split into parts (face, hands, feet, hair, top, legs, shoes) and re-coloured per character.
// Writes public/skins/diamond-star/calligraphy/dancers.png + dancers.json (a sheet of 1x frames, one cell per cel)
// and reference/specs/power_calligraphy/diamond-dancers_preview_8x.png (original above, restyled below).
// dancers@4x.png is the same frames at 4x density with the fine details (all nine piercings, the GG logo, hand
// tattoos, shades, leather scales, rips, dread strands, sherpa texture); the game draws it on a 4x canvas.
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
  // Standing man frames: the jacket is cropped, so everything a row or two below the tank is jeans.
  if (n < 17 && all.y1 - all.y0 > 16) {
    const tank = [...clothSet].filter((k) => px.get(k) === WHITE).map((k) => XY(k)[1]);
    const waist = tank.length ? Math.max(...tank) + 2 : fb.y1 + 3;
    for (const k of clothSet) labels.set(k, XY(k)[1] > waist ? 'legs' : 'top');
  }
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

  // ---- 4x detail ----
  const base = new Map(out), hi = new Map();
  const put4 = (X, Y, col) => hi.set(K(X, Y), col);
  const cell4 = (k, f) => { const [x, y] = XY(k); for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) f(x * 4 + i, y * 4 + j, i, j); };
  // Jacket: overlapping leather scales (4x3 cells, rows offset), dark lower rim, light upper-left glint.
  for (const [k, col] of out) {
    if (col !== TEZZUS.jacket && col !== TEZZUS.jacketLight) continue;
    base.set(k, TEZZUS.jacket);
    cell4(k, (X, Y) => {
      const r = Math.floor((Y + 64) / 3), cx = (X + 64 + (r & 1) * 2) % 4, cy = (Y + 64) % 3;
      put4(X, Y, cy === 2 && cx !== 0 ? TEZZUS.jacketEdge : cy === 0 && cx === 1 ? TEZZUS.jacketLight : TEZZUS.jacket);
    });
  }
  // Ripped jeans: frayed horizontal slits.
  for (const [k, col] of out) {
    if (col !== TEZZUS.rip) continue;
    base.set(k, TEZZUS.jeans);
    cell4(k, (X, Y, i, j) => put4(X, Y, (j === 1 || j === 2) && i > 0 && i < 4 ? (j === 2 && i === 2 ? TEZZUS.skin : TEZZUS.rip) : TEZZUS.jeans));
  }
  // Shades: shield lenses with a frame line and a light streak on each side.
  const lensRows = [...rows.keys()].slice(0, 2);
  for (const [k, col] of out) {
    if (col !== TEZZUS.lens && col !== TEZZUS.glint) continue;
    base.set(k, TEZZUS.lens);
    const [x] = XY(k);
    cell4(k, (X, Y, i, j) => {
      const Yr = Y - lensRows[0] * 4, rel = X - Math.round(fb.cx * 4 + 2);
      const streak = (Yr + Math.abs(rel)) % 6 === 2 && Yr > 0 && Yr < 7 && Math.abs(rel) > 1;
      put4(X, Y, Yr === 0 ? TEZZUS.outline : streak ? '#8d7c8a' : TEZZUS.lens);
    });
  }
  // Hand tattoos: two rows of script marks across each hand.
  for (const comp of components([...labels].filter(([, p]) => p === 'hand').map(([k]) => k))) {
    for (const k of comp) if (out.get(k) === TEZZUS.ink) base.set(k, TEZZUS.skin);
    if (comp.length < 4) continue;
    const b = bbox(comp);
    const set = new Set(comp);
    for (const k of comp) cell4(k, (X, Y) => {
      const ty = Y - b.y0 * 4, tx = X - b.x0 * 4;
      const mark = (ty === 3 || ty === 7) && tx >= 2 && tx <= (b.x1 - b.x0 + 1) * 4 - 3 && (tx + ty) % 4 !== 0;
      const dot = ty === 5 && tx % 3 === 1;
      if ((mark || dot) && set.has(K(Math.floor(X / 4), Math.floor(Y / 4)))) put4(X, Y, TEZZUS.ink);
    });
  }
  hairStrands(out, TEZZUS.hair, put4, cell4);
  return { out, base, hi };
}

// Dreads: vertical strands with a lighter sheen.
function hairStrands(out, hair, put4, cell4) {
  for (const [k, col] of out) if (col === hair) cell4(k, (X, Y) => put4(X, Y, (X + 64) % 3 === 1 ? '#3a2c26' : hair));
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
  // ---- 4x detail ----
  const base = new Map(out), hi = new Map();
  const put4 = (X, Y, col) => hi.set(K(X, Y), col);
  const cell4 = (k, f) => { const [x, y] = XY(k); for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) f(x * 4 + i, y * 4 + j, i, j); };
  const face = new Set([...labels].filter(([, p]) => p === 'face').map(([k]) => k));
  // Eyes and mouth: dark pixels enclosed by the face (face on both sides in the row, and above).
  const inner = [...px].filter(([k, c]) => {
    if (c !== BLACK || face.has(k)) return false;
    const [x, y] = XY(k);
    const row = [...face].map(XY).filter(([, yy]) => yy === y).map(([xx]) => xx);
    return row.some((xx) => xx < x) && row.some((xx) => xx > x) && [...face].some((f) => { const [fx, fy] = XY(f); return fx === x && fy < y; });
  }).map(([k]) => XY(k));
  const cut = fb.y0 + (fb.y1 - fb.y0) * 0.55;
  const eyes = inner.filter(([, y]) => y < cut), mouth = inner.filter(([, y]) => y >= cut);
  for (const [k, col] of out) if (col === DIAMOND.hair && !inner.some(([x, y]) => K(x, y) === k)) cell4(k, (X, Y) => put4(X, Y, (X + 64) % 3 === 1 ? '#33261f' : DIAMOND.hair));
  // Sherpa fleece: soft darker curls.
  for (const [k, col] of out) if (col === DIAMOND.fleece) cell4(k, (X, Y) => put4(X, Y, ((X + 64) * 5 + (Y + 64) * 3) % 7 === 0 ? '#d9ceb6' : DIAMOND.fleece));
  // Gucci web stripe with interlocking gold GG.
  if (torso && torso.length >= 12) {
    const cx = Math.round(fb.cx);
    const ys = torso.map(XY).filter(([x]) => x === cx).map(([, y]) => y).sort((a, b) => a - b);
    const gy = ys[Math.floor(ys.length / 2)];
    base.set(K(cx, gy), DIAMOND.red);
    if (ys.length >= 2) {
      const G = ['.gggg.', 'g....g', 'g.....', 'g..ggg', 'g....g', '.gggg.'];
      const X0 = cx * 4 + 2 - 5, Y0 = Math.min(gy * 4 + 2 - 3, (ys[ys.length - 1] + 1) * 4 - 6);
      const stripe = (X, Y) => Math.abs(Math.floor(X / 4) - cx) <= 1 && ys.includes(Math.floor(Y / 4));
      G.forEach((r, j) => [...r].forEach((ch, i) => {
        if (ch !== 'g') return;
        if (stripe(X0 + i, Y0 + j)) put4(X0 + i, Y0 + j, DIAMOND.gold); // left G
        if (stripe(X0 + 9 - i, Y0 + j)) put4(X0 + 9 - i, Y0 + j, DIAMOND.gold); // right G, mirrored
      }));
    } else out.set(K(cx, gy), DIAMOND.gold);
  }
  // Piercings, all nine: 3 descending on the forehead, cheekbones, dimples, bottom corners of the mouth.
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const ex = eyes.map(([x]) => x), eyY = eyes.length ? avg(eyes.map(([, y]) => y)) : fb.y0 + (fb.y1 - fb.y0) * 0.35;
  let eL = ex.length ? Math.min(...ex) : fb.x0 + 1, eR = ex.length ? Math.max(...ex) : fb.x1 - 1;
  if (eR - eL < 2) { eL = Math.min(eL, fb.x0 + 1); eR = Math.max(eR, fb.x1 - 1); }
  const mx = mouth.map(([x]) => x);
  const m0 = mx.length ? Math.min(...mx) : fb.cx - 1, m1 = mx.length ? Math.max(...mx) : fb.cx + 1;
  const my = mouth.length ? avg(mouth.map(([, y]) => y)) : fb.y1 - 1;
  const mid = (eL + eR) / 2;
  const studs = [
    [mid, fb.y0 + 0.05], [mid, fb.y0 + 0.8], [mid, fb.y0 + 1.55], // forehead, descending
    [eL - 0.6, eyY + 1.1], [eR + 0.6, eyY + 1.1], // cheekbones
    [m0 - 1.1, my - 0.5], [m1 + 1.1, my - 0.5], // dimples
    [m0 - 0.3, my + 0.7], [m1 + 0.3, my + 0.7], // bottom corners of the mouth
  ];
  let placed = 0;
  for (let [x, y] of studs) {
    // keep it on the face: nudge toward the face centre until the 1x pixel under it is face
    for (let t = 0; t < 6 && !face.has(K(Math.floor(x), Math.floor(y))); t++) { x += Math.sign(fb.cx + 0.5 - x) * 0.5; y += Math.sign(fb.cy + 0.5 - y) * 0.5; }
    const X = Math.round(x * 4), Y = Math.round(y * 4);
    put4(X - 1, Y - 1, '#ffffff'); put4(X, Y - 1, DIAMOND.stud); put4(X - 1, Y, DIAMOND.stud); put4(X, Y, '#9aa6b4');
    placed++;
  }
  return { out, base, hi, studs: placed };
}

// ---- sheet ----
const CELL = { w: 44, h: 40, ax: 22, ay: 36 }; // anchor = sprite origin
const COLS = 9;
const names = Array.from({ length: 34 }, (_, i) => `power_calligraphy_people_cel${String(i).padStart(3, '0')}`);
const rgba = (rgb, a = 255) => ((rgb << 8) | a) >>> 0;
const sheet = new Image(COLS * CELL.w, Math.ceil(names.length / COLS) * CELL.h);
const S = 8, prev = new Image(COLS * CELL.w * S, Math.ceil(names.length / COLS) * CELL.h * S * 2, rgba(0xf4efe6));
const cells = {};
const D = 4; // detail density
const detail = new Image(COLS * CELL.w * D, Math.ceil(names.length / COLS) * CELL.h * D);
const dPrev = new Image(COLS * CELL.w * D * 2, Math.ceil(names.length / COLS) * CELL.h * D * 2, rgba(0xf4efe6));
const results = names.map((name, i) => {
  const px = decode(gfx.cels[name]);
  return { name, i, px, ...(i < 17 ? tezzus(i, px) : diamond(i, px)) };
});
for (const { name, i, px, out, base, hi } of results) {
  const cx = (i % COLS) * CELL.w, cy = Math.floor(i / COLS) * CELL.h;
  const put = (X, Y, col) => {
    const sx = (cx + CELL.ax) * D + X, sy = (cy + CELL.ay) * D + Y;
    detail.px[sy * detail.w + sx] = rgba(hex(col));
    dPrev.fill(sx * 2, sy * 2, 2, 2, rgba(hex(col)));
  };
  for (const [k, col] of base) { const [x, y] = XY(k); for (let j = 0; j < D; j++) for (let q = 0; q < D; q++) put(x * D + q, y * D + j, col); }
  for (const [k, col] of hi) {
    const [X, Y] = XY(k);
    if (!base.has(K(Math.floor(X / D), Math.floor(Y / D)))) continue; // detail stays inside the 1x silhouette
    put(X, Y, col);
  }
}
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
writeFileSync(join(out, 'dancers@4x.png'), detail.png());
writeFileSync(
  join(out, 'dancers.json'),
  JSON.stringify({ note: 'Power Calligraphy dancers for Young Stoner Life (man -> Tezzus, woman -> Diamond*). Generated by tools/diamond-dancers.mjs.', sheet: 'dancers.png', detail: { sheet: 'dancers@4x.png', scale: D }, cells }, null, 1) + '\n',
);
const specs = join(ROOT, 'reference', 'specs', 'power_calligraphy');
mkdirSync(specs, { recursive: true });
writeFileSync(join(specs, 'diamond-dancers_preview_8x.png'), prev.png());
writeFileSync(join(specs, 'diamond-dancers_detail_8x.png'), dPrev.png());
const st = results.filter((r) => r.studs !== undefined).map((r) => r.studs);
console.log('Diamond* studs per frame:', Math.min(...st), '-', Math.max(...st));
console.log('wrote', Object.keys(cells).length, 'frames');
