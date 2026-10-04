import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { decodePng } from '../tools/lib/png.mjs';

const assets = new URL('../public/skins/diamond-star/calligraphy/', import.meta.url);
const generated = new URL('../guides/dancer-template/generated/', import.meta.url);
const read = (name) => readFileSync(new URL(name, assets));
const manifest = JSON.parse(read('dancers.json'));
const characterManifest = JSON.parse(read('character-sheets.json'));
const runtimeSheet = decodePng(read(manifest.sheet));
const detailSheet = decodePng(read(manifest.detail.sheet));
const sourceForCel = (i) => i < 3 ? 'tezzus-dance-00-02.png'
  : i < 9 ? 'tezzus-dance-03-08.png'
    : i < 15 ? 'tezzus-bow-09-14.png'
      : i < 17 ? 'tezzus-fall-15-16.png'
        : i < 26 ? 'diamond-dance-17-25.png'
        : i === 28 ? 'diamond-back-cel-28-logo-fixed.png'
          : i === 31 ? 'diamond-back-cel-31-logo-fixed.png'
          : i < 32 ? 'diamond-bow-26-31.png'
            : 'diamond-fall-32-33.png';

test('both character-only pose sets pack into all 34 original cel slots at 4x', () => {
  const original = JSON.parse(readFileSync(new URL('../public/gba/power_calligraphy/gfx.json', import.meta.url)));
  assert.deepEqual([runtimeSheet.w, runtimeSheet.h], [504, 184]);
  assert.deepEqual([detailSheet.w, detailSheet.h], [2016, 736]);
  assert.deepEqual(manifest.detail, { sheet: 'dancers@4x.png', scale: 4 });
  assert.equal(manifest.authoring.scale, 4);
  assert.equal(manifest.authoring.sources.length, 9);
  for (const { file } of manifest.authoring.sources)
    assert.ok(existsSync(new URL(file.split('/').at(-1), generated)), `${file} must be kept with the project`);
  assert.equal(Object.keys(manifest.cells).length, 34);

  for (let i = 0; i < 34; i++) {
    const name = `power_calligraphy_people_cel${String(i).padStart(3, '0')}`;
    const cell = manifest.cells[name];
    assert.ok(original.cels[name], `${name} must remain a real game cel`);
    assert.deepEqual([cell.x, cell.y, cell.w, cell.h, cell.ax, cell.ay],
      [(i % 9) * 56, Math.floor(i / 9) * 46, 56, 46, 28, 42]);
    assert.equal(cell.who, i < 17 ? 'tezzus' : 'diamond-star');
    assert.equal(cell.sourceSheet, sourceForCel(i));
    assert.equal(cell.sourceView, i < 17 ? 'tezzus' : [28, 31].includes(i) ? 'diamond-back' : 'diamond-front');
    assert.ok(Number.isInteger(cell.sourceFrame));

    let occupied = false;
    for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) {
      const low = runtimeSheet.px[(cell.y + y) * runtimeSheet.w + cell.x + x];
      const high = detailSheet.px[((cell.y + y) * 4 + 2) * detailSheet.w + (cell.x + x) * 4 + 2];
      assert.ok((high & 0xff) === 0 || (high & 0xff) === 255, `${name} must use hard transparency`);
      assert.equal(low, high, `1x runtime should sample the 4x source at ${name}:${x},${y}`);
      if ((high & 0xff) > 0) occupied = true;
    }
    assert.ok(occupied, `${name} must contain visible character art`);
  }
});

test('preview uses the canonical atlas and original animation holds', () => {
  const html = readFileSync(new URL('../reference/specs/power_calligraphy/diamond-dancers_preview.html', import.meta.url), 'utf8');
  const preview = decodePng(readFileSync(new URL('../reference/specs/power_calligraphy/diamond-dancers_preview.png', import.meta.url)));
  assert.deepEqual([preview.w, preview.h], [detailSheet.w * 2, detailSheet.h * 2]);
  assert.match(html, /dancers@4x\.png/);
  assert.match(html, /frames \* \(1000 \/ 60\)/);
  assert.doesNotMatch(html, /candidate=hires|dancers-hires/);
});

test('separate 17-cel artist sheets match their slots in the game atlas', () => {
  assert.deepEqual([characterManifest.columns, characterManifest.rows], [9, 2]);
  for (const [who, originalOffset] of [['tezzus', 0], ['diamond-star', 17]]) {
    const entry = characterManifest.characters[who];
    const one = decodePng(read(entry.sheet));
    const four = decodePng(read(entry.detail.sheet));
    assert.deepEqual([one.w, one.h], [504, 92]);
    assert.deepEqual([four.w, four.h], [2016, 368]);
    assert.equal(entry.detail.scale, 4);
    assert.equal(entry.frames.length, 17);
    for (let index = 0; index < 17; index++) {
      const frame = entry.frames[index];
      const originalCel = originalOffset + index;
      assert.equal(frame.index, index);
      assert.equal(frame.originalCel, originalCel);
      const sourceCell = manifest.cells[`power_calligraphy_people_cel${String(originalCel).padStart(3, '0')}`];
      for (let y = 0; y < 46; y++) for (let x = 0; x < 56; x++) {
        const isolated = one.px[(frame.y + y) * one.w + frame.x + x];
        const game = runtimeSheet.px[(sourceCell.y + y) * runtimeSheet.w + sourceCell.x + x];
        assert.equal(isolated, game, `${who} frame ${index} differs from original cel ${originalCel}`);
      }
    }
  }
});
