// Replacement art uses the same sprite origin, depth and screen fade as tile cels.
export interface RasterCel {
  w: number;
  h: number;
  x0: number;
  y0: number;
  rgba: Uint8ClampedArray;
  priority: number;
  // Optional finer version of the same frame (scale x the pixels, same origin), drawn by the hi-res pass.
  detail?: { scale: number; w: number; h: number; x0: number; y0: number; rgba: Uint8ClampedArray };
}

export interface RasterTransform {
  x: number;
  y: number;
  hflip: boolean;
  vflip: boolean;
  affine: { scale: number; angle: number } | null;
}

export function drawRasterCel(
  cel: RasterCel,
  sprite: RasterTransform,
  out: Uint32Array,
  priorities: Uint8Array,
  screenW: number,
  screenH: number,
  owner?: Uint16Array,
  id = 0,
) {
  const put = (sx: number, sy: number, x: number, y: number) => {
    const i = sy * screenW + sx;
    if (cel.priority > priorities[i]) return;
    const source = (y * cel.w + x) * 4;
    const alpha = cel.rgba[source + 3];
    if (!alpha) return;
    const a = alpha / 255;
    const old = out[i];
    const r = Math.round(cel.rgba[source] * a + (old & 255) * (1 - a));
    const g = Math.round(cel.rgba[source + 1] * a + ((old >>> 8) & 255) * (1 - a));
    const b = Math.round(cel.rgba[source + 2] * a + ((old >>> 16) & 255) * (1 - a));
    out[i] = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
    priorities[i] = cel.priority;
    if (owner) owner[i] = id;
  };
  const cx = Math.round(sprite.x), cy = Math.round(sprite.y);
  if (!sprite.affine) {
    for (let y = 0; y < cel.h; y++) {
      const sy = cy + (sprite.vflip ? -(cel.y0 + y) - 1 : cel.y0 + y);
      if (sy < 0 || sy >= screenH) continue;
      for (let x = 0; x < cel.w; x++) {
        const sx = cx + (sprite.hflip ? -(cel.x0 + x) - 1 : cel.x0 + x);
        if (sx >= 0 && sx < screenW) put(sx, sy, x, y);
      }
    }
    return;
  }
  const { scale, angle } = sprite.affine;
  if (scale <= 0.01) return;
  const theta = (angle / 256) * Math.PI * 2;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const radius = Math.hypot(
    Math.max(Math.abs(cel.x0), Math.abs(cel.x0 + cel.w)),
    Math.max(Math.abs(cel.y0), Math.abs(cel.y0 + cel.h)),
  ) * scale + 1;
  const minX = Math.max(0, Math.floor(cx - radius)), maxX = Math.min(screenW, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius)), maxY = Math.min(screenH, Math.ceil(cy + radius));
  for (let sy = minY; sy < maxY; sy++) {
    for (let sx = minX; sx < maxX; sx++) {
      const dx = sx - cx + 0.5, dy = sy - cy + 0.5;
      let localX = (dx * cos + dy * sin) / scale;
      let localY = (-dx * sin + dy * cos) / scale;
      if (sprite.hflip) localX = -localX;
      if (sprite.vflip) localY = -localY;
      const x = Math.floor(localX) - cel.x0, y = Math.floor(localY) - cel.y0;
      if (x >= 0 && x < cel.w && y >= 0 && y < cel.h) put(sx, sy, x, y);
    }
  }
}
