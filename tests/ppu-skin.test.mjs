import test from 'node:test';
import assert from 'node:assert/strict';
import { Ppu } from '../src/gba/ppu.ts';

globalThis.ImageData = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
};

const sprite = cel => ({ cel, x: 80, y: 88, z: 0x4800, order: 1, basePalette: 0, baseTile: 0, hflip: false, vflip: false, affine: null });
const raster = color => ({ w: 1, h: 1, x0: 0, y0: 0, rgba: new Uint8ClampedArray([...color, 255]), priority: 0 });
const pixel = image => [...image.data.slice((88 * 240 + 80) * 4, (88 * 240 + 80) * 4 + 4)];

test('registered skin replaces the tile cel, survives palette changes, and clears for another game', () => {
  const ppu = new Ppu(), cel = [];
  ppu.setRasterCels(new Map([[cel, raster([200, 100, 50])]]));
  assert.deepEqual(pixel(ppu.render([{ ...sprite(cel), basePalette: 1 }])), [200, 100, 50, 255]);
  ppu.setRasterCels();
  assert.deepEqual(pixel(ppu.render([sprite(cel)])), [0, 0, 0, 255]);
});

test('registered skin follows existing sprite depth and creation-order rules', () => {
  const ppu = new Ppu(), front = [], back = [];
  ppu.setRasterCels(new Map([[front, raster([255, 0, 0])], [back, raster([0, 0, 255])]]));
  assert.deepEqual(pixel(ppu.render([{ ...sprite(front), z: 1 }, { ...sprite(back), z: 2 }])), [255, 0, 0, 255]);
  assert.deepEqual(pixel(ppu.render([{ ...sprite(front), order: 1 }, { ...sprite(back), order: 2 }])), [0, 0, 255, 255]);
});

test('whole-screen fades apply to replacement art after compositing', () => {
  const ppu = new Ppu(), cel = [];
  ppu.setRasterCels(new Map([[cel, raster([200, 100, 50])]]));
  ppu.fade = { amount: 0.5, color: 0 };
  assert.deepEqual(pixel(ppu.render([sprite(cel)])), [100, 50, 25, 255]);
});
