#!/usr/bin/env node
// Pack pose-specific Tezzus and Diamond* drawings into the original 34 Power Calligraphy cels.
// Each source board contains one character only; no whole-sprite rotations or procedural redraws.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { decodePng, Image } from './lib/png.mjs';
import { POSES } from './lib/dancer-poses.mjs';

const D = 4;
const CELL = { w: 56, h: 46, ax: 28, ay: 42 };
const CELL4 = { w: CELL.w * D, h: CELL.h * D, ax: CELL.ax * D, ay: CELL.ay * D };
const COLS = 9;
const ROWS = Math.ceil(POSES.length / COLS);
const ALPHA_CUTOFF = 240; // eliminate translucent backdrop glows; keep crisp character pixels only
const SOURCE_DIR = join(ROOT, 'guides', 'dancer-template', 'generated');
const OUT_DIR = join(ROOT, 'public', 'skins', 'diamond-star', 'calligraphy');
const PREVIEW_DIR = join(ROOT, 'reference', 'specs', 'power_calligraphy');

const frameSheets = [
  { file: 'tezzus-dance-00-02.png', who: 'tezzus', cels: [0, 1, 2], cols: 3, rows: 1, view: 'tezzus' },
  { file: 'tezzus-dance-03-08.png', who: 'tezzus', cels: [3, 4, 5, 6, 7, 8], cols: 3, rows: 2, view: 'tezzus' },
  { file: 'tezzus-bow-09-14.png', who: 'tezzus', cels: [9, 10, 11, 12, 13, 14], cols: 3, rows: 2, xCuts: [0, 512, 960, 1536], view: 'tezzus' },
  { file: 'tezzus-fall-15-16.png', who: 'tezzus', cels: [15, 16], cols: 2, rows: 1, view: 'tezzus' },
  { file: 'diamond-dance-17-25.png', who: 'diamond-star', cels: [17, 18, 19, 20, 21, 22, 23, 24, 25], cols: 3, rows: 3, view: 'diamond-front' },
  { file: 'diamond-bow-26-31.png', celOverrides: {
    28: 'diamond-back-cel-28-logo-fixed.png',
    31: 'diamond-back-cel-31-logo-fixed.png',
  }, who: 'diamond-star', cels: [26, 27, 28, 29, 30, 31], cols: 3, rows: 2, view: 'diamond-front' },
  { file: 'diamond-fall-32-33.png', who: 'diamond-star', cels: [32, 33], cols: 2, rows: 1, view: 'diamond-front' },
];

function cutCell(source, col, row, cols, rows, xCuts, yCuts) {
  const x0 = xCuts?.[col] ?? Math.floor(source.w * col / cols);
  const x1 = xCuts?.[col + 1] ?? Math.floor(source.w * (col + 1) / cols);
  const y0 = yCuts?.[row] ?? Math.floor(source.h * row / rows);
  const y1 = yCuts?.[row + 1] ?? Math.floor(source.h * (row + 1) / rows);
  let left = x1, top = y1, right = x0 - 1, bottom = y0 - 1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if ((source.px[y * source.w + x] & 0xff) < ALPHA_CUTOFF) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left || bottom < top) throw new Error(`empty art in source cell ${col},${row}`);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

function drawFit(dst, source, bounds) {
  // The outline remains nearest-neighbour and fully on/off. Fit within the approved
  // 32-game-pixel height and 40-game-pixel width, then place the feet on the game anchor.
  const scale = Math.min((32 * D) / bounds.h, (40 * D) / bounds.w);
  const outW = Math.max(1, Math.round(bounds.w * scale));
  const outH = Math.max(1, Math.round(bounds.h * scale));
  const left = Math.floor((CELL4.w - outW) / 2);
  const top = CELL4.ay - outH;
  for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
    const pixel = source.px[(bounds.y + Math.floor(y / scale)) * source.w + bounds.x + Math.floor(x / scale)];
    if ((pixel & 0xff) < ALPHA_CUTOFF) continue;
    dst.px[(top + y) * dst.w + left + x] = (pixel & 0xffffff00) | 0xff;
  }
}

const sheet4 = new Image(COLS * CELL4.w, ROWS * CELL4.h);
const sheet1 = new Image(COLS * CELL.w, ROWS * CELL.h);
const preview = new Image(sheet4.w * 2, sheet4.h * 2, 0xf4efe6ff);
const characterSheets = new Map(['tezzus', 'diamond-star'].map((who) => [who, {
  sheet4: new Image(COLS * CELL4.w, 2 * CELL4.h),
  sheet1: new Image(COLS * CELL.w, 2 * CELL.h),
}]));
const cells = {};
const seen = new Set();

for (const group of frameSheets) {
  const path = join(SOURCE_DIR, group.file);
  const source = decodePng(readFileSync(path));
  const overrides = new Map(Object.entries(group.celOverrides ?? {}).map(([cel, file]) => [
    Number(cel), { file, image: decodePng(readFileSync(join(SOURCE_DIR, file))) },
  ]));
  if (group.cels.length !== group.cols * group.rows)
    throw new Error(`${group.file} layout does not match its cel count`);
  for (let n = 0; n < group.cels.length; n++) {
    const cel = group.cels[n];
    if (seen.has(cel)) throw new Error(`duplicate original cel ${cel}`);
    seen.add(cel);
    const col = n % group.cols, row = Math.floor(n / group.cols);
    const override = overrides.get(cel);
    const frameSource = override?.image ?? source;
    const sourceFile = override?.file ?? group.file;
    const bounds = cutCell(frameSource, override ? 0 : col, override ? 0 : row,
      override ? 1 : group.cols, override ? 1 : group.rows,
      override ? undefined : group.xCuts, override ? undefined : group.yCuts);
    const cellImage = new Image(CELL4.w, CELL4.h);
    drawFit(cellImage, frameSource, bounds);
    const x = (cel % COLS) * CELL.w, y = Math.floor(cel / COLS) * CELL.h;
    const x4 = x * D, y4 = y * D;
    const artistSheet = characterSheets.get(group.who);
    const artistCel = cel < 17 ? cel : cel - 17;
    const artistX4 = (artistCel % COLS) * CELL4.w;
    const artistY4 = Math.floor(artistCel / COLS) * CELL4.h;
    const artistX = (artistCel % COLS) * CELL.w;
    const artistY = Math.floor(artistCel / COLS) * CELL.h;
    const key = `power_calligraphy_people_cel${String(cel).padStart(3, '0')}`;
    const sourceView = [28, 31].includes(cel) ? 'diamond-back' : group.view;
    cells[key] = {
      x, y, w: CELL.w, h: CELL.h, ax: CELL.ax, ay: CELL.ay,
      who: group.who, sourceView, sourceSheet: sourceFile, sourceFrame: override ? 0 : n,
    };
    for (let py = 0; py < CELL4.h; py++) for (let px = 0; px < CELL4.w; px++) {
      const pixel = cellImage.px[py * CELL4.w + px];
      if ((pixel & 0xff) === 0) continue;
      sheet4.px[(y4 + py) * sheet4.w + x4 + px] = pixel;
      artistSheet.sheet4.px[(artistY4 + py) * artistSheet.sheet4.w + artistX4 + px] = pixel;
      if (px % D === 2 && py % D === 2)
        sheet1.px[(y + Math.floor(py / D)) * sheet1.w + x + Math.floor(px / D)] = pixel;
      if (px % D === 2 && py % D === 2)
        artistSheet.sheet1.px[(artistY + Math.floor(py / D)) * artistSheet.sheet1.w + artistX + Math.floor(px / D)] = pixel;
      const vx = (x4 + px) * 2, vy = (y4 + py) * 2;
      preview.px[vy * preview.w + vx] = pixel;
      preview.px[vy * preview.w + vx + 1] = pixel;
      preview.px[(vy + 1) * preview.w + vx] = pixel;
      preview.px[(vy + 1) * preview.w + vx + 1] = pixel;
    }
  }
}

if (seen.size !== POSES.length || [...Array(POSES.length).keys()].some((cel) => !seen.has(cel)))
  throw new Error(`expected one source drawing for each of ${POSES.length} original cels`);

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PREVIEW_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'dancers.png'), sheet1.png());
writeFileSync(join(OUT_DIR, 'dancers@4x.png'), sheet4.png());
const characterManifest = {
  note: 'Character-exclusive 17-pose sheets, ordered dance (9), bow (6), fall (2). Each cell maps to the corresponding original game cel.',
  scale: D,
  columns: COLS,
  rows: 2,
  cell: CELL,
  characters: {},
};
for (const [who, images] of characterSheets) {
  const originalOffset = who === 'tezzus' ? 0 : 17;
  writeFileSync(join(OUT_DIR, `${who}.png`), images.sheet1.png());
  writeFileSync(join(OUT_DIR, `${who}@4x.png`), images.sheet4.png());
  characterManifest.characters[who] = {
    sheet: `${who}.png`,
    detail: { sheet: `${who}@4x.png`, scale: D },
    frames: Array.from({ length: 17 }, (_, index) => {
      const originalCel = originalOffset + index;
      const originalKey = `power_calligraphy_people_cel${String(originalCel).padStart(3, '0')}`;
      const original = cells[originalKey];
      return {
        index, originalCel,
        x: (index % COLS) * CELL.w,
        y: Math.floor(index / COLS) * CELL.h,
        w: CELL.w, h: CELL.h, ax: CELL.ax, ay: CELL.ay,
        sourceSheet: original.sourceSheet,
        sourceFrame: original.sourceFrame,
        sourceView: original.sourceView,
      };
    }),
  };
}
writeFileSync(join(OUT_DIR, 'character-sheets.json'), JSON.stringify(characterManifest, null, 1) + '\n');
writeFileSync(join(OUT_DIR, 'dancers.json'), JSON.stringify({
  note: 'Diamond* and Tezzus are drawn in separate character-only pose sheets and packed into the original 34 Power Calligraphy cels.',
  authoring: {
    scale: D,
    method: 'individually drawn pose art; nearest-neighbour fit to original game anchors; binary alpha cleanup',
    alphaCutoff: ALPHA_CUTOFF,
    sources: frameSheets.flatMap(({ file, celOverrides, who }) => [
      { file: `guides/dancer-template/generated/${file}`, who },
      ...Object.entries(celOverrides ?? {}).map(([cel, overrideFile]) => ({
        file: `guides/dancer-template/generated/${overrideFile}`, who,
        detail: `back-logo repair for cel ${cel}`,
      })),
    ]),
  },
  sheet: 'dancers.png', detail: { sheet: 'dancers@4x.png', scale: D }, cells,
}, null, 1) + '\n');
writeFileSync(join(PREVIEW_DIR, 'diamond-dancers_preview.png'), preview.png());
console.log(`wrote ${seen.size} pose-specific cels at ${D}x`);
