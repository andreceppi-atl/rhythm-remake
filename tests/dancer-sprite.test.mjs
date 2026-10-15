// Young Stoner Life dancers: the atlas written by tools/import-dancer-sheets.mjs from art/ysl-dancers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodePng } from '../tools/lib/png.mjs';

const assets = new URL('../public/skins/diamond-star/calligraphy/', import.meta.url);
const read = (name) => readFileSync(new URL(name, assets));
const manifest = JSON.parse(read('dancers.json'));
const runtimeSheet = decodePng(read(manifest.sheet));
const detailSheet = decodePng(read(manifest.detail.sheet));
const D = manifest.detail.scale;
const cel = (i) => `power_calligraphy_people_cel${String(i).padStart(3, '0')}`;

test('all 34 original cels are packed: 1x mask + 4x detail, original anchors', () => {
  assert.equal(D, 4);
  assert.deepEqual([detailSheet.w, detailSheet.h], [runtimeSheet.w * D, runtimeSheet.h * D]);
  assert.equal(Object.keys(manifest.cells).length, 34);
  const gfx = new URL('../public/gba/power_calligraphy/gfx.json', import.meta.url);
  const original = existsSync(gfx) ? JSON.parse(readFileSync(gfx)) : null; // local only (Nintendo data)
  for (let i = 0; i < 34; i++) {
    const cell = manifest.cells[cel(i)];
    if (original) assert.ok(original.cels[cel(i)], `${cel(i)} must be a real game cel`);
    assert.deepEqual([cell.x, cell.y, cell.w, cell.h, cell.ax, cell.ay], [(i % 9) * 56, Math.floor(i / 9) * 46, 56, 46, 28, 42]);
    assert.equal(cell.who, i < 17 ? 'tezzus' : 'diamond');
  }
});

test('every cel has art, and the 1x mask covers exactly the solid 4x pixels', () => {
  for (let i = 0; i < 34; i++) {
    const cell = manifest.cells[cel(i)];
    let solid = 0;
    for (let y = 0; y < cell.h; y++)
      for (let x = 0; x < cell.w; x++) {
        let any = false;
        for (let dy = 0; dy < D && !any; dy++)
          for (let dx = 0; dx < D && !any; dx++)
            any = (detailSheet.px[((cell.y + y) * D + dy) * detailSheet.w + (cell.x + x) * D + dx] & 255) >= 128;
        const low = runtimeSheet.px[(cell.y + y) * runtimeSheet.w + cell.x + x] & 255;
        assert.equal(low > 0, any, `${cel(i)} mask at ${x},${y}`);
        if (any) solid++;
      }
    assert.ok(solid > 60, `${cel(i)} must contain visible character art`);
  }
});

test('frames stay inside their cell and no taller than the dance frames', () => {
  for (const first of [0, 17]) {
    const box = (i) => {
      const c = manifest.cells[cel(i)];
      let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
      for (let y = 0; y < c.h; y++)
        for (let x = 0; x < c.w; x++)
          if (runtimeSheet.px[(c.y + y) * runtimeSheet.w + c.x + x] & 255) {
            x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
      assert.ok(x0 > 0 && y0 > 0 && x1 < c.w - 1 && y1 <= c.ay, `${cel(i)} touches its cell edge`);
      return Math.max(x1 - x0 + 1, y1 - y0 + 1);
    };
    const dance = Math.max(...[...Array(9).keys()].map((k) => box(first + k)));
    for (let k = 9; k < 17; k++) assert.ok(box(first + k) <= dance + 1, `${cel(first + k)} is bigger than the dance frames`);
  }
});
