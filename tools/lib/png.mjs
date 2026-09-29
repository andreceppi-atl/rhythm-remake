// Minimal RGBA PNG encoder + tiny drawing helpers (no dependencies).
import { deflateSync, inflateSync } from 'node:zlib';

// Decode an 8-bit, non-interlaced PNG (grey, grey+alpha, RGB, RGBA or palette) into an Image.
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), t = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') [w, h, depth, type, interlace] = [d.readUInt32BE(0), d.readUInt32BE(4), d[8], d[9], d[12]];
    else if (t === 'PLTE') plte = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth} (export 8-bit)`);
  if (interlace) throw new Error('interlaced PNG not supported (export non-interlaced)');
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!bpp) throw new Error(`unsupported colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const img = new Image(w, h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const i = x * bpp;
      let r, g, bl, al = 255;
      if (type === 6) [r, g, bl, al] = [cur[i], cur[i + 1], cur[i + 2], cur[i + 3]];
      else if (type === 2) [r, g, bl] = [cur[i], cur[i + 1], cur[i + 2]];
      else if (type === 0) r = g = bl = cur[i];
      else if (type === 4) [r, g, bl, al] = [cur[i], cur[i], cur[i], cur[i + 1]];
      else {
        const k = cur[i];
        [r, g, bl] = [plte[k * 3], plte[k * 3 + 1], plte[k * 3 + 2]];
        al = trns && k < trns.length ? trns[k] : 255;
      }
      img.px[y * w + x] = ((r << 24) | (g << 16) | (bl << 8) | al) >>> 0;
    }
    cur.copy(prev);
  }
  return img;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export class Image {
  constructor(w, h, fill = 0x00000000) {
    this.w = w;
    this.h = h;
    this.px = new Uint32Array(w * h).fill(fill >>> 0); // 0xRRGGBBAA
  }
  set(x, y, rgba) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const a = (rgba & 0xff) / 255;
    if (a >= 1) return void (this.px[y * this.w + x] = rgba >>> 0);
    if (a <= 0) return;
    const d = this.px[y * this.w + x];
    const mix = (s, t) => Math.round(((rgba >>> s) & 0xff) * a + ((d >>> s) & 0xff) * (1 - a));
    const da = Math.max(d & 0xff, rgba & 0xff);
    this.px[y * this.w + x] = ((mix(24) << 24) | (mix(16) << 16) | (mix(8) << 8) | da) >>> 0;
  }
  rect(x, y, w, h, rgba) {
    for (let i = 0; i < w; i++) {
      this.set(x + i, y, rgba);
      this.set(x + i, y + h - 1, rgba);
    }
    for (let j = 0; j < h; j++) {
      this.set(x, y + j, rgba);
      this.set(x + w - 1, y + j, rgba);
    }
  }
  fill(x, y, w, h, rgba) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, rgba);
  }
  // 3x5 pixel digits/letters for labels, scaled by `s`.
  text(x, y, str, rgba, s = 1) {
    let cx = x;
    for (const ch of String(str).toUpperCase()) {
      const g = FONT[ch];
      if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r] & (4 >> c)) this.fill(cx + c * s, y + r * s, s, s, rgba);
      cx += 4 * s;
    }
  }
  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      for (let x = 0; x < this.w; x++) raw.writeUInt32BE(this.px[y * this.w + x], y * (this.w * 4 + 1) + 1 + x * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

const FONT = {
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 3, 1, 7], 4: [5, 5, 7, 1, 1],
  5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 1, 2, 2], 8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7],
  A: [2, 5, 7, 5, 5], B: [6, 5, 6, 5, 6], C: [3, 4, 4, 4, 3], D: [6, 5, 5, 5, 6], E: [7, 4, 6, 4, 7],
  F: [7, 4, 6, 4, 4], G: [3, 4, 5, 5, 3], H: [5, 5, 7, 5, 5], I: [7, 2, 2, 2, 7], J: [1, 1, 1, 5, 2],
  K: [5, 5, 6, 5, 5], L: [4, 4, 4, 4, 7], M: [5, 7, 7, 5, 5], N: [6, 5, 5, 5, 5], O: [2, 5, 5, 5, 2],
  P: [6, 5, 6, 4, 4], Q: [2, 5, 5, 6, 3], R: [6, 5, 6, 5, 5], S: [3, 4, 2, 1, 6], T: [7, 2, 2, 2, 2],
  U: [5, 5, 5, 5, 7], V: [5, 5, 5, 5, 2], W: [5, 5, 7, 7, 5], X: [5, 5, 2, 5, 5], Y: [5, 5, 2, 2, 2],
  Z: [7, 1, 2, 4, 7], '-': [0, 0, 7, 0, 0], '_': [0, 0, 0, 0, 7], '.': [0, 0, 0, 0, 2], ':': [0, 2, 0, 2, 0],
  '/': [1, 1, 2, 4, 4], '+': [0, 2, 7, 2, 0], ' ': [0, 0, 0, 0, 0],
};
