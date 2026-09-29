#!/usr/bin/env node
// Validate a character skin against the frame contract from `npm run spec`.
//   node tools/check-skin.mjs public/skins/<skin-name>          (checks joe/ by default)
//   node tools/check-skin.mjs public/skins/<skin-name> --group joe --game karate_man
//
// Errors: missing frame, wrong canvas size, opaque background, unreadable PNG.
// Warnings: the drawing's feet / back edge / reach are far from the original frame's (timing reads wrong).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { decodePng } from './lib/png.mjs';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const game = opt('game', 'karate_man');
const group = opt('group', 'joe');
if (!dir) {
  console.error('usage: node tools/check-skin.mjs <skin dir> [--group joe] [--game karate_man]');
  process.exit(1);
}
const spec = JSON.parse(readFileSync(join(ROOT, 'reference', 'specs', game, 'spec.json'), 'utf8')).groups[group];
const F = spec.frame;
const TOL = { ground: 12, back: 32, reach: 40 };
let errors = 0, warnings = 0;
const say = (lvl, cel, msg) => {
  if (lvl === 'ERROR') errors++;
  else warnings++;
  console.log(`${lvl.padEnd(7)} ${cel}: ${msg}`);
};

if (!existsSync(join(dir, 'skin.json'))) say('WARN', 'skin.json', 'missing (copy skin.template.json from the guide folder)');

for (const [cel, info] of Object.entries(spec.cels)) {
  const file = join(dir, group, `${cel}.png`);
  if (!existsSync(file)) {
    say('ERROR', cel, `missing ${group}/${cel}.png`);
    continue;
  }
  let img;
  try {
    img = decodePng(readFileSync(file));
  } catch (e) {
    say('ERROR', cel, e.message);
    continue;
  }
  if (img.w !== F.w || img.h !== F.h) {
    say('ERROR', cel, `canvas is ${img.w}x${img.h}, must be exactly ${F.w}x${F.h}`);
    continue;
  }
  const corners = [0, img.w - 1, (img.h - 1) * img.w, img.h * img.w - 1].map((i) => img.px[i] & 0xff);
  if (corners.some((a) => a > 16)) {
    say('ERROR', cel, 'background is not transparent (corners are opaque)');
    continue;
  }
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if ((img.px[y * img.w + x] & 0xff) > 128) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
      }
  if (x1 < 0) {
    say('ERROR', cel, 'frame is empty');
    continue;
  }
  const b = info.bbox, S = F.scale;
  const want = { left: F.anchorX + b.x * S, right: F.anchorX + (b.x + b.w) * S, bottom: F.anchorY + (b.y + b.h) * S };
  if (Math.abs(y1 - want.bottom) > TOL.ground) say('WARN', cel, `feet/shadow bottom at y=${y1}, ground line is y=${want.bottom}`);
  if (Math.abs(x0 - want.left) > TOL.back) say('WARN', cel, `back edge at x=${x0}, original ${want.left}`);
  if (Math.abs(x1 - want.right) > TOL.reach) say('WARN', cel, `front/reach at x=${x1}, original ${want.right} (punch frames: fist should land near here)`);
}
console.log(`\n${Object.keys(spec.cels).length} frames checked: ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
