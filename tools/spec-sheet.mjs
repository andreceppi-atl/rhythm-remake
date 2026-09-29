#!/usr/bin/env node
// Character / prop spec sheets for replacement art.
//   node tools/spec-sheet.mjs karate_man
// Writes reference/specs/<game>/:
//   <group>_reference_1x.png / _4x.png  every cel of the original, one per grid cell, anchor marked
//   <group>_onion_4x.png                original at low opacity + guides: draw your replacement over it
//   <group>_template_4x.png             guides only (cell, anchor, original bounding box, ground line)
//   spec.json                           machine-readable: grid, anchor, bbox per cel, animations, palette
//   SPEC.md                             human-readable version
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { Image } from './lib/png.mjs';

const GAMES = {
  karate_man: {
    title: 'Karate Man',
    tiles: 'karate_man_obj.4bpp',
    palette: 'karate_man_pal',
    groups: {
      joe: {
        title: 'Karate Joe',
        cels: range(0, 34),
        anims: {
          joe_stand: 'Idle before the first beat.',
          joe_beat: 'Every beat (beat_anim): a small bob, then holds.',
          joe_punch_low: 'Hit while flow < 3 (pot / ball / bulb), or an empty press at low flow.',
          joe_punch_high: 'Hit while flow ≥ 3, any barely, or an empty press at high flow.',
          joe_punch_ouch: 'Hit a rock or bomb while flow < 3 (hurts, counts as barely).',
          joe_smug_low: 'Low-flow hit while "use the face" is on (engine event 8).',
          joe_smug_high: 'High-flow hit while "use the face" is on.',
          joe_barely: 'Replaces the beat bob for 36 ticks after a barely.',
          joe_miss: 'Replaces the beat bob for 36 ticks after an object gets past him (+ "nua" voice).',
          joe_smirk: 'Replaces the beat bob for 36 ticks after a high-flow rock punch (+ crowd cheer).',
          joe_happy: 'Replaces the beat bob for 108 ticks after a high-flow bomb punch.',
          joe_sad: 'Present in the data, not used by the engine.',
        },
        screen: { x: 80, y: 88, z: 0x4800, note: 'Anchor = sprite position (80, 88) on the 240x160 screen; feet rest 61 px below it (the anchor sits at his belt).' },
      },
      props: {
        title: 'Objects & effects',
        cels: [35, 36, 37, 38, 39, 40, 41, 42, 43],
        anims: {
          object: 'Flying object, one cel per type: 0 pot, 1 rock, 2 soccer ball, 3 bomb, 4 light bulb (index into this animation).',
          object_shadow: 'Shadow under the object, same scale as the object.',
          object_shards: 'Present in the data, not used by the engine.',
          hit_effect: 'Impact flash spawned at (158, 54) on every clean hit, deleted after 2 frames.',
        },
        screen: {
          x: 156,
          y: 52,
          z: 0x4800,
          note: 'Objects are drawn centred on the anchor and scaled by p (0.5 → 2.0) as they fly in; at the ideal hit p = 1.0, anchor (156, 52), full size.',
        },
      },
      ui: {
        title: 'HUD',
        cels: range(44, 49).concat(range(64, 74)),
        anims: {
          flow_meter: 'Flow meter at (36, 16), cel = flow level 0-5.',
          cue_warning: 'Cue caption at (120, 24) (print_text_f).',
          tutorial_text_button: 'Blinking A-button prompt at (172, 112) while a tutorial textbox waits.',
          tutorial_counter: 'Practice "hits remaining" counter at (30, 76).',
          tutorial_skip: 'Skip-practice icon at (0, 160).',
        },
        screen: { x: 0, y: 0, z: 0, note: 'Positions per animation above.' },
      },
    },
  },
};

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const SIZES = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];

const game = process.argv[2] ?? 'karate_man';
const cfg = GAMES[game];
if (!cfg) throw new Error(`no spec config for ${game} (add one to tools/spec-sheet.mjs)`);
const dir = join(ROOT, 'public', 'gba', game);
const gfx = JSON.parse(readFileSync(join(dir, 'gfx.json'), 'utf8'));
const tiles = readFileSync(join(dir, cfg.tiles));
const pals = gfx.palettes[cfg.palette];
const prefix = `${game}_`;
const out = join(ROOT, 'reference', 'specs', game);
mkdirSync(out, { recursive: true });

const hex = (rgb) => `#${rgb.toString(16).padStart(6, '0')}`;
const rgba = (rgb, a = 255) => ((rgb << 8) | a) >>> 0;

// Decode a cel into { pixels: Map<"x,y", {pal, idx}> } relative to the sprite anchor (2D OBJ mapping).
function decode(cel) {
  const px = new Map();
  for (let i = cel.length - 1; i >= 0; i--) {
    const [a0, a1, a2] = cel[i];
    const y0 = ((a0 & 0xff) << 24) >> 24;
    const x0 = ((a1 & 0x1ff) << 23) >> 23;
    const [w, h] = SIZES[(a0 >> 14) & 3][(a1 >> 14) & 3];
    const hf = a1 & 0x1000, vf = a1 & 0x2000;
    const tile = a2 & 0x3ff, pal = a2 >> 12;
    for (let ty = 0; ty < h; ty++)
      for (let tx = 0; tx < w; tx++) {
        const sx = hf ? w - 1 - tx : tx, sy = vf ? h - 1 - ty : ty;
        const t = tile + (sy >> 3) * 32 + (sx >> 3);
        const byte = tiles[t * 32 + (sy & 7) * 4 + ((sx & 7) >> 1)] ?? 0;
        const c = sx & 1 ? byte >> 4 : byte & 15;
        if (c) px.set(`${x0 + tx},${y0 + ty}`, { pal, idx: c });
      }
  }
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const k of px.keys()) {
    const [x, y] = k.split(',').map(Number);
    bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x + 1); by1 = Math.max(by1, y + 1);
  }
  if (!px.size) bx0 = by0 = bx1 = by1 = 0;
  return { px, bbox: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, parts: cel.length };
}

const spec = { game, title: cfg.title, screen: { w: 240, h: 160 }, frameRate: 60, groups: {} };
const md = [
  `# ${cfg.title}: sprite spec`,
  '',
  'Generated by `node tools/spec-sheet.mjs ' + game + '` from the decomp data. Everything is in GBA pixels (1x) unless it says 4x.',
  'The screen is 240×160. Animations step at 60 frames per second, and each frame count is how long that cel stays on screen.',
  '',
  '**Anchor** is the sprite position the engine moves around (the crosshair on the sheets). Replacement art must keep the same anchor,',
  'because the gameplay code places sprites by anchor, not by image corner. Bounding boxes are relative to the anchor (x right, y down).',
  '',
];

for (const [gname, g] of Object.entries(cfg.groups)) {
  const cels = g.cels.map((n) => `${prefix}cel${String(n).padStart(3, '0')}`).filter((c) => gfx.cels[c]);
  const dec = Object.fromEntries(cels.map((c) => [c, decode(gfx.cels[c])]));
  // Shared cell geometry: union of all bboxes, so every frame lines up on the same anchor.
  const U = Object.values(dec).reduce(
    (u, d) => (d.px.size ? { x0: Math.min(u.x0, d.bbox.x), y0: Math.min(u.y0, d.bbox.y), x1: Math.max(u.x1, d.bbox.x + d.bbox.w), y1: Math.max(u.y1, d.bbox.y + d.bbox.h) } : u),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  const pad = 4, labelH = 8;
  const cellW = U.x1 - U.x0 + pad * 2, cellH = U.y1 - U.y0 + pad * 2 + labelH;
  const ax = pad - U.x0, ay = labelH + pad - U.y0;
  const cols = Math.min(cels.length, 8), rows = Math.ceil(cels.length / cols);

  const colors = new Map();
  for (const d of Object.values(dec)) for (const { pal, idx } of d.px.values()) colors.set(`${pal}:${idx}`, pals[pal][idx]);

  const render = (scale, mode) => {
    const img = new Image(cols * cellW * scale, rows * cellH * scale, mode === 'reference' ? rgba(0xf4efe6) : rgba(0xffffff));
    cels.forEach((c, i) => {
      const ox = (i % cols) * cellW * scale, oy = Math.floor(i / cols) * cellH * scale;
      const d = dec[c];
      img.rect(ox, oy, cellW * scale, cellH * scale, rgba(0xc8c2b8));
      img.text(ox + 2 * scale, oy + 2 * scale, c.replace(prefix + 'cel', ''), rgba(0x6b6560), Math.max(1, scale / 2));
      if (mode !== 'template' || true) {
        for (const [k, { pal, idx }] of d.px) {
          if (mode === 'template') break;
          const [x, y] = k.split(',').map(Number);
          const col = mode === 'onion' ? rgba(0x000000, 50) : rgba(pals[pal][idx]);
          img.fill(ox + (ax + x) * scale, oy + (ay + y) * scale, scale, scale, col);
        }
      }
      if (mode !== 'reference') {
        // original bounding box (dashed), ground line at the bbox bottom, anchor crosshair
        const b = d.bbox;
        for (let t = 0; t < b.w * scale; t += 4) {
          img.fill(ox + (ax + b.x) * scale + t, oy + (ay + b.y) * scale, 2, 1, rgba(0x2f8cff, 160));
          img.fill(ox + (ax + b.x) * scale + t, oy + (ay + b.y + b.h) * scale - 1, 2, 1, rgba(0x2f8cff, 160));
        }
        for (let t = 0; t < b.h * scale; t += 4) {
          img.fill(ox + (ax + b.x) * scale, oy + (ay + b.y) * scale + t, 1, 2, rgba(0x2f8cff, 160));
          img.fill(ox + (ax + b.x + b.w) * scale - 1, oy + (ay + b.y) * scale + t, 1, 2, rgba(0x2f8cff, 160));
        }
      }
      const cx = ox + ax * scale, cy = oy + ay * scale, arm = 3 * scale;
      img.fill(cx - arm, cy, arm * 2 + 1, 1, rgba(0xff2d55, 220));
      img.fill(cx, cy - arm, 1, arm * 2 + 1, rgba(0xff2d55, 220));
    });
    return img;
  };
  writeFileSync(join(out, `${gname}_reference_1x.png`), render(1, 'reference').png());
  writeFileSync(join(out, `${gname}_reference_4x.png`), render(4, 'reference').png());
  writeFileSync(join(out, `${gname}_onion_4x.png`), render(4, 'onion').png());
  writeFileSync(join(out, `${gname}_template_4x.png`), render(4, 'template').png());

  // Per-frame files at the skin contract size (one cell without the label strip, 4x):
  //   frames/<cel>_original.png  original art, transparent background (pose reference)
  //   frames/<cel>_guide.png     white canvas: grey silhouette, blue bounds, green ground line, red anchor
  const S = 4, fw = cellW * S, fh = (cellH - labelH) * S, fax = ax * S, fay = (ay - labelH) * S;
  const framesDir = join(out, `${gname}_frames`);
  mkdirSync(framesDir, { recursive: true });
  for (const c of cels) {
    const d = dec[c];
    const id = c.replace(prefix, '');
    const orig = new Image(fw, fh, 0);
    const guide = new Image(fw, fh, rgba(0xffffff));
    for (const [k, { pal, idx }] of d.px) {
      const [x, y] = k.split(',').map(Number);
      orig.fill(fax + x * S, fay + y * S, S, S, rgba(pals[pal][idx]));
      guide.fill(fax + x * S, fay + y * S, S, S, rgba(0xd4d4d4));
    }
    const b = d.bbox;
    guide.rect(fax + b.x * S, fay + b.y * S, b.w * S, b.h * S, rgba(0x2f8cff, 200));
    guide.fill(0, fay + (b.y + b.h) * S - 1, fw, 1, rgba(0x19b35a, 220));
    guide.fill(fax - 12, fay, 25, 1, rgba(0xff2d55));
    guide.fill(fax, fay - 12, 1, 25, rgba(0xff2d55));
    writeFileSync(join(framesDir, `${id}_original.png`), orig.png());
    writeFileSync(join(framesDir, `${id}_guide.png`), guide.png());
  }

  const anims = {};
  for (const [short, trigger] of Object.entries(g.anims)) {
    const name = `anim_karate_${short}`;
    const a = gfx.anims[name] ?? gfx.anims[`anim_${game}_${short}`];
    if (!a) continue;
    const total = a.reduce((s, [, f]) => s + f, 0);
    anims[short] = {
      decompName: name,
      trigger,
      frames: a.map(([cel, frames]) => ({ cel: cel.replace(prefix, ''), frames, ms: +((frames / 60) * 1000).toFixed(1) })),
      totalFrames: total,
      totalMs: +((total / 60) * 1000).toFixed(1),
    };
  }

  spec.groups[gname] = {
    title: g.title,
    screen: g.screen,
    sheet: { columns: cols, rows, cellW, cellH, anchorX: ax, anchorY: ay, labelHeight: labelH, padding: pad, scaleVariants: [1, 4] },
    // The skin contract: one PNG per cel, this size, anchor at this pixel.
    frame: { scale: S, w: fw, h: fh, anchorX: fax, anchorY: fay },
    unionBBox: { x: U.x0, y: U.y0, w: U.x1 - U.x0, h: U.y1 - U.y0 },
    palette: Object.fromEntries([...colors].map(([k, v]) => [k, hex(v)])),
    cels: Object.fromEntries(
      cels.map((c, i) => [c.replace(prefix, ''), { grid: [i % cols, Math.floor(i / cols)], bbox: dec[c].bbox, hardwareSprites: dec[c].parts, pixels: dec[c].px.size }]),
    ),
    anims,
  };

  md.push(
    `## ${g.title} (\`${gname}\`)`,
    '',
    `- **On screen:** ${g.screen.note}`,
    `- **Size:** ${U.x1 - U.x0}×${U.y1 - U.y0} px union of all frames (x ${U.x0}…${U.x1}, y ${U.y0}…${U.y1} around the anchor).`,
    `- **Sheet grid:** ${cols}×${rows} cells of ${cellW}×${cellH} px at 1x (${cellW * 4}×${cellH * 4} at 4x); anchor inside each cell at (${ax}, ${ay}) (×4 at 4x). The top ${labelH} px of each cell is the label strip.`,
    `- **Palette (${colors.size} colours):** ${[...colors].map(([k, v]) => `\`${k}\` ${hex(v)}`).join(' · ')}  (key = palette:index)`,
    '',
    '| Cel | Grid | BBox (x, y, w×h) |',
    '|---|---|---|',
    ...cels.map((c, i) => {
      const b = dec[c].bbox;
      return `| ${c.replace(prefix, '')} | ${i % cols},${Math.floor(i / cols)} | ${b.x}, ${b.y}, ${b.w}×${b.h} |`;
    }),
    '',
    '| Animation | Frames (cel:frames) | Length | When it plays |',
    '|---|---|---|---|',
    ...Object.entries(anims).map(
      ([k, a]) => `| \`${k}\` | ${a.frames.map((f) => `${f.cel.replace('cel', '')}:${f.frames}`).join(' ')} | ${a.totalFrames}f / ${a.totalMs}ms | ${a.trigger} |`,
    ),
    '',
  );
}

md.push(
  '## Making replacement art',
  '',
  '1. Draw over `<group>_onion_4x.png` (or its blank twin `<group>_template_4x.png`). Keep each frame in its cell and keep the pose anchored on the red crosshair.',
  '2. The blue dashed box is the original silhouette bounds. Staying close to it keeps hit timing readable (e.g. the fist reaching the object at the hit frame).',
  '3. Keep the frame count and order. Timing lives in the animation tables above and in `src/games/karate-man/tuning.ts`, not in the art.',
  '4. The original is 4-colour flat art with a 1 px black outline; the engine does not require that. Any RGBA art works once the skin loader lands.',
  '5. Export at 1x or 4x on the same grid (see `spec.json → sheet`). The loader slices cells by the grid and places them by the anchor.',
  '',
);
writeFileSync(join(out, 'spec.json'), JSON.stringify(spec, null, 1));
writeFileSync(join(out, 'SPEC.md'), md.join('\n'));
console.log(`wrote ${out}`);
