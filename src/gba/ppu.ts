// A small software model of the GBA picture unit: 4bpp tiles, 16x16 palettes, four text BG layers
// and OAM sprites (built from decomp animation cels). Everything draws into a 240x160 RGBA buffer.
//
// Only the parts the Rhythm Tengoku engines use are modelled: text-mode BGs (256x256 wrap), 1D OBJ
// tile mapping, per-sprite affine scale/rotation, OBJ/BG priority, and palette-indexed colour so
// palette tricks (Karate Man's flow flashes, Power Calligraphy's glow) work like the original.

import { drawRasterCel, type RasterCel } from './raster-cel.ts';

export const SCREEN_W = 240;
export const SCREEN_H = 160;

export type Cel = number[][]; // [attr0, attr1, attr2][]

export interface BgLayer {
  visible: boolean;
  charBase: number; // byte offset into BG VRAM
  mapBase: number; // byte offset into BG VRAM
  priority: number;
  x: number; // scroll
  y: number;
}

export interface DrawSprite {
  cel: Cel;
  x: number;
  y: number;
  z: number;
  basePalette: number;
  baseTile: number;
  hflip: boolean;
  vflip: boolean;
  // Affine: visual scale (1 = normal) and rotation in 1/256ths of a turn.
  affine: { scale: number; angle: number } | null;
  order: number; // creation order, tie-break for equal z
}

// OAM size table [shape][size] -> [w, h]
const OBJ_SIZES = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];

function rgbToAbgr(rgb: number): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

// A cel pre-rendered into palette indices (cached, since cels are reused every frame).
interface CelBitmap {
  x0: number; // bounding box relative to the sprite position
  y0: number;
  w: number;
  h: number;
  // per pixel: 0 = transparent, else 0x8000 | (priority << 8) | (palette << 4) | colour
  px: Uint16Array;
}

export class Ppu {
  readonly bgVram = new Uint8Array(0x10000);
  readonly objVram = new Uint8Array(0x8000);
  readonly bgPal = new Uint32Array(256); // 0xRRGGBB
  readonly objPal = new Uint32Array(256);
  readonly layers: BgLayer[] = [0, 1, 2, 3].map(() => ({ visible: false, charBase: 0, mapBase: 0, priority: 3, x: 0, y: 0 }));
  readonly image = new ImageData(SCREEN_W, SCREEN_H);
  private readonly out = new Uint32Array(this.image.data.buffer);
  private readonly prio = new Uint8Array(SCREEN_W * SCREEN_H);
  private readonly celCache = new Map<string, CelBitmap>();
  private celIds = new WeakMap<Cel, number>();
  private nextCelId = 1;
  private rasterCels = new Map<Cel, RasterCel>();
  objMapping1D = false;
  // Screen fade (0 = none, 1 = fully covered) with an RGB colour.
  fade = { amount: 0, color: 0x000000 };

  setRasterCels(cels: ReadonlyMap<Cel, RasterCel> = new Map()) {
    this.rasterCels = new Map(cels);
  }

  loadObjTiles(data: Uint8Array, byteOffset = 0) {
    this.objVram.set(data.subarray(0, this.objVram.length - byteOffset), byteOffset);
    this.celCache.clear();
  }

  loadBgTiles(data: Uint8Array, byteOffset = 0) {
    this.bgVram.set(data.subarray(0, this.bgVram.length - byteOffset), byteOffset);
  }

  // palettes: arrays of 16 colours (0xRRGGBB); slot = first palette number to write.
  loadPalettes(target: 'bg' | 'obj', palettes: number[][], slot = 0, count = palettes.length) {
    const dst = target === 'bg' ? this.bgPal : this.objPal;
    for (let p = 0; p < count && slot + p < 16; p++) {
      for (let c = 0; c < 16; c++) dst[(slot + p) * 16 + c] = palettes[p]?.[c] ?? 0;
    }
  }

  private celBitmap(cel: Cel, baseTile: number, basePalette: number): CelBitmap {
    let id = this.celIds.get(cel);
    if (!id) {
      id = this.nextCelId++;
      this.celIds.set(cel, id);
    }
    const key = `${id}:${baseTile}:${basePalette}`;
    const hit = this.celCache.get(key);
    if (hit) return hit;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const parts = cel.map(([a0, a1, a2]) => {
      const y = ((a0 & 0xff) << 24) >> 24;
      const x = ((a1 & 0x1ff) << 23) >> 23;
      const [w, h] = OBJ_SIZES[(a0 >> 14) & 3]?.[(a1 >> 14) & 3] ?? [8, 8];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h);
      return {
        x, y, w, h,
        hflip: !!(a1 & 0x1000),
        vflip: !!(a1 & 0x2000),
        tile: (a2 & 0x3ff) + baseTile,
        pri: (a2 >> 10) & 3,
        pal: ((a2 >> 12) + basePalette) & 15,
      };
    });
    if (!cel.length) { x0 = y0 = 0; x1 = y1 = 1; }
    const w = x1 - x0, h = y1 - y0;
    const px = new Uint16Array(w * h);
    // OAM entry 0 has the highest priority, so draw back to front.
    // Rhythm Tengoku uses 2D OBJ mapping: a sprite's next tile row starts 32 tiles later.
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const tilesW = this.objMapping1D ? p.w >> 3 : 32;
      for (let ty = 0; ty < p.h; ty++) {
        for (let tx = 0; tx < p.w; tx++) {
          const sx = p.hflip ? p.w - 1 - tx : tx;
          const sy = p.vflip ? p.h - 1 - ty : ty;
          const tile = p.tile + (sy >> 3) * tilesW + (sx >> 3);
          const byte = this.objVram[(tile * 32 + (sy & 7) * 4 + ((sx & 7) >> 1)) & 0x7fff];
          const c = sx & 1 ? byte >> 4 : byte & 15;
          if (!c) continue;
          px[(p.y - y0 + ty) * w + (p.x - x0 + tx)] = 0x8000 | (p.pri << 8) | (p.pal << 4) | c;
        }
      }
    }
    const bmp = { x0, y0, w, h, px };
    this.celCache.set(key, bmp);
    return bmp;
  }

  render(sprites: DrawSprite[]) {
    const { out, prio, bgPal, objPal } = this;
    out.fill(rgbToAbgr(bgPal[0]));
    prio.fill(4);

    // BG layers: lowest priority (highest number) first; for equal priority, higher layer index is behind.
    const order = [0, 1, 2, 3]
      .filter((i) => this.layers[i].visible)
      .sort((a, b) => this.layers[b].priority - this.layers[a].priority || b - a);
    for (const li of order) {
      const L = this.layers[li];
      for (let y = 0; y < SCREEN_H; y++) {
        const my = (y + L.y) & 255;
        for (let x = 0; x < SCREEN_W; x++) {
          const mx = (x + L.x) & 255;
          const m = L.mapBase + ((my >> 3) * 32 + (mx >> 3)) * 2;
          const entry = this.bgVram[m] | (this.bgVram[m + 1] << 8);
          const tile = entry & 0x3ff;
          const px = entry & 0x400 ? 7 - (mx & 7) : mx & 7;
          const py = entry & 0x800 ? 7 - (my & 7) : my & 7;
          const byte = this.bgVram[(L.charBase + tile * 32 + py * 4 + (px >> 1)) & 0xffff];
          const c = px & 1 ? byte >> 4 : byte & 15;
          if (!c) continue;
          const i = y * SCREEN_W + x;
          out[i] = rgbToAbgr(bgPal[((entry >> 12) << 4) | c]);
          prio[i] = L.priority;
        }
      }
    }

    // Sprites: larger z is further back, so draw descending z; later-created on top for ties.
    const sorted = [...sprites].sort((a, b) => b.z - a.z || a.order - b.order);
    for (const s of sorted) {
      const raster = this.rasterCels.get(s.cel);
      if (raster) {
        drawRasterCel(raster, s, out, prio, SCREEN_W, SCREEN_H);
        continue;
      }
      const bmp = this.celBitmap(s.cel, s.baseTile, s.basePalette);
      const put = (sx: number, sy: number, v: number) => {
        const i = sy * SCREEN_W + sx;
        const p = (v >> 8) & 3;
        if (p > prio[i]) return;
        out[i] = rgbToAbgr(objPal[v & 0xff]);
        prio[i] = p;
      };
      if (!s.affine) {
        const bx = Math.round(s.x), by = Math.round(s.y);
        for (let y = 0; y < bmp.h; y++) {
          const sy = by + (s.vflip ? -(bmp.y0 + y) - 1 : bmp.y0 + y);
          if (sy < 0 || sy >= SCREEN_H) continue;
          for (let x = 0; x < bmp.w; x++) {
            const v = bmp.px[y * bmp.w + x];
            if (!v) continue;
            const sx = bx + (s.hflip ? -(bmp.x0 + x) - 1 : bmp.x0 + x);
            if (sx >= 0 && sx < SCREEN_W) put(sx, sy, v);
          }
        }
      } else {
        // Inverse-map every screen pixel in the transformed bounding box back into the cel.
        const { scale, angle } = s.affine;
        if (scale <= 0.01) continue;
        const th = (angle / 256) * Math.PI * 2;
        const cos = Math.cos(th), sin = Math.sin(th);
        const r = Math.hypot(Math.max(-bmp.x0, bmp.x0 + bmp.w), Math.max(-bmp.y0, bmp.y0 + bmp.h)) * scale + 1;
        const cx = Math.round(s.x), cy = Math.round(s.y);
        const yMin = Math.max(0, Math.floor(cy - r)), yMax = Math.min(SCREEN_H, Math.ceil(cy + r));
        const xMin = Math.max(0, Math.floor(cx - r)), xMax = Math.min(SCREEN_W, Math.ceil(cx + r));
        for (let sy = yMin; sy < yMax; sy++) {
          for (let sx = xMin; sx < xMax; sx++) {
            const dx = sx - cx + 0.5, dy = sy - cy + 0.5;
            const u = Math.floor((dx * cos + dy * sin) / scale) - bmp.x0;
            const w = Math.floor((-dx * sin + dy * cos) / scale) - bmp.y0;
            if (u < 0 || w < 0 || u >= bmp.w || w >= bmp.h) continue;
            const v = bmp.px[w * bmp.w + u];
            if (v) put(sx, sy, v);
          }
        }
      }
    }

    if (this.fade.amount > 0) {
      const a = Math.min(1, this.fade.amount);
      const fr = (this.fade.color >> 16) & 0xff, fg = (this.fade.color >> 8) & 0xff, fb = this.fade.color & 0xff;
      const d = this.image.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] += (fr - d[i]) * a;
        d[i + 1] += (fg - d[i + 1]) * a;
        d[i + 2] += (fb - d[i + 2]) * a;
      }
    }
    return this.image;
  }
}
