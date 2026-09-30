#!/usr/bin/env node
// Young Stoner Life dancers: new Tezzus and Diamond* sprites drawn on the original Power Calligraphy poses.
//   node tools/diamond-dancers.mjs
// The poses come from the original people cels (tools/lib/dancer-poses.mjs, one per cel), so the game plays
// the same animation with the same frame timing; the characters themselves are new: their own proportions,
// silhouettes and outfits, in the Rhythm Heaven GBA language (bold 1-pixel black outlines, flat colours,
// round mitt hands, big heads, chunky shoes).
// Drawn at 4x density (fine details: piercings, GG, tattoos, shades, scales) and reduced to a 1x occlusion mask.
// Writes public/skins/diamond-star/calligraphy/dancers.png, dancers@4x.png, dancers.json and
// reference/specs/power_calligraphy/diamond-dancers_preview.png.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/decomp.mjs';
import { Image } from './lib/png.mjs';
import { POSES } from './lib/dancer-poses.mjs';

const D = 4; // detail pixels per game pixel
const CELL = { w: 56, h: 46, ax: 28, ay: 42 }; // 1x cell, anchor = sprite origin
const SCALE = 1.1; // the new characters are a little bigger than the originals
const OL = 0.9; // outline width (game pixels)

// ---------- tiny vector rasterizer (coords in game pixels relative to the anchor) ----------
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  len: (a) => Math.hypot(a[0], a[1]),
  norm: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
};
function segDist(p, a, b) {
  const ab = V.sub(b, a), t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1)));
  return { d: V.dist(p, V.add(a, V.mul(ab, t))), t };
}
const circle = (c, r) => ({ box: [c[0] - r, c[1] - r, c[0] + r, c[1] + r], test: (p) => V.dist(p, c) <= r, grow: (g) => circle(c, r + g) });
const capsule = (a, b, r0, r1 = r0) => ({
  box: [Math.min(a[0], b[0]) - Math.max(r0, r1), Math.min(a[1], b[1]) - Math.max(r0, r1), Math.max(a[0], b[0]) + Math.max(r0, r1), Math.max(a[1], b[1]) + Math.max(r0, r1)],
  test: (p) => { const { d, t } = segDist(p, a, b); return d <= r0 + (r1 - r0) * t; },
  grow: (g) => capsule(a, b, r0 + g, r1 + g),
});
const ellipse = (c, rx, ry, ang = 0) => {
  const co = Math.cos(ang), si = Math.sin(ang), R = Math.max(rx, ry);
  return {
    box: [c[0] - R, c[1] - R, c[0] + R, c[1] + R],
    test: (p) => { const dx = p[0] - c[0], dy = p[1] - c[1]; const u = dx * co + dy * si, w = -dx * si + dy * co; return (u / rx) ** 2 + (w / ry) ** 2 <= 1; },
    grow: (g) => ellipse(c, rx + g, ry + g, ang),
  };
};
function poly(pts, pad = 0) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const inside = (p) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  return {
    box: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad],
    test: (p) => inside(p) || (pad > 0 && pts.some((a, i) => segDist(p, a, pts[(i + 1) % pts.length]).d <= pad)),
    grow: (g) => poly(pts, pad + g),
  };
}

const INK = '#000000';
class Canvas {
  constructor() {
    this.w = CELL.w * D;
    this.h = CELL.h * D;
    this.px = new Array(this.w * this.h).fill(null);
  }
  fill(shape, color, clip) {
    const [x0, y0, x1, y1] = shape.box;
    const X0 = Math.max(0, Math.floor((x0 + CELL.ax) * D)), X1 = Math.min(this.w - 1, Math.ceil((x1 + CELL.ax) * D));
    const Y0 = Math.max(0, Math.floor((y0 + CELL.ay) * D)), Y1 = Math.min(this.h - 1, Math.ceil((y1 + CELL.ay) * D));
    for (let Y = Y0; Y <= Y1; Y++)
      for (let X = X0; X <= X1; X++) {
        const p = [(X + 0.5) / D - CELL.ax, (Y + 0.5) / D - CELL.ay];
        if (!shape.test(p) || (clip && !clip(p, this.px[Y * this.w + X]))) continue;
        const c = typeof color === 'function' ? color(p, X, Y) : color;
        if (c) this.px[Y * this.w + X] = c;
      }
  }
  // Outlined shape: black grown copy first, then the fill (so overlapping parts get inner outlines too).
  draw(shape, color, ol = OL) {
    if (ol > 0) this.fill(shape.grow(ol), INK);
    this.fill(shape, color);
  }
  dot(p, color) { // one detail pixel at game coords p
    const X = Math.floor((p[0] + CELL.ax) * D), Y = Math.floor((p[1] + CELL.ay) * D);
    if (X >= 0 && Y >= 0 && X < this.w && Y < this.h) this.px[Y * this.w + X] = color;
  }
}

// ---------- pose -> skeleton ----------
function skeleton(pose, build) {
  const S = (p) => V.mul(p, SCALE);
  const head = S(pose.head), neck = S(pose.neck), hip = S(pose.hip);
  const u = V.norm(V.sub(hip, neck)); // down the spine
  const v = [u[1], -u[0]]; // across the body (screen-right when upright)
  const sd = V.add(neck, V.mul(u, build.shoulderDrop));
  const sh = [V.add(sd, V.mul(v, -build.shoulder)), V.add(sd, V.mul(v, build.shoulder))];
  const hp = [V.add(hip, V.mul(v, -build.hipW)), V.add(hip, V.mul(v, build.hipW))];
  let arms = pose.arms.map(([e, h]) => [S(e), S(h)]);
  let legs = pose.legs.map(([k, f]) => [S(k), S(f)]);
  // each limb goes to the nearer shoulder / hip socket
  if (V.dist(arms[0][0], sh[0]) + V.dist(arms[1][0], sh[1]) > V.dist(arms[0][0], sh[1]) + V.dist(arms[1][0], sh[0])) arms = [arms[1], arms[0]];
  if (V.dist(legs[0][0], hp[0]) + V.dist(legs[1][0], hp[1]) > V.dist(legs[0][0], hp[1]) + V.dist(legs[1][0], hp[0])) legs = [legs[1], legs[0]];
  return { head, neck, hip, u, v, sh, hp, arms, legs, facing: pose.facing, down: !!pose.down, upright: u[1] > 0.6 };
}

// shoe pointing outward (or where the head faces), sitting on the foot point
function shoe(cv, foot, knee, sk, o) {
  const out = sk.facing || Math.sign(foot[0] - sk.hip[0]) || 1;
  const lifted = !sk.upright || foot[1] < -4;
  const dir = lifted ? V.norm(V.sub(foot, knee)) : [out, 0];
  const c = V.add(foot, V.mul(dir, o.toe));
  const ang = Math.atan2(dir[1], dir[0]);
  cv.draw(ellipse(c, o.rx, o.ry, ang), (p) => {
    const rel = V.sub(p, c), along = rel[0] * Math.cos(ang) + rel[1] * Math.sin(ang), across = -rel[0] * Math.sin(ang) + rel[1] * Math.cos(ang);
    if (across * Math.sign(Math.cos(ang) || 1) > o.ry * 0.35) return o.sole;
    if (o.stripe && Math.abs(across * Math.sign(Math.cos(ang) || 1) + 0.15 - along * out * 0.25) < 0.26 && Math.abs(along) < o.rx * 0.6) return o.sole;
    return o.color;
  });
}
const strands = (base, lit) => (p, X, Y) => ((X + 1000 + Math.floor((Y + 1000) / 6)) % 4 === 0 ? lit : base);

// ---------- Tezzus ----------
const TZ = {
  skin: '#7a4a33', hair: '#15100e', hairLit: '#3b2d27', ink: '#1d120c',
  red: '#cf2229', redDark: '#7a0c12', redLit: '#f4675d', tank: '#f4f1ea',
  denim: '#a9c2dc', rip: '#f5f7fa', shoe: '#cc1f27', sole: '#f4f1ea',
  lens: '#2b0d12', lensLit: '#a0707a', silver: '#d7dde6', gold: '#e2b33b',
};
const TZ_BUILD = { shoulder: 3.4, shoulderDrop: 1.0, hipW: 1.7 };
// red leather scales: rows of overlapping rounded scales, dark lower rims, a glint on each
const scales = (p, X, Y) => {
  const row = Math.floor((Y + 1000) / 5), off = (row & 1) * 3;
  const cx = (X + 1000 + off) % 6, cy = (Y + 1000) % 5;
  if (cy === 4 || (cy === 3 && (cx === 0 || cx === 5))) return TZ.redDark;
  if (cy === 0 && (cx === 2 || cx === 3)) return TZ.redLit;
  return TZ.red;
};

function tezzus(pose) {
  const sk = skeleton(pose, TZ_BUILD), cv = new Canvas();
  const { head, neck, hip, u, v, sh, hp } = sk;
  const HR = 4.3;
  // dreads hanging behind the head
  if (!sk.down)
    for (const s of [-1, 1])
      for (let i = 0; i < 3; i++) {
        const a = V.add(head, [s * (2.6 + i * 0.7), -1.8 + i * 0.4]);
        cv.draw(capsule(a, V.add(a, [s * 0.9, 4.2 - i * 0.6]), 0.95, 0.75), strands(TZ.hair, TZ.hairLit), 0.7);
      }
  // legs: skinny ripped jeans, red high-tops
  sk.legs.forEach(([knee, foot], i) => {
    const socket = hp[i], mid = V.lerp(socket, knee, 0.55);
    const rips = (p) => {
      if (V.dist(p, knee) < 1.1 && Math.abs(p[1] - knee[1] + 0.2) < 0.35) return TZ.rip;
      if (V.dist(p, mid) < 0.9 && Math.abs(p[1] - mid[1]) < 0.28) return TZ.rip;
      return TZ.denim;
    };
    cv.draw(capsule(socket, knee, 1.75, 1.55), rips);
    cv.draw(capsule(knee, foot, 1.55, 1.35), rips);
    shoe(cv, foot, knee, sk, { color: TZ.shoe, sole: TZ.sole, rx: 2.5, ry: 1.6, toe: 0.9 });
  });
  // belt with a gold buckle
  cv.draw(capsule(V.add(hp[0], V.mul(v, -0.4)), V.add(hp[1], V.mul(v, 0.4)), 1.0), '#1b1616');
  cv.draw(circle(hip, 0.75), TZ.gold, 0.45);
  // cropped scale jacket, open over a white tank
  const waist = V.add(hip, V.mul(u, -1.0));
  cv.draw(poly([V.add(sh[0], V.mul(v, -0.9)), V.add(sh[1], V.mul(v, 0.9)), V.add(waist, V.mul(v, 3.0)), V.add(waist, V.mul(v, -3.0))]), scales);
  const tank = poly([V.add(neck, V.mul(v, -1.3)), V.add(neck, V.mul(v, 1.3)), V.add(waist, V.mul(v, 1.1)), V.add(waist, V.mul(v, -1.1))]);
  cv.fill(tank.grow(0.35), INK); // lapel edges
  cv.fill(tank, TZ.tank);
  cv.fill(circle(V.add(neck, V.mul(u, 0.6)), 1.0), TZ.skin); // neckline
  for (let t = 0; t <= 1; t += 0.04) cv.dot(V.add(V.add(neck, V.mul(v, (t - 0.5) * 2.2)), V.mul(u, 1.4 + Math.sin(t * Math.PI) * 1.2)), TZ.silver); // chain
  // arms: scale sleeves, tattooed hands
  sk.arms.forEach(([elbow, hand], i) => {
    cv.draw(capsule(sh[i], elbow, 1.9, 1.7), scales);
    cv.draw(capsule(elbow, hand, 1.7, 1.5), scales);
    const hd = V.norm(V.sub(hand, elbow)), hc = V.add(hand, V.mul(hd, 0.6));
    cv.draw(circle(hc, 1.55), (p) => {
      const q = V.sub(p, hc);
      const ink = (Math.abs(q[1] + 0.35) < 0.14 && Math.abs(q[0]) < 0.9) || (Math.abs(q[1] - 0.45) < 0.14 && Math.abs(q[0] - 0.2) < 0.7) || V.len(V.sub(q, [-0.6, 0.1])) < 0.2;
      return ink ? TZ.ink : TZ.skin;
    });
  });
  // shoulder flaps: jagged leather scales sticking out
  for (const i of [0, 1]) {
    const s = i ? 1 : -1;
    for (let k = 0; k < 3; k++) {
      const a = V.add(sh[i], V.add(V.mul(v, s * (-0.6 + k * 0.9)), V.mul(u, -0.3 + k * 0.7)));
      const tip = V.add(a, V.add(V.mul(v, s * 2.0), V.mul(u, -1.2 + k * 0.9)));
      cv.draw(poly([V.add(a, V.mul(u, -0.9)), tip, V.add(a, V.mul(u, 0.9))]), TZ.red, 0.7);
    }
  }
  // head
  cv.draw(capsule(neck, V.lerp(neck, head, 0.4), 1.1), TZ.skin);
  cv.draw(circle(head, HR), TZ.skin);
  if (!sk.down) {
    const f = sk.facing, fc = V.add(head, [f * 1.1, 0.3]), sp = f ? 0.72 : 1;
    const sy = fc[1] - 0.6; // shield shades
    const shades = poly([[fc[0] - 3.6 * sp, sy - 1.0], [fc[0] + 3.6 * sp, sy - 1.0], [fc[0] + 3.2 * sp, sy + 1.1], [fc[0] + 0.3, sy + 0.8], [fc[0] - 0.3, sy + 0.8], [fc[0] - 3.2 * sp, sy + 1.1]]);
    cv.draw(shades, (p) => (Math.abs(p[1] - sy + (p[0] - fc[0]) * 0.35) < 0.18 && p[1] < sy + 0.5 ? TZ.lensLit : TZ.lens), 0.5);
    cv.fill(capsule([fc[0] - 0.6 * sp, sy + 2.9], [fc[0] + 0.7 * sp, sy + 2.8], 0.3), TZ.ink); // mouth
  }
  // dread mop on top
  const top = sk.down ? V.add(head, [0, -0.6]) : head;
  for (let k = 0; k < 9; k++) {
    const ang = Math.PI * (1.05 + (k / 8) * 0.9);
    cv.draw(circle(V.add(top, [Math.cos(ang) * (HR - 0.1), Math.sin(ang) * (HR - 0.1) - 1.3]), 1.5 + (k % 2) * 0.3), strands(TZ.hair, TZ.hairLit), 0.7);
  }
  cv.draw(ellipse(V.add(top, [0, -3.3]), HR - 0.3, 2.0), strands(TZ.hair, TZ.hairLit), 0);
  if (sk.down) cv.draw(circle(head, HR - 0.3), strands(TZ.hair, TZ.hairLit), 0.6);
  return cv;
}

// ---------- Diamond* ----------
const DM = {
  skin: '#5a3526', hair: '#120e0c', hairLit: '#3a2c25', fleece: '#efe6d1', fleeceShade: '#d8ccb3',
  red: '#c61f29', green: '#1d6a41', gold: '#e4b53b', tee: '#fbfaf6', denim: '#3a5a86', denimDark: '#2a4266',
  vans: '#1c1c1c', sole: '#f4f4f2', stud: '#dfe6ef', studLit: '#ffffff', studShade: '#8e99a8', eye: '#0b0908',
};
const DM_BUILD = { shoulder: 3.8, shoulderDrop: 1.1, hipW: 2.0 };
const sherpa = (p, X, Y) => (((X + 1000) * 5 + (Y + 1000) * 3) % 9 === 0 || ((X + 1000) * 3 + (Y + 1000) * 7) % 11 === 0 ? DM.fleeceShade : DM.fleece);

function diamond(pose) {
  const sk = skeleton(pose, DM_BUILD), cv = new Canvas();
  const { head, neck, hip, u, v, sh, hp } = sk;
  const HR = 4.6;
  // legs: baggy dark jeans, black/white Vans
  sk.legs.forEach(([knee, foot], i) => {
    cv.draw(capsule(hp[i], knee, 2.15, 2.0), (p) => (Math.abs(segDist(p, hp[i], knee).d - 1.2) < 0.15 ? DM.denimDark : DM.denim));
    cv.draw(capsule(knee, foot, 2.0, 2.1), DM.denim);
    shoe(cv, foot, knee, sk, { color: DM.vans, sole: DM.sole, rx: 2.7, ry: 1.6, toe: 1.0, stripe: true });
  });
  // oversized sherpa fleece: boxy body to the hips, red zip piping, Gucci web patch with gold GG
  const hem = V.add(hip, V.mul(u, 0.9));
  cv.draw(poly([V.add(sh[0], V.mul(v, -1.2)), V.add(sh[1], V.mul(v, 1.2)), V.add(hem, V.mul(v, 4.2)), V.add(hem, V.mul(v, -4.2))]), sherpa);
  cv.fill(poly([V.add(neck, V.mul(v, -1.4)), V.add(neck, V.mul(v, 1.4)), V.add(neck, V.mul(u, 3.0))]), DM.tee); // tee in the collar
  cv.fill(capsule(V.add(neck, V.mul(u, 3.0)), V.add(hem, V.mul(u, -0.2)), 0.28), DM.red); // zip piping
  if (sk.upright) {
    const pc = V.add(V.add(neck, V.mul(u, 4.2)), V.mul(v, -2.2));
    const W = 1.35, H = 2.1;
    cv.fill(poly([V.add(pc, [-W, -H]), V.add(pc, [W, -H]), V.add(pc, [W, H]), V.add(pc, [-W, H])]), (p) => (Math.abs(p[0] - pc[0]) < W / 3 ? DM.red : DM.green));
    const G = ['.ggg..', 'g...g.', 'g.....', 'g..gg.', 'g...g.', '.ggg..'];
    const X0 = Math.round((pc[0] + CELL.ax) * D) - 5, Y0 = Math.round((pc[1] + CELL.ay) * D) - 3;
    G.forEach((r, j) => [...r].forEach((ch, i) => {
      if (ch !== 'g') return;
      cv.px[(Y0 + j) * cv.w + X0 + i] = DM.gold; // G
      cv.px[(Y0 + j) * cv.w + X0 + 9 - i] = DM.gold; // mirrored G, interlocking
    }));
  }
  // puffy sherpa sleeves with red cuffs
  sk.arms.forEach(([elbow, hand], i) => {
    cv.draw(capsule(sh[i], elbow, 2.35, 2.2), sherpa);
    const hd = V.norm(V.sub(hand, elbow)), wrist = V.add(hand, V.mul(hd, -1.2));
    cv.draw(capsule(elbow, wrist, 2.2, 2.1), sherpa);
    cv.draw(capsule(V.add(wrist, V.mul(hd, -0.5)), V.add(wrist, V.mul(hd, 0.25)), 1.9), DM.red, 0.6);
    cv.draw(circle(V.add(hand, V.mul(hd, 0.3)), 1.55), DM.skin);
  });
  // soft collar with a red edge
  cv.draw(ellipse(V.add(neck, V.mul(u, 0.4)), 3.2, 1.5, Math.atan2(v[1], v[0])), (p) => (V.dist(p, neck) > 2.6 ? DM.red : DM.fleece), 0.7);
  // head
  cv.draw(circle(head, HR), DM.skin);
  // hair: dark cap + tied-up dreads fanning from the crown, red tie
  const crown = V.add(head, sk.down ? [0, 0] : [0, -HR + 0.1]);
  const cap = sk.down
    ? circle(head, HR - 0.2)
    : poly([...Array(13)].map((_, k) => { const a = Math.PI * (1 + k / 12); return V.add(head, [Math.cos(a) * HR, Math.sin(a) * HR + (k === 0 || k === 12 ? 0.6 : 0)]); }).concat([V.add(head, [HR * 0.7, -1.2]), V.add(head, [-HR * 0.7, -1.2])]));
  cv.fill(cap, strands(DM.hair, DM.hairLit));
  if (!sk.down)
    for (let k = 0; k < 7; k++) {
      const ang = -Math.PI / 2 + (k - 3) * 0.42, L = 5.0 - Math.abs(k - 3) * 0.3;
      const tip = V.add(crown, [Math.cos(ang) * L, Math.sin(ang) * L + Math.abs(k - 3) * 0.35]);
      cv.draw(capsule(V.add(crown, [0, -0.8]), tip, 0.85, 0.55), strands(DM.hair, DM.hairLit), 0.6);
    }
  if (!sk.down) cv.draw(ellipse(V.add(crown, [0, -1.0]), 1.2, 0.65), DM.red, 0.55);
  if (!sk.down) {
    const f = sk.facing, fc = V.add(head, [f * 1.2, 0.6]), sp = f ? 0.72 : 1;
    for (const s of [-1, 1]) {
      const e = V.add(fc, [s * 1.6 * sp, -0.5]);
      cv.fill(ellipse(e, 0.55, 0.8), DM.eye);
      cv.dot(V.add(e, [-0.2, -0.4]), '#ffffff');
    }
    // small smile
    cv.fill(capsule([fc[0] - 0.95 * sp, fc[1] + 1.85], [fc[0], fc[1] + 2.25], 0.22), DM.eye);
    cv.fill(capsule([fc[0], fc[1] + 2.25], [fc[0] + 0.95 * sp, fc[1] + 1.85], 0.22), DM.eye);
    // nine piercings: 3 descending on the forehead, cheekbones, dimples, bottom corners of the mouth
    const studs = [[0, -3.3], [0, -2.6], [0, -1.9], [-2.9, 0.2], [2.9, 0.2], [-2.6, 1.5], [2.6, 1.5], [-1.4, 2.75], [1.4, 2.75]];
    for (const [dx, dy] of studs) {
      const c = V.add(fc, [dx * sp, dy]);
      const X = Math.round((c[0] + CELL.ax) * D), Y = Math.round((c[1] + CELL.ay) * D);
      cv.px[(Y - 1) * cv.w + X - 1] = DM.studLit;
      cv.px[(Y - 1) * cv.w + X] = DM.stud;
      cv.px[Y * cv.w + X - 1] = DM.stud;
      cv.px[Y * cv.w + X] = DM.studShade;
    }
  }
  return cv;
}

// ---------- sheet ----------
const COLS = 9, N = POSES.length;
const rgba = (s, a = 255) => ((parseInt(s.slice(1), 16) << 8) | a) >>> 0;
const sheet1 = new Image(COLS * CELL.w, Math.ceil(N / COLS) * CELL.h);
const sheet4 = new Image(COLS * CELL.w * D, Math.ceil(N / COLS) * CELL.h * D);
const PS = 2; // preview: detail sheet at 2x (8 px per game pixel)
const prev = new Image(COLS * CELL.w * D * PS, Math.ceil(N / COLS) * CELL.h * D * PS, rgba('#f4efe6'));
const cells = {};
for (let n = 0; n < N; n++) {
  const cv = n < 17 ? tezzus(POSES[n]) : diamond(POSES[n]);
  const name = `power_calligraphy_people_cel${String(n).padStart(3, '0')}`;
  const cx = (n % COLS) * CELL.w, cy = Math.floor(n / COLS) * CELL.h;
  cells[name] = { x: cx, y: cy, w: CELL.w, h: CELL.h, ax: CELL.ax, ay: CELL.ay, who: n < 17 ? 'tezzus' : 'diamond' };
  prev.rect(cx * D * PS, cy * D * PS, CELL.w * D * PS, CELL.h * D * PS, rgba('#c8c2b8'));
  for (let Y = 0; Y < cv.h; Y++)
    for (let X = 0; X < cv.w; X++) {
      const c = cv.px[Y * cv.w + X];
      if (!c) continue;
      sheet4.px[(cy * D + Y) * sheet4.w + cx * D + X] = rgba(c);
      prev.fill((cx * D + X) * PS, (cy * D + Y) * PS, PS, PS, rgba(c));
    }
  // 1x mask: a game pixel is covered if any of its detail pixels is; colour = the most common one
  for (let y = 0; y < CELL.h; y++)
    for (let x = 0; x < CELL.w; x++) {
      const count = new Map();
      for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) { const c = cv.px[(y * D + j) * cv.w + x * D + i]; if (c) count.set(c, (count.get(c) ?? 0) + 1); }
      if (count.size) sheet1.px[(cy + y) * sheet1.w + cx + x] = rgba([...count].sort((a, b) => b[1] - a[1])[0][0]);
    }
  prev.text(cx * D * PS + 6, cy * D * PS + 6, String(n), rgba('#6b6560'), 4);
}
const out = join(ROOT, 'public', 'skins', 'diamond-star', 'calligraphy');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'dancers.png'), sheet1.png());
writeFileSync(join(out, 'dancers@4x.png'), sheet4.png());
writeFileSync(
  join(out, 'dancers.json'),
  JSON.stringify({
    note: 'Young Stoner Life dancers (man cels -> Tezzus, woman cels -> Diamond*), new art on the original poses. Generated by tools/diamond-dancers.mjs.',
    sheet: 'dancers.png', detail: { sheet: 'dancers@4x.png', scale: D }, cells,
  }, null, 1) + '\n',
);
const specs = join(ROOT, 'reference', 'specs', 'power_calligraphy');
mkdirSync(specs, { recursive: true });
writeFileSync(join(specs, 'diamond-dancers_preview.png'), prev.png());
console.log('wrote', N, 'frames');
