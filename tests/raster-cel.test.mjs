import test from 'node:test';
import assert from 'node:assert/strict';
import { drawRasterCel } from '../src/gba/raster-cel.ts';

const red = 0xff0000ff, blue = 0xffff0000, black = 0xff000000;
const cel = { w: 2, h: 1, x0: -1, y0: -1, rgba: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), priority: 0 };
const transform = { x: 3, y: 3, hflip: false, vflip: false, affine: null };
function render(art = cel, placement = {}, background = black, priorities) {
  const out = new Uint32Array(36).fill(background);
  const prio = priorities ?? new Uint8Array(36).fill(4);
  drawRasterCel(art, { ...transform, ...placement }, out, prio, 6, 6);
  return { out, prio };
}

test('anchors are relative to the sprite; transparent area is untouched', () => {
  const { out } = render();
  assert.equal(out[2 * 6 + 2], red);
  assert.equal(out[2 * 6 + 3], blue);
  assert.equal(out[3 * 6 + 3], black);
  assert.equal([...out].filter(x => x !== black).length, 2);
});

test('mirroring stays centered on the same anchor, including affine identity', () => {
  const plain = render(cel, { hflip: true, vflip: true }).out;
  const affine = render(cel, { hflip: true, vflip: true, affine: { scale: 1, angle: 0 } }).out;
  assert.deepEqual(affine, plain);
  assert.equal(plain[3 * 6 + 3], red);
  assert.equal(plain[3 * 6 + 2], blue);
});

test('affine quarter-turn and 2x scale preserve nearest-neighbor source pixels', () => {
  const rotated = render(cel, { affine: { scale: 1, angle: 64 } }).out;
  assert.equal(rotated[2 * 6 + 3], red);
  assert.equal(rotated[3 * 6 + 3], blue);
  const scaled = render(cel, { affine: { scale: 2, angle: 0 } }).out;
  assert.equal([...scaled].filter(x => x === red).length, 4);
  assert.equal([...scaled].filter(x => x === blue).length, 4);
});

test('alpha blends against the background, alpha 0 preserves depth, and nearer layers win', () => {
  const translucent = { ...cel, rgba: new Uint8ClampedArray([255, 0, 0, 128, 0, 0, 255, 0]) };
  const { out, prio } = render(translucent, {}, blue);
  assert.equal(out[2 * 6 + 2], 0xff7f0080);
  assert.equal(out[2 * 6 + 3], blue);
  assert.equal(prio[2 * 6 + 2], 0);
  assert.equal(prio[2 * 6 + 3], 4);
  const blocked = render({ ...cel, priority: 2 }, {}, black, new Uint8Array(36).fill(1)).out;
  assert.ok([...blocked].every(x => x === black));
});

test('off-screen clipping never wraps into an adjacent row', () => {
  const { out } = render(cel, { x: 0, y: 1 });
  assert.equal(out[0], blue);
  assert.equal([...out].filter(x => x !== black).length, 1);
  assert.ok([...render(cel, { affine: { scale: 0, angle: 0 } }).out].every(x => x === black));
});
