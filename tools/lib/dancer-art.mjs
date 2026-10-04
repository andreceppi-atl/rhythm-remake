// Dancer art for Power Calligraphy's Young Stoner Life: a tiny vector rasterizer, the pose -> skeleton rig,
// and the character drawings. Used by tools/diamond-dancers.mjs (game sheets) and tools/sprite-lab.mjs (lab).
// Two styles: HD (4x density, fine details) and GBA (true 1x pixel art, see gbaTezzus / gbaDiamond).
export const D = 4; // Canonical art scale: four crisp source pixels per game pixel.
export const CELL = { w: 56, h: 46, ax: 28, ay: 42 }; // 1x cell, anchor = sprite origin
const SCALE = 1.1; // the new characters are a little bigger than the originals
const OL = 0.9; // outline width (game pixels)

// ---------- tiny vector rasterizer (coords in game pixels relative to the anchor) ----------
export const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, k) => [a[0] * k, a[1] * k],
  len: (a) => Math.hypot(a[0], a[1]),
  norm: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
};
export function segDist(p, a, b) {
  const ab = V.sub(b, a), t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1)));
  return { d: V.dist(p, V.add(a, V.mul(ab, t))), t };
}
export const circle = (c, r) => ({ box: [c[0] - r, c[1] - r, c[0] + r, c[1] + r], test: (p) => V.dist(p, c) <= r, grow: (g) => circle(c, r + g) });
export const capsule = (a, b, r0, r1 = r0) => ({
  box: [Math.min(a[0], b[0]) - Math.max(r0, r1), Math.min(a[1], b[1]) - Math.max(r0, r1), Math.max(a[0], b[0]) + Math.max(r0, r1), Math.max(a[1], b[1]) + Math.max(r0, r1)],
  test: (p) => { const { d, t } = segDist(p, a, b); return d <= r0 + (r1 - r0) * t; },
  grow: (g) => capsule(a, b, r0 + g, r1 + g),
});
export const ellipse = (c, rx, ry, ang = 0) => {
  const co = Math.cos(ang), si = Math.sin(ang), R = Math.max(rx, ry);
  return {
    box: [c[0] - R, c[1] - R, c[0] + R, c[1] + R],
    test: (p) => { const dx = p[0] - c[0], dy = p[1] - c[1]; const u = dx * co + dy * si, w = -dx * si + dy * co; return (u / rx) ** 2 + (w / ry) ** 2 <= 1; },
    grow: (g) => ellipse(c, rx + g, ry + g, ang),
  };
};
export function poly(pts, pad = 0) {
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

export const INK = '#000000';
export class Canvas {
  constructor(D = 4) {
    this.D = D;
    this.w = CELL.w * D;
    this.h = CELL.h * D;
    this.px = new Array(this.w * this.h).fill(null);
  }
  fill(shape, color, clip) {
    const D = this.D;
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
    const D = this.D;
    const X = Math.floor((p[0] + CELL.ax) * D), Y = Math.floor((p[1] + CELL.ay) * D);
    if (X >= 0 && Y >= 0 && X < this.w && Y < this.h) this.px[Y * this.w + X] = color;
  }
}

// ---------- pose -> skeleton ----------
export function skeleton(pose, build) {
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
// Texture is placed on the 4x source grid in deliberate clusters. This keeps the
// artwork pixel-native while avoiding a noisy one-pixel screen-door pattern.
const strands = (base, lit) => (p, X, Y) => {
  const x = Math.floor(X / D), y = Math.floor(Y / D);
  return ((x + Math.floor(y / 2)) % 5 === 0 ? lit : base);
};

// ---------- Tezzus ----------
const TZ = {
  skin: '#7a4a33', hair: '#15100e', hairLit: '#3b2d27', ink: INK,
  red: '#cf2229', redDark: '#7a0c12', redLit: '#f4675d', tank: '#f4f1ea',
  denim: '#a9c2dc', rip: '#f4f1ea', shoe: '#cf2229', sole: '#f4f1ea',
  lens: '#2b0d12', lensLit: '#cf2229', silver: '#d7dde6', gold: '#e2b33b',
};
const TZ_BUILD = { shoulder: 3.4, shoulderDrop: 1.0, hipW: 1.7 };
// red leather scales: rows of overlapping rounded scales, dark lower rims, a glint on each
const scales = (p, X, Y) => {
  // Each scale is a clear 3x3 logical-pixel cluster on the 4x source grid.
  const gx = Math.floor(X / D), gy = Math.floor(Y / D), row = Math.floor(gy / 3);
  const cx = ((gx + (row & 1)) % 3 + 3) % 3, cy = gy % 3;
  if (cy === 2 || (cy === 1 && (cx === 0 || cx === 2))) return TZ.redDark;
  if (cy === 0 && cx === 1) return TZ.redLit;
  return TZ.red;
};

export function tezzus(pose) {
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
  cv.draw(capsule(V.add(hp[0], V.mul(v, -0.4)), V.add(hp[1], V.mul(v, 0.4)), 1.0), INK);
  cv.draw(circle(hip, 0.75), TZ.gold, 0.45);
  // cropped scale jacket, open over a white tank
  const waist = V.add(hip, V.mul(u, -1.0));
  cv.draw(poly([V.add(sh[0], V.mul(v, -0.9)), V.add(sh[1], V.mul(v, 0.9)), V.add(waist, V.mul(v, 3.0)), V.add(waist, V.mul(v, -3.0))]), scales);
  const tank = poly([V.add(neck, V.mul(v, -1.3)), V.add(neck, V.mul(v, 1.3)), V.add(waist, V.mul(v, 1.1)), V.add(waist, V.mul(v, -1.1))]);
  cv.fill(tank.grow(0.35), INK); // lapel edges
  cv.fill(tank, TZ.tank);
  cv.fill(circle(V.add(neck, V.mul(u, 0.6)), 1.0), TZ.skin); // neckline
  for (let t = 0; t <= 1; t += 0.12) cv.dot(V.add(V.add(neck, V.mul(v, (t - 0.5) * 2.2)), V.mul(u, 1.4 + Math.sin(t * Math.PI) * 1.2)), TZ.silver); // stepped chain links
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
  red: '#c61f29', tee: '#fbfaf6', denim: '#3a5a86', denimDark: '#2a4266',
  vans: INK, sole: '#f4f4f2', stud: '#dfe6ef', studLit: '#ffffff', studShade: '#dfe6ef', eye: INK,
};
const DM_BUILD = { shoulder: 3.8, shoulderDrop: 1.1, hipW: 2.0 };
const sherpa = (p, X, Y) => {
  const x = Math.floor(X / D), y = Math.floor(Y / D);
  const cx = ((x % 7) + 7) % 7, cy = ((y % 5) + 5) % 5;
  return ((cx === 1 || cx === 2) && (cy === 1 || cy === 2) ? DM.fleeceShade : DM.fleece);
};

export function diamond(pose) {
  const sk = skeleton(pose, DM_BUILD), cv = new Canvas();
  const { head, neck, hip, u, v, sh, hp } = sk;
  const HR = 4.6;
  // legs: baggy dark jeans, black/white Vans
  sk.legs.forEach(([knee, foot], i) => {
    cv.draw(capsule(hp[i], knee, 2.15, 2.0), (p) => (Math.abs(segDist(p, hp[i], knee).d - 1.2) < 0.15 ? DM.denimDark : DM.denim));
    cv.draw(capsule(knee, foot, 2.0, 2.1), DM.denim);
    shoe(cv, foot, knee, sk, { color: DM.vans, sole: DM.sole, rx: 2.7, ry: 1.6, toe: 1.0, stripe: true });
  });
  // oversized cream sherpa fleece with red piping, matching the approved Diamond* reference
  const hem = V.add(hip, V.mul(u, 0.9));
  cv.draw(poly([V.add(sh[0], V.mul(v, -1.2)), V.add(sh[1], V.mul(v, 1.2)), V.add(hem, V.mul(v, 4.2)), V.add(hem, V.mul(v, -4.2))]), sherpa);
  cv.fill(poly([V.add(neck, V.mul(v, -1.4)), V.add(neck, V.mul(v, 1.4)), V.add(neck, V.mul(u, 3.0))]), DM.tee); // tee in the collar
  cv.fill(capsule(V.add(neck, V.mul(u, 3.0)), V.add(hem, V.mul(u, -0.2)), 0.28), DM.red); // zip piping
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
  // long locs hang beside the face and onto the shoulders, behind the head
  if (!sk.down) for (const s of [-1, 1]) for (let i = 0; i < 2; i++) {
    const a = V.add(head, [s * (HR * 0.68 + i * 0.55), -0.2 + i * 0.4]);
    const b = V.add(head, [s * (HR + 0.75 + i * 0.35), 3.6 + i * 0.5]);
    cv.draw(capsule(a, b, 0.75, 0.55), strands(DM.hair, DM.hairLit), 0.55);
  }
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
    const lens = (cx, cy) => poly([
      [cx - 1.2, cy - 0.7], [cx + 1.05, cy - 0.7],
      [cx + 1.2, cy + 0.35], [cx - 1.0, cy + 0.45],
    ]);
    const lensY = fc[1] - 0.5;
    if (!f) {
      for (const s of [-1, 1]) {
        const cx = fc[0] + s * 1.3;
        cv.draw(lens(cx, lensY), DM.eye, 0.25);
        cv.fill(capsule([cx - 0.65, lensY - 0.34], [cx + 0.02, lensY - 0.34], 0.09), DM.studLit);
      }
      cv.fill(capsule([fc[0] - 0.25, lensY - 0.12], [fc[0] + 0.25, lensY - 0.12], 0.18), DM.eye);
    } else {
      const cx = fc[0] + f * 0.75;
      cv.draw(lens(cx, lensY), DM.eye, 0.25);
      cv.fill(capsule([cx - f * 0.55, lensY - 0.34], [cx + f * 0.1, lensY - 0.34], 0.09), DM.studLit);
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


// ======================================================================================================
// GBA style: true 1x pixel art. One pixel per game pixel, a 15-colour palette per character (one OBJ
// palette), a 1-pixel black outline around the silhouette and between overlapping parts, flat colour
// blocks, and faces placed pixel by pixel. `head` sets the proportions (4.5 classic, 5.4 chibi).
// ======================================================================================================
export class Pix {
  constructor() {
    this.w = CELL.w;
    this.h = CELL.h;
    this.col = new Array(this.w * this.h).fill(null);
    this.part = new Int16Array(this.w * this.h).fill(-1);
    this.parts = []; // { name, inner } in draw order
  }
  idx(x, y) { return (y + CELL.ay) * this.w + x + CELL.ax; }
  // Fill a shape as part `name` (later parts are in front). `inner`: outline where it covers an earlier part.
  paint(shape, color, name, inner = true) {
    let id = this.parts.findIndex((p) => p.name === name);
    if (id < 0) { id = this.parts.length; this.parts.push({ name, inner }); }
    const [x0, y0, x1, y1] = shape.box;
    for (let y = Math.floor(y0) - 1; y <= Math.ceil(y1); y++)
      for (let x = Math.floor(x0) - 1; x <= Math.ceil(x1); x++) {
        if (x < -CELL.ax || y < -CELL.ay || x >= this.w - CELL.ax || y >= this.h - CELL.ay) continue;
        const p = [x + 0.5, y + 0.5];
        if (!shape.test(p)) continue;
        const c = typeof color === 'function' ? color(p, x, y) : color;
        if (!c) continue;
        this.col[this.idx(x, y)] = c;
        this.part[this.idx(x, y)] = id;
      }
  }
  get(x, y) { return x < -CELL.ax || y < -CELL.ay || x >= this.w - CELL.ax || y >= this.h - CELL.ay ? null : this.col[this.idx(x, y)]; }
  set(x, y, c) { if (!(x < -CELL.ax || y < -CELL.ay || x >= this.w - CELL.ax || y >= this.h - CELL.ay)) this.col[this.idx(x, y)] = c; }
  partAt(x, y) { return x < -CELL.ax || y < -CELL.ay || x >= this.w - CELL.ax || y >= this.h - CELL.ay ? -1 : this.part[this.idx(x, y)]; }
  // Outlines: inner lines first (front part's edge pixel over an earlier part), then the silhouette ring.
  outline() {
    const ink = [];
    for (let y = -CELL.ay; y < this.h - CELL.ay; y++)
      for (let x = -CELL.ax; x < this.w - CELL.ax; x++) {
        const P = this.partAt(x, y);
        if (P < 0 || !this.parts[P].inner) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const Q = this.partAt(x + dx, y + dy);
          if (Q >= 0 && Q < P) { ink.push([x, y]); break; }
        }
      }
    for (const [x, y] of ink) this.set(x, y, INK);
    const ring = [];
    for (let y = -CELL.ay; y < this.h - CELL.ay; y++)
      for (let x = -CELL.ax; x < this.w - CELL.ax; x++)
        if (!this.get(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => this.get(x + dx, y + dy))) ring.push([x, y]);
    for (const [x, y] of ring) this.set(x, y, INK);
  }
  colours() { return new Set(this.col.filter(Boolean)); }
}
const R = (v) => Math.round(v);
// Stamp a face template centred on (cx, ey) = (head centre column, eye row), only over the head's own pixels.
// Turned heads shift the template toward the facing side; columns past the head edge are dropped.
function stampFace(px, cx, ey, rows, key, skin) {
  const w = rows[0].length, ox = cx - (w >> 1);
  rows.forEach((r, j) => [...r].forEach((ch, i) => {
    const c = key[ch];
    if (!c) return;
    const x = ox + i, y = ey + j - rows.findIndex((row) => row.includes('|'));
    const cur = px.get(x, y);
    // Face marks are an intentional overlay: forehead jewelry and glasses must remain visible over the hairline.
    if (cur && cur !== INK && (cur === skin || ch !== '.')) px.set(x, y, c);
  }));
}

const TZ8 = {
  skin: '#8a5638', hair: '#1a1412', hairLit: '#45352d', red: '#d62a2f', redDark: '#86121a', redLit: '#f7736a',
  tank: '#f4f1ea', denim: '#a9c2dc', denimDark: '#6f8db0', lens: '#2b0d12', lensLit: '#b08890', gold: '#e8b93c', ink2: '#2a1810',
};
export function gbaTezzus(pose, opts = {}) {
  const head = opts.head ?? 5.4;
  const sk = skeleton(pose, { shoulder: 3.0, shoulderDrop: 1.0, hipW: 1.5 });
  const px = new Pix();
  const { neck, hip, u, v, sh, hp } = sk;
  const hc = V.add(sk.head, [0, head > 5 ? -0.8 : 0]);
  // dreads behind the head
  if (!sk.down) for (const s of [-1, 1]) px.paint(capsule(V.add(hc, [s * (head - 0.6), -0.5]), V.add(hc, [s * (head + 0.2), head * 0.75]), 1.3, 1.0), TZ8.hair, 'backhair', false);
  // legs + shoes
  sk.legs.forEach(([knee, foot], i) => {
    const jeans = (p, x, y) => ((x + y) % 5 === 0 && Math.abs(p[1] - knee[1]) < 1 ? TZ8.tank : TZ8.denim); // rips
    px.paint(capsule(hp[i], knee, 1.35, 1.2), jeans, `leg${i}`);
    px.paint(capsule(knee, foot, 1.2, 1.05), jeans, `leg${i}`);
  });
  sk.legs.forEach(([knee, foot], i) => {
    const out = sk.facing || Math.sign(foot[0] - hip[0]) || 1;
    const lifted = !sk.upright || foot[1] < -4;
    const dir = lifted ? V.norm(V.sub(foot, knee)) : [out, 0];
    px.paint(ellipse(V.add(foot, V.mul(dir, 0.8)), 2.0, 1.25, Math.atan2(dir[1], dir[0])), (p) => (!lifted && p[1] > foot[1] + 0.7 ? TZ8.tank : TZ8.red), `shoe${i}`);
  });
  // jacket body (cropped), tank, belt
  const waist = V.add(hip, V.mul(u, -0.6));
  const scale = (p, x, y) => ((y & 1) === 0 && ((x + (y >> 1)) & 1) === 0 ? TZ8.redDark : TZ8.red);
  px.paint(capsule(V.add(hp[0], V.mul(v, -0.3)), V.add(hp[1], V.mul(v, 0.3)), 0.9), TZ8.ink2, 'belt', false);
  px.paint(poly([V.add(sh[0], V.mul(v, -0.6)), V.add(sh[1], V.mul(v, 0.6)), V.add(waist, V.mul(v, 2.4)), V.add(waist, V.mul(v, -2.4))]), scale, 'jacket');
  px.paint(poly([V.add(neck, V.mul(v, -0.9)), V.add(neck, V.mul(v, 0.9)), V.add(waist, V.mul(v, 0.7)), V.add(waist, V.mul(v, -0.7))]), TZ8.tank, 'tank');
  // arms + hands (tattoo: one ink pixel)
  sk.arms.forEach(([elbow, hand], i) => {
    px.paint(capsule(sh[i], elbow, 1.4, 1.25), scale, `arm${i}`);
    px.paint(capsule(elbow, hand, 1.25, 1.1), scale, `arm${i}`);
    px.paint(circle(V.add(hand, V.mul(V.norm(V.sub(hand, elbow)), 0.5)), 1.35), TZ8.skin, `hand${i}`);
  });
  // spiky shoulder scales
  for (const i of [0, 1]) {
    const s = i ? 1 : -1;
    px.paint(poly([V.add(sh[i], V.mul(u, -1.0)), V.add(V.add(sh[i], V.mul(v, s * 2.4)), V.mul(u, -1.1)), V.add(sh[i], V.mul(u, 0.9))]), TZ8.red, `flap${i}`);
  }
  // head
  px.paint(capsule(neck, V.lerp(neck, hc, 0.4), 0.9), TZ8.skin, 'neck', false);
  px.paint(circle(hc, head - 0.5), TZ8.skin, 'head');
  // dread mop: bumpy crown covering the top of the head
  const top = sk.down ? hc : V.add(hc, [0, -0.2]);
  px.paint({
    box: [top[0] - head - 1.5, top[1] - head - 2, top[0] + head + 1.5, top[1] + 1],
    test: (p) => {
      const d = V.sub(p, top), a = Math.atan2(d[1], d[0]);
      const r = head + 0.4 + 0.7 * Math.abs(Math.sin(a * 4.5)); // bumpy locs
      return V.len(d) <= r && (sk.down || p[1] < top[1] - 1.2 || (Math.abs(d[0]) > head - 0.5 && p[1] < top[1] + 1.5));
    },
  }, (p, x, y) => ((x + 2 * y) % 5 === 0 ? TZ8.hairLit : TZ8.hair), 'hair');
  px.outline();
  if (!sk.down) {
    // face: shield shades (2 rows) with a glint, small mouth
    const f = sk.facing;
    stampFace(px, R(hc[0]) + f, R(hc[1]), [
      'kKKKKKKKk',
      'kLlLL|LLk',
      '.........',
      '...MMM...',
    ], { k: INK, K: INK, L: TZ8.lens, l: TZ8.lensLit, M: INK, '|': TZ8.lens }, TZ8.skin);
  }
  return px;
}

const DM8 = {
  skin: '#6e4130', hair: '#140f0d', hairLit: '#46362d', fleece: '#f1e9d6', fleeceShade: '#cfc2a6', red: '#c61f29',
  white: '#fbfaf6', denim: '#3a5a86', denimDark: '#253d5f', vans: '#1d1d1d', stud: '#e6edf5',
  gucciGreen: '#214b3d', gucciGold: '#d7b34b',
};
function gucciBackLayout(sk) {
  const hem = V.add(sk.hip, V.mul(sk.u, 0.7));
  const start = V.add(sk.neck, V.mul(sk.u, 0.8));
  const end = V.add(hem, V.mul(sk.u, -0.5));
  return { start, end, center: V.lerp(start, end, 0.56), angle: Math.atan2(sk.v[1], sk.v[0]), v: sk.v };
}
const outlineRing = (outer, inner) => ({ box: outer.box, test: (p) => outer.test(p) && !inner.test(p) });
function stripeBand(start, end, v, offset, halfWidth = 0.52) {
  return poly([
    V.add(start, V.mul(v, offset - halfWidth)), V.add(start, V.mul(v, offset + halfWidth)),
    V.add(end, V.mul(v, offset + halfWidth)), V.add(end, V.mul(v, offset - halfWidth)),
  ]);
}
export function gbaDiamond(pose, opts = {}) {
  const head = opts.head ?? 5.4;
  const sk = skeleton(pose, { shoulder: 3.4, shoulderDrop: 1.1, hipW: 1.8 });
  const px = new Pix();
  const { neck, hip, u, v, sh, hp } = sk;
  const hc = V.add(sk.head, [0, head > 5 ? -0.8 : 0]);
  // legs: baggy jeans, Vans (black, white sole)
  sk.legs.forEach(([knee, foot], i) => {
    px.paint(capsule(hp[i], knee, 1.7, 1.55), DM8.denim, `leg${i}`);
    px.paint(capsule(knee, foot, 1.55, 1.65), (p) => (p[1] > foot[1] - 1.2 && sk.upright ? DM8.denimDark : DM8.denim), `leg${i}`);
  });
  sk.legs.forEach(([knee, foot], i) => {
    const out = sk.facing || Math.sign(foot[0] - hip[0]) || 1;
    const lifted = !sk.upright || foot[1] < -4;
    const dir = lifted ? V.norm(V.sub(foot, knee)) : [out, 0];
    px.paint(ellipse(V.add(foot, V.mul(dir, 0.9)), 2.2, 1.25, Math.atan2(dir[1], dir[0])), (p) => (!lifted && p[1] > foot[1] + 0.7 ? DM8.white : DM8.vans), `shoe${i}`);
  });
  // boxy sherpa fleece, red zip and clean white tee; keep the chest free of logos/stripes
  const hem = V.add(hip, V.mul(u, 0.7));
  const sherpa = (p, x, y) => ((x * 3 + y * 5) % 7 === 0 ? DM8.fleeceShade : DM8.fleece);
  px.paint(poly([V.add(sh[0], V.mul(v, -0.9)), V.add(sh[1], V.mul(v, 0.9)), V.add(hem, V.mul(v, 3.5)), V.add(hem, V.mul(v, -3.5))]), sherpa, 'fleece');
  if (sk.down) {
    const mark = gucciBackLayout(sk);
    for (const [offset, color] of [[-1.05, DM8.gucciGreen], [0, DM8.red], [1.05, DM8.gucciGreen]])
      px.paint(stripeBand(mark.start, mark.end, v, offset, 0.48), color, 'fleece', false);
    const outer = ellipse(mark.center, 2.8, 2.05, mark.angle);
    const inner = ellipse(mark.center, 2.1, 1.4, mark.angle);
    px.paint(outlineRing(outer, inner), DM8.gucciGold, 'fleece', false);
    // Compact runtime-size hint of the intertwined mark; the 4x sheet carries the crisp double-G embroidery.
    for (const s of [-1, 1]) {
      const c = V.add(mark.center, V.mul(v, s * 0.45));
      px.paint(outlineRing(ellipse(c, 0.62, 0.62), ellipse(c, 0.28, 0.28)), DM8.gucciGold, 'fleece', false);
    }
  } else {
    px.paint(poly([V.add(neck, V.mul(v, -1.0)), V.add(neck, V.mul(v, 1.0)), V.add(neck, V.mul(u, 2.2))]), DM8.white, 'tee', false);
  }
  // sleeves + red cuffs + hands
  sk.arms.forEach(([elbow, hand], i) => {
    const hd = V.norm(V.sub(hand, elbow)), wrist = V.add(hand, V.mul(hd, -1.0));
    px.paint(capsule(sh[i], elbow, 1.8, 1.7), sherpa, `arm${i}`);
    px.paint(capsule(elbow, wrist, 1.7, 1.6), (p) => (V.dist(p, wrist) < 1.0 ? DM8.red : DM8.fleece), `arm${i}`);
    px.paint(circle(V.add(hand, V.mul(hd, 0.3)), 1.35), DM8.skin, `hand${i}`);
  });
  // head, hair cap, tied-up dreads with a red tie
  px.paint(circle(hc, head - 0.5), DM8.skin, 'head');
  const crown = V.add(hc, [0, -head + 0.6]);
  const hairTex = (p, x, y) => ((x + 64) % 3 === 0 ? DM8.hairLit : DM8.hair);
  if (sk.down) px.paint(circle(hc, head - 0.5), hairTex, 'hair');
  else {
    px.paint({ box: [hc[0] - head, hc[1] - head, hc[0] + head, hc[1]], test: (p) => V.dist(p, hc) <= head - 0.5 && p[1] < hc[1] - 3.4 }, hairTex, 'hair');
    for (let k = -2; k <= 2; k++) {
      const a = -Math.PI / 2 + k * 0.45, L = 3.6 - Math.abs(k) * 0.3;
      px.paint(capsule(V.add(crown, [0, -0.5]), V.add(crown, [Math.cos(a) * L, Math.sin(a) * L + Math.abs(k) * 0.4]), 0.75, 0.6), hairTex, 'locs');
    }
    for (const s of [-1, 1])
      px.paint(capsule(V.add(hc, [s * (head - 1.0), -0.1]), V.add(hc, [s * (head + 1.0), 3.6]), 0.8, 0.6), hairTex, 'sideLocs', false);
  }
  px.outline();
  if (!sk.down) {
    const f = sk.facing;
    // red hair tie on the bundle
    px.set(R(crown[0]) - 1, R(crown[1]) - 1, DM8.red); px.set(R(crown[0]), R(crown[1]) - 1, DM8.red);
    // eyes (white + pupil), and all nine piercings: 3 down the forehead, cheekbones, dimples, mouth corners
    stampFace(px, R(hc[0]) + f, R(hc[1]), [
      '....o....',
      '....O....',
      '....o....',
      '.WSS|SSW.',
      '.SSS|SSS.',
      'o.......o',
      '.o.....o.',
      '..oMMMo..',
    ], { o: DM8.stud, O: '#ffffff', W: '#ffffff', S: INK, '|': INK, M: INK }, DM8.skin);
  }
  return px;
}

// 4x embroidered back detail: the same Mini B silhouette, with enough source pixels for the GG mark to read.
export function diamondBackDetail4x(pose) {
  const cv = new Canvas(D), sk = skeleton(pose, { shoulder: 3.4, shoulderDrop: 1.1, hipW: 1.8 });
  if (!sk.down) return cv;
  const mark = gucciBackLayout(sk);
  for (const [offset, color] of [[-1.05, DM8.gucciGreen], [0, DM8.red], [1.05, DM8.gucciGreen]]) {
    const band = stripeBand(mark.start, mark.end, sk.v, offset, 0.48);
    cv.fill(band, color);
  }
  const outer = ellipse(mark.center, 2.8, 2.05, mark.angle);
  const inner = ellipse(mark.center, 2.45, 1.7, mark.angle);
  cv.fill(outlineRing(outer, inner), DM8.gucciGold);

  const glyph = ['01110', '10001', '10000', '10111', '10001', '10001', '01110'];
  const pitch = 0.42, cellW = 0.2, cellH = 0.24;
  for (let letter = 0; letter < 2; letter++) for (let y = 0; y < glyph.length; y++) for (let x = 0; x < 5; x++) {
    if (glyph[y][x] !== '1') continue;
    const col = letter * 6 + x, across = (col - 5) * pitch, along = (y - 3) * pitch;
    const c = V.add(mark.center, V.add(V.mul(sk.v, across), V.mul(sk.u, along)));
    cv.fill(poly([
      V.add(c, V.add(V.mul(sk.v, -cellW), V.mul(sk.u, -cellH))),
      V.add(c, V.add(V.mul(sk.v, cellW), V.mul(sk.u, -cellH))),
      V.add(c, V.add(V.mul(sk.v, cellW), V.mul(sk.u, cellH))),
      V.add(c, V.add(V.mul(sk.v, -cellW), V.mul(sk.u, cellH))),
    ]), DM8.gucciGold);
  }
  return cv;
}
