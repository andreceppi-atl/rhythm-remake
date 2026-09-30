#!/usr/bin/env node
// Diamond*'s calligraphy hand: same pose as the original, plus his jewelry and skin tone.
//   node tools/diamond-hand.mjs
// Writes public/skins/diamond-star/calligraphy/:
//   hand-overlay.png  1x pixels to add, in the hand's frame (cel 128's sprite origin + hand.json origin)
//   hand.json         palette changes for OBJ palettes 11 (normal), 12 (charge glow) and 13 (release flash)
// and reference/specs/power_calligraphy/diamond-hand_preview_6x.png (original | Diamond*).
// The game writes the overlay into the hand's tiles at load, so every hand frame and the glow fade pick it up.
// hand-overlay.png can also be edited by hand: use only the colors listed in hand.json's "colors".
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { Image } from './lib/png.mjs';

const dir = join(ROOT, 'public', 'gba', 'power_calligraphy');
const gfx = JSON.parse(readFileSync(join(dir, 'gfx.json'), 'utf8'));
const tiles = readFileSync(join(dir, 'power_calligraphy_obj.4bpp'));
const basePal = gfx.palettes.power_calligraphy_pal;

// Palette index -> color. 3/7 skin (3 marks the hidden "power lines" that flash dark red in the glow), 8 thumbnail,
// 2 outline. 4/5/6/9/12/13/15 are unused by the original art in palettes 11-13, so the jewelry gets its own
// colors and glows with the rest of the hand.
const LOOK = {
  11: { 3: 0x6e4533, 7: 0x6e4533, 8: 0xe2bfae, 4: 0x3f261b, 5: 0xf2f6fb, 6: 0xaab4c3, 9: 0x5b6474, 12: 0x9fdcff, 13: 0x262b35, 15: 0xd9f3ff },
  12: { 4: 0x4a0000, 5: 0xffffff, 6: 0xffd0d0, 9: 0xb03a3a, 12: 0xffffff, 13: 0x3a0000, 15: 0xffffff },
  13: { 4: 0xb04848, 5: 0xffffff, 6: 0xffffff, 9: 0xd08080, 12: 0xffffff, 13: 0x805050, 15: 0xffffff },
};
const pal11 = basePal[11].map((c, i) => LOOK[11][i] ?? c);
const C = { skin: 7, shade: 4, gold: 5, silver: 6, dark: 9, ice: 12, face: 13, glint: 15, white: 14, outline: 2 };

// ---- decode the base hand (cel 128) into index + OAM coverage maps ----
const SIZES = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];
const base = new Map(); // "x,y" -> index (topmost OAM entry wins; lower OAM index is on top)
const cel = gfx.cels.power_calligraphy_brush_cel128;
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
      if (c) base.set(`${x0 + tx},${y0 + ty}`, c);
    }
}
const at = (x, y) => base.get(`${x},${y}`) ?? 0;
const isSkin = (x, y) => at(x, y) === 3 || at(x, y) === 7;

// ---- the overlay, drawn in the hand's frame ----
const art = new Map();
const put = (x, y, c) => art.set(`${x},${y}`, c);
const stamp = (rows, ox, oy, key) =>
  rows.forEach((r, y) => [...r].forEach((ch, x) => ch !== '.' && put(ox + x, oy + y, key[ch])));

// Wrist: the forearm runs down-right; bands are perpendicular to it, clipped to the skin.
// t = distance along the arm from the wrist line, s = position across the arm.
const U = [Math.SQRT1_2, Math.SQRT1_2], V = [Math.SQRT1_2, -Math.SQRT1_2], W0 = [35, 9];
const tOf = (x, y) => (x - W0[0]) * U[0] + (y - W0[1]) * U[1];
const sOf = (x, y) => (x - W0[0]) * V[0] + (y - W0[1]) * V[1];
for (const k of base.keys()) {
  const [x, y] = k.split(',').map(Number);
  if (!isSkin(x, y)) continue;
  const t = tOf(x, y), s = sOf(x, y);
  // Watch strap: brushed silver bracelet, 5 px, darker edges.
  if (t >= 0 && t < 5) put(x, y, t < 1 || t >= 4 ? C.dark : (Math.floor(s) % 3 === 0 ? C.gold : C.silver));
  // Iced-out Cuban link: 5 px, chunky interlocking links (alternating diagonal ovals) with stones.
  else if (t >= 7.5 && t < 12.5) {
    const u = t - 7.5, link = Math.floor((s + u * 0.9) / 2.2);
    const edge = u < 0.9 || u >= 4.1;
    const stone = !edge && (Math.floor(s * 1.7 + u) % 3 === 0);
    put(x, y, edge ? C.dark : stone ? (Math.floor(s) % 2 ? C.white : C.ice) : link % 2 ? C.gold : C.silver);
  } else if ((t >= 5 && t < 5.9) || (t >= 12.5 && t < 13.4)) put(x, y, C.shade); // contact shadow on the skin
}

// Watch head: square silver block, dark dial, iced bezel. Sits on the back of the wrist (top side).
stamp(
  [
    '.9999999.',
    '966666669',
    '96fwfwf69',
    '96d...d69',
    '96w.o.w69',
    '96d...d69',
    '96fwfwf69',
    '966666669',
    '.9999999.',
  ].map((r) => r.replace(/\./g, 'x').replace(/^x|x$/g, '.')),
  41, -8,
  { 9: C.dark, 6: C.silver, f: C.gold, w: C.white, d: C.ice, x: C.face, o: C.silver },
);
// Dial hands: tiny silver tick at 12 and 3.
put(45, -5, C.silver);
put(46, -4, C.silver);

// Middle finger (2nd knuckle from the top, left of the brush): blocky signet, pavé diamonds.
stamp(
  ['966669',
   '6wdwd9',
   '6dwdw9',
   '6wdwd9',
   '999999'],
  -12, -32,
  { 9: C.dark, 6: C.silver, w: C.white, d: C.ice },
);
// Band continues under the finger toward the brush.
for (const [x, y] of [[-6, -29], [-6, -28], [-5, -28], [-5, -27], [-4, -27]]) if (isSkin(x, y)) put(x, y, C.silver);

// Pinky (bottom knuckle): big diamond star, sticking out past the finger like the real thing.
stamp(
  ['....9....',
   '...9w9...',
   '...9d9...',
   '999dwd999',
   '9wddwddd9',
   '.9ddddd9.',
   '..9dwd9..',
   '.9dd9dd9.',
   '.9d9.9d9.',
   '.99...99.'],
  -14, -18,
  { 9: C.dark, w: C.white, d: C.ice },
);
// Pinky band.
for (const [x, y] of [[-6, -12], [-5, -12], [-4, -12], [-5, -11], [-4, -11]]) if (isSkin(x, y)) put(x, y, C.silver);

// ---- write overlay + json ----
let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
for (const k of art.keys()) {
  const [x, y] = k.split(',').map(Number);
  x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
}
const rgba = (rgb, a = 255) => ((rgb << 8) | a) >>> 0;
const overlay = new Image(x1 - x0, y1 - y0);
for (const [k, c] of art) {
  const [x, y] = k.split(',').map(Number);
  overlay.px[(y - y0) * overlay.w + (x - x0)] = rgba(pal11[c]);
}
const out = join(ROOT, 'public', 'skins', 'diamond-star', 'calligraphy');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'hand-overlay.png'), overlay.png());
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const colors = {};
for (const i of [...new Set(art.values())].sort((a, b) => a - b)) colors[hex(pal11[i])] = i;
writeFileSync(
  join(out, 'hand.json'),
  JSON.stringify(
    {
      note: 'Power Calligraphy hand for Diamond*. Generated by tools/diamond-hand.mjs. Overlay pixels are palette-11 colors; see "colors".',
      baseCel: 'power_calligraphy_brush_cel128',
      origin: [x0, y0],
      overlay: 'hand-overlay.png',
      colors,
      palettes: Object.fromEntries(Object.entries(LOOK).map(([p, m]) => [p, Object.fromEntries(Object.entries(m).map(([i, c]) => [i, hex(c)]))])),
    },
    null,
    2,
  ) + '\n',
);

// ---- preview: original | Diamond* (normal) | Diamond* (fully charged glow) ----
const S = 6, BX0 = -20, BY0 = -44, BW = 100, BH = 72;
const prev = new Image(BW * S * 3 + 8 * S, BH * S, rgba(0xf4efe6));
const glowPal = basePal[12].map((c, i) => LOOK[12][i] ?? c);
const draw = (ox, withArt, pal) => {
  for (const [k, c] of base) {
    const [x, y] = k.split(',').map(Number);
    const idx = withArt ? art.get(k) ?? c : c;
    if (y >= BY0) prev.fill(ox + (x - BX0) * S, (y - BY0) * S, S, S, rgba(pal[idx]));
  }
  if (withArt)
    for (const [k, c] of art) if (!base.has(k)) {
      const [x, y] = k.split(',').map(Number);
      prev.fill(ox + (x - BX0) * S, (y - BY0) * S, S, S, rgba(pal[c]));
    }
};
draw(0, false, basePal[11]);
draw((BW + 4) * S, true, pal11);
draw((BW + 4) * S * 2, true, glowPal);
const specs = join(ROOT, 'reference', 'specs', 'power_calligraphy');
mkdirSync(specs, { recursive: true });
writeFileSync(join(specs, 'diamond-hand_preview_6x.png'), prev.png());
console.log(`overlay ${overlay.w}x${overlay.h} at (${x0},${y0}), ${art.size} px; outside the original hand: ${[...art.keys()].filter((k) => !base.has(k)).length}`);
