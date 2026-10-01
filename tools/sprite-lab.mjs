#!/usr/bin/env node
// Sprite lab data: the Young Stoner Life dancers in several designs / formats, for public/lab (sprite-lab.html).
//   node tools/sprite-lab.mjs
// Every format uses the original animation tables (cels + frame counts from the game data), so the lab plays
// them at the game's real timing. "Smooth" formats add generated in-between poses inside the original holds:
// the motion gets more drawings, the beats land on the same frames.
// Writes public/lab/dancers/<format>.png (sprite sheet) and public/lab/dancers/lab.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { Image } from './lib/png.mjs';
import { POSES } from './lib/dancer-poses.mjs';
import { CELL, diamond, gbaDiamond, gbaTezzus, tezzus } from './lib/dancer-art.mjs';

const dir = join(ROOT, 'public', 'gba', 'power_calligraphy');
const gfx = JSON.parse(readFileSync(join(dir, 'gfx.json'), 'utf8'));
const tiles = readFileSync(join(dir, 'power_calligraphy_obj_dancers.4bpp'));
const pal10 = gfx.palettes.power_calligraphy_pal[10];

// ---- original cels (for reference) ----
const SIZES = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];
function original(n) {
  const cel = gfx.cels[`power_calligraphy_people_cel${String(n).padStart(3, '0')}`];
  const out = new Map();
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
        if (c) out.set(`${x0 + tx},${y0 + ty}`, `#${pal10[c].toString(16).padStart(6, '0')}`);
      }
  }
  return out;
}

// ---- pose blending for in-betweens ----
const lerp = (a, b, t) => (Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], t)) : a + (b - a) * t);
function blend(a, b, t) {
  const near = t < 0.5 ? a : b;
  return { head: lerp(a.head, b.head, t), neck: lerp(a.neck, b.neck, t), hip: lerp(a.hip, b.hip, t), arms: lerp(a.arms, b.arms, t), legs: lerp(a.legs, b.legs, t), facing: near.facing, down: near.down };
}

// ---- formats ----
// draw(pose, who) -> { d (pixels per game pixel), get(x, y) -> '#rrggbb' | null }
const viaPix = (fn, opts) => (pose) => { const px = fn(pose, opts); return { d: 1, get: (x, y) => px.get(x, y) }; };
const viaCanvas = (fn) => (pose) => {
  const cv = fn(pose);
  return { d: cv.D, get: (X, Y) => cv.px[(Y + CELL.ay * cv.D) * cv.w + X + CELL.ax * cv.D] ?? null };
};
const FORMATS = [
  { id: 'original', label: 'Original (GBA)', desc: 'Nintendo’s dancers, for reference: 1x, palette 10.', d: 1, smooth: false },
  { id: 'gba-chibi', label: 'GBA 1x · chibi', desc: 'True 1x pixel art, big heads, 1-px outlines, ≤15 colours each. Original frames.', d: 1, smooth: false, tz: viaPix(gbaTezzus, { head: 5.4 }), dm: viaPix(gbaDiamond, { head: 5.4 }) },
  { id: 'gba-chibi-smooth', label: 'GBA 1x · chibi · in-betweens', desc: 'Same art plus generated in-between poses inside the original holds. Same beats, smoother motion.', d: 1, smooth: true, tz: viaPix(gbaTezzus, { head: 5.4 }), dm: viaPix(gbaDiamond, { head: 5.4 }) },
  { id: 'gba-classic', label: 'GBA 1x · classic', desc: 'True 1x pixel art at the original proportions (smaller heads).', d: 1, smooth: false, tz: viaPix(gbaTezzus, { head: 4.5 }), dm: viaPix(gbaDiamond, { head: 4.5 }) },
  { id: 'hd', label: 'HD 4x (in game now)', desc: 'The current game art: drawn at 4x density on the hi-res layer.', d: 4, smooth: false, tz: viaCanvas(tezzus), dm: viaCanvas(diamond) },
];

// ---- animations (from the game data) ----
const ANIMS = ['dance', 'dance_l', 'dance_r', 'bow_l', 'bow_r', 'fall_l', 'fall_r'];
const celNo = (name) => Number(name.slice(-3));
function animOf(who, name) {
  const a = gfx.anims[`anim_power_calligraphy_people_${who === 'tz' ? 'm' : 'w'}_${name}`];
  return a.map(([cel, frames]) => [celNo(cel), frames]);
}
// Split the original holds: the key pose first, then in-betweens toward the next pose at the end of the hold.
function smoothAnim(steps, loop) {
  const out = [];
  steps.forEach(([cel, frames], i) => {
    const next = steps[i + 1] ?? (loop ? steps[0] : null);
    if (!next || next[0] === cel || frames < 4) return out.push([String(cel), frames]);
    if (frames >= 8) out.push([String(cel), frames - 4], [`${cel}>${next[0]}@0.33`, 2], [`${cel}>${next[0]}@0.67`, 2]);
    else out.push([String(cel), frames - 2], [`${cel}>${next[0]}@0.5`, 2]);
  });
  return out;
}

const COLS = 12;
const lab = { cell: { w: CELL.w, h: CELL.h, ax: CELL.ax, ay: CELL.ay }, formats: [], anims: ANIMS };
const outDir = join(ROOT, 'public', 'lab', 'dancers');
mkdirSync(outDir, { recursive: true });
for (const f of FORMATS) {
  const frames = {}; // key -> cell index
  const anims = { tz: {}, dm: {} };
  const keys = [];
  for (const who of ['tz', 'dm']) {
    for (const name of ANIMS) {
      const steps = animOf(who, name);
      const seq = f.smooth ? smoothAnim(steps, name.startsWith('dance')) : steps.map(([c, n]) => [String(c), n]);
      anims[who][name] = seq.map(([k, n]) => [`${who}:${k}`, n]);
      for (const [k] of seq) if (!keys.includes(`${who}:${k}`)) keys.push(`${who}:${k}`);
    }
  }
  const d = f.d, cw = CELL.w * d, ch = CELL.h * d;
  const sheet = new Image(COLS * cw, Math.ceil(keys.length / COLS) * ch);
  keys.forEach((key, i) => {
    frames[key] = i;
    const [who, k] = key.split(':');
    const ox = (i % COLS) * cw, oy = Math.floor(i / COLS) * ch;
    if (f.id === 'original') {
      for (const [p, col] of original(Number(k))) {
        const [x, y] = p.split(',').map(Number);
        sheet.px[(oy + y + CELL.ay) * sheet.w + ox + x + CELL.ax] = ((parseInt(col.slice(1), 16) << 8) | 255) >>> 0;
      }
      return;
    }
    const m = k.match(/^(\d+)>(\d+)@([\d.]+)$/);
    const pose = m ? blend(POSES[+m[1]], POSES[+m[2]], +m[3]) : POSES[+k];
    const art = (who === 'tz' ? f.tz : f.dm)(pose);
    for (let Y = 0; Y < ch; Y++)
      for (let X = 0; X < cw; X++) {
        const col = art.get(X - CELL.ax * d, Y - CELL.ay * d);
        if (col) sheet.px[(oy + Y) * sheet.w + ox + X] = ((parseInt(col.slice(1), 16) << 8) | 255) >>> 0;
      }
  });
  writeFileSync(join(outDir, `${f.id}.png`), sheet.png());
  lab.formats.push({ id: f.id, label: f.label, desc: f.desc, d, cols: COLS, sheet: `${f.id}.png`, frames, anims, count: keys.length });
  console.log(`${f.id}: ${keys.length} frames`);
}
writeFileSync(join(outDir, 'lab.json'), JSON.stringify(lab) + '\n');
