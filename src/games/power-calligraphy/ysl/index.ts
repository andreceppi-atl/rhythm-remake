// "Young Stoner Life": custom Power Calligraphy characters generated from KanjiVG stroke data.
//
// For each kanji this builds, entirely at load time:
//   - the character sprite: frame 0 = grey preview of every stroke, then ink progress frames for each
//     stroke the game writes itself (like the original kana animations);
//   - one sprite per player stroke with 3 frames: clean / early (scribble) / late (blot);
//   - the choreography as beatscript ops (brush path along each stroke, touch/swish sounds, the
//     "funuue" charge, cue spawn one beat before the hit), using the original characters' rhythm;
//   - a level that follows the original main script slot for slot, with these characters swapped in.
// Stroke data: KanjiVG (https://kanjivg.tagaini.net), © Ulrich Apel, CC BY-SA 3.0.
import type { Op } from '../../../engine/sequencer';
import type { GameData } from '../../../gba/assets';
import type { Cel } from '../../../gba/ppu';
import type { RasterCel } from '../../../gba/raster-cel';
import type { AnimFrame } from '../../../gba/sprites';
import type { PcTuning, Stroke } from '../tuning';
import kanjiData from './kanji-data.json';

export const YSL_SCENE = 'scene_pc_ysl';
const ENGINE = 'power_calligraphy_engine';

interface Plan {
  id: string;
  char: string;
  players: { stroke: number; hit: number }[]; // 1-based stroke number, hit beat within the sub
  beats: number;
  criteria: number; // marking criteria (0 basic, 1 power, 2 two-stroke, 3 finale)
}

const PLANS: Plan[] = [
  { id: 'sei', char: '生', players: [{ stroke: 5, hit: 6 }], beats: 7, criteria: 0 },
  { id: 'shou', char: '少', players: [{ stroke: 4, hit: 6 }], beats: 7, criteria: 0 },
  { id: 'kusa', char: '草', players: [{ stroke: 8, hit: 6 }], beats: 7, criteria: 1 },
  { id: 'seki', char: '石', players: [{ stroke: 2, hit: 3 }, { stroke: 5, hit: 6 }], beats: 7, criteria: 2 },
  { id: 'waka', char: '若', players: [{ stroke: 5, hit: 9 }, { stroke: 8, hit: 14 }], beats: 15, criteria: 3 },
];

// Which custom character replaces each original subroutine in the main script.
const SLOT: Record<string, string> = { re: 'sei', sun: 'sei', comma: 'shou', chikara: 'kusa', onore: 'seki', kokoro: 'seki', face: 'waka' };

const PREVIEW = [0xe7, 0xe7, 0xe7];
const INK = [0, 0, 0];
const BRUSH_TIP_DOWN = 15; // brush contact point below the sprite anchor (measured from the original cels)
const BRUSH_TIP_UP = 30;

type Pt = [number, number];
type KStroke = { type: string; points: Pt[] };

function length(pts: Pt[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

function pointAt(pts: Pt[], f: number): Pt {
  const target = length(pts) * Math.max(0, Math.min(1, f));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (acc + seg >= target) {
      const k = seg ? (target - acc) / seg : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
    }
    acc += seg;
  }
  return pts[pts.length - 1];
}

// Brush width along the stroke: a pressed landing, then a shape set by the stroke type.
// Dense characters get a slightly thinner brush so they stay readable at GBA size.
let brushR = 3.2;
function radius(type: string, t: number) {
  const R = brushR;
  const land = t < 0.08 ? 1.25 - t * 2 : 1.05;
  if (type.startsWith('㇒') || type.startsWith('㇏')) return R * land * Math.max(0.25, 1.05 - Math.max(0, t - 0.35) * 1.3); // sweep: taper
  if (type.startsWith('㇔')) return R * (0.75 + 0.55 * t); // dot: teardrop
  if (type.startsWith('㇚') || type.startsWith('㇕') || type.startsWith('㇆')) return R * land * (t > 0.88 ? 1 - (t - 0.88) * 5 : 1); // hook: flick at the end
  return R * land * (t > 0.9 ? 1.12 : 1); // horizontal / vertical: pressed stop
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A hard-edged (GBA-style) raster canvas covering a fixed box around the paper centre.
class Canvas {
  readonly w: number;
  readonly h: number;
  private readonly ctx: OffscreenCanvasRenderingContext2D;
  constructor(readonly x0: number, readonly y0: number, w: number, h: number) {
    this.w = w;
    this.h = h;
    this.ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  }
  dab(x: number, y: number, r: number, rgb: number[]) {
    this.ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    this.ctx.beginPath();
    this.ctx.arc(x - this.x0, y - this.y0, Math.max(0.6, r), 0, Math.PI * 2);
    this.ctx.fill();
  }
  stroke(s: KStroke, rgb: number[], from = 0, to = 1) {
    const L = length(s.points);
    for (let d = L * from; d <= L * to; d += 0.5) {
      const [x, y] = pointAt(s.points, d / L);
      this.dab(x, y, radius(s.type, d / L), rgb);
    }
  }
  // Threshold to two colours so edges stay crisp like the original sprites.
  raster(): RasterCel {
    const img = this.ctx.getImageData(0, 0, this.w, this.h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) {
        d[i + 3] = 0;
        continue;
      }
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const c = lum < 120 ? INK : PREVIEW;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
    return { w: this.w, h: this.h, x0: this.x0, y0: this.y0, rgba: d, priority: 0 };
  }
}

const ev = (id: number, param: number): Op[] => [
  ['run', 'gameplay_set_engine_event_param', param],
  ['run2', 'gameplay_run_engine_event', id, ENGINE],
];
const s8 = (v: number) => Math.max(-128, Math.min(127, Math.round(v))) & 0xff;
const brushOp = (x: number, y: number, down: boolean) => ev(6, s8(x) | (s8(y - (down ? BRUSH_TIP_DOWN : BRUSH_TIP_UP)) << 8) | ((down ? 1 : 0) << 16));
const paperOp = (x: number, y: number) => ev(2, s8(x) | (s8(y) << 8));

export interface YslContent {
  scenes: Record<string, string>;
  chars: string[];
}

// Adds the custom characters to the Power Calligraphy data + tuning. Call once, before rt.load(data).
// Start the dancers (people state 1 = dance) and shift both columns 160 px so they are on screen right away.
export const DANCERS_ON: Op[] = [
  ['run', 'gameplay_set_engine_event_param', 1],
  ['run2', 'gameplay_run_engine_event', 11, 'power_calligraphy_engine'],
  ['run', 'gameplay_set_engine_event_param', 160],
  ['run2', 'gameplay_run_engine_event', 12, 'power_calligraphy_engine'],
];

export function addYoungStonerLife(data: GameData, t: PcTuning): YslContent {
  const raster = (data.raster ??= new Map<Cel, RasterCel>());
  const kanaBase = t.kanaAnims.length;
  const scripts: Record<string, Op[]> = {};
  const bbox = { x0: -58, y0: -64, w: 124, h: 116 }; // covers every character + brush blots

  PLANS.forEach((plan, pi) => {
    const strokes = (kanjiData.kanji as unknown as Record<string, { strokes: KStroke[] }>)[plan.char].strokes;
    brushR = strokes.length >= 8 ? 2.6 : strokes.length >= 6 ? 2.9 : 3.2;
    const playerIdx = plan.players.map((p) => p.stroke - 1);
    const scripted = strokes.map((_, i) => i).filter((i) => !playerIdx.includes(i));
    const steps = (s: KStroke) => Math.max(2, Math.min(5, Math.round(length(s.points) / 12)));

    // Character sprite frames: preview, then ink progress of scripted strokes in order.
    const frames: AnimFrame[] = [];
    const celOf = new Map<string, number>();
    const makeFrame = (inked: number[], partial?: { i: number; f: number }) => {
      const c = new Canvas(bbox.x0, bbox.y0, bbox.w, bbox.h);
      for (const s of strokes) c.stroke(s, PREVIEW);
      for (const i of inked) c.stroke(strokes[i], INK);
      if (partial) c.stroke(strokes[partial.i], INK, 0, partial.f);
      const cel: Cel = [];
      raster.set(cel, c.raster());
      frames.push({ cel, frames: 1 });
      return frames.length - 1;
    };
    makeFrame([]);
    const done: number[] = [];
    for (const i of scripted) {
      const n = steps(strokes[i]);
      for (let j = 1; j <= n; j++) celOf.set(`${i}:${j}`, j === n ? makeFrame([...done, i]) : makeFrame(done, { i, f: j / n }));
      done.push(i);
    }
    data.anims[`anim_power_calligraphy_ysl_${plan.id}`] = frames;
    t.kanaAnims.push(`ysl_${plan.id}`);
    const kanaIndex = kanaBase + pi;

    // Player strokes: clean / early scribble / late blot.
    const strokeIndex = new Map<number, number>();
    for (const i of playerIdx) {
      const s = strokes[i];
      const rand = rng(plan.char.codePointAt(0)! * 31 + i);
      const clean = new Canvas(bbox.x0, bbox.y0, bbox.w, bbox.h);
      clean.stroke(s, INK);
      const early = new Canvas(bbox.x0, bbox.y0, bbox.w, bbox.h);
      early.stroke(s, INK, 0, 0.4);
      const [ex, ey] = pointAt(s.points, 0.4);
      for (let k = 0; k < 14; k++) early.dab(ex + k * 0.9 * (rand() - 0.2), ey + Math.sin(k * 1.3) * 3, 1.6, INK);
      const late = new Canvas(bbox.x0, bbox.y0, bbox.w, bbox.h);
      const [sx, sy] = s.points[0];
      for (let k = 0; k < 7; k++) late.dab(sx + (rand() - 0.5) * 6, sy + (rand() - 0.5) * 6, 2.5 + rand() * 2.5, INK);
      late.stroke(s, INK, 0, 0.15);
      for (let k = 0; k < 4; k++) late.dab(sx + (rand() - 0.5) * 22, sy + (rand() - 0.5) * 22, 0.9 + rand(), INK);
      const anim = `ysl_${plan.id}_input${i + 1}`;
      data.anims[`anim_power_calligraphy_${anim}`] = [clean, early, late].map((c) => {
        const cel: Cel = [];
        raster.set(cel, c.raster());
        return { cel, frames: 1 };
      });
      const end = s.points[s.points.length - 1];
      const prev = pointAt(s.points, 0.85);
      const dl = Math.hypot(end[0] - prev[0], end[1] - prev[1]) || 1;
      const dir: Pt = [(end[0] - prev[0]) / dl, (end[1] - prev[1]) / dl];
      const long = length(s.points) > 35;
      const at = (p: Pt, cel: number): [number, number, number] => [Math.round(p[0]), Math.round(p[1] - (cel ? BRUSH_TIP_DOWN : BRUSH_TIP_UP)), cel];
      const stroke: Stroke = {
        anim,
        paperJolt: [Math.round(dir[0] * 6), Math.round(dir[1] * 6)],
        brush: {
          hit: at([end[0] + dir[0] * 12, end[1] + dir[1] * 12], 0),
          early: at([ex + 10, ey], 0),
          late: at([sx, sy - 6], 0),
        },
        hitSfx: long ? 's_sword_orya_seqData' : 's_sword_hi_seqData',
        barelySfx: long ? 's_f_shuji_v_nuaa_seqData' : 's_f_shuji_v_ouch_seqData',
      };
      t.strokes.push(stroke);
      strokeIndex.set(i, t.strokes.length - 1);
    }

    // Choreography.
    const events: { t: number; ops: Op[] }[] = [];
    const at = (tick: number, ...ops: Op[][]) => events.push({ t: Math.round(tick), ops: ops.flat() });
    at(0, ev(0, kanaIndex));
    const drawWindow = (list: number[], start: number, end: number, nextStart: Pt | null) => {
      if (!list.length) return;
      const D = Math.min(30, (end - start) / list.length);
      list.forEach((i, k) => {
        const s = strokes[i];
        const t0 = start + k * D;
        const n = steps(s);
        const draw = Math.max(2, Math.round(D * 0.6));
        at(t0, ev(1, celOf.get(`${i}:1`)!), brushOp(...s.points[0], true), paperOp(1, 1), [['play_sfx', 's_f_shuji_start_seqData']]);
        for (let j = 2; j <= n; j++) {
          const p = pointAt(s.points, j / n);
          at(t0 + ((j - 1) * draw) / (n - 1), ev(1, celOf.get(`${i}:${j}`)!), brushOp(p[0], p[1], true), j === 2 && draw < 10 ? [['play_sfx', 's_f_shuji_swing1_seqData']] : []);
        }
        const tail = s.points[s.points.length - 1];
        at(t0 + draw, paperOp(-1, -1), brushOp(tail[0], tail[1], false));
        const nxt = k + 1 < list.length ? strokes[list[k + 1]].points[0] : nextStart;
        if (nxt) {
          const far = Math.hypot(nxt[0] - tail[0], nxt[1] - tail[1]) > 20;
          at(t0 + draw + Math.max(1, Math.round(D * 0.2)), brushOp(nxt[0], nxt[1], false), far ? [['play_sfx', 's_furi_seqData']] : []);
        }
      });
    };

    let windowStart = 0;
    let cursor = 0; // next stroke index in drawing order
    plan.players.forEach((pl, k) => {
      const pIdx = pl.stroke - 1;
      const before: number[] = [];
      for (; cursor < pIdx; cursor++) if (!playerIdx.includes(cursor)) before.push(cursor);
      cursor = pIdx + 1;
      const H = pl.hit * 24;
      const comma = k > 0 && pl.hit - plan.players[k - 1].hit <= 3;
      const chargeTick = (comma ? pl.hit - 1 : pl.hit - 2) * 24;
      const ps = strokes[pIdx].points[0];
      drawWindow(before, windowStart, chargeTick - 6, ps);
      if (comma) {
        at(chargeTick, brushOp(ps[0], ps[1], false), ev(7, 1), [['play_sfx_vol_pitch', 's_rabbit_break2_seqData', 160, -512]], ev(8, 1), ev(4, strokeIndex.get(pIdx)!), [['run', 'gameplay_spawn_cue', 0]]);
      } else {
        at(chargeTick, brushOp(ps[0], ps[1], true), [['play_sfx_vol', 's_f_shuji_v_funuue_seqData', 256]], ev(7, 0));
        at(H - 24, ev(8, 1), ev(4, strokeIndex.get(pIdx)!), [['run', 'gameplay_spawn_cue', 0]]);
      }
      at(H, ev(8, 0));
      windowStart = H + 12;
    });
    const after: number[] = [];
    for (; cursor < strokes.length; cursor++) if (!playerIdx.includes(cursor)) after.push(cursor);
    drawWindow(after, windowStart, plan.beats * 24 - 12, null);

    events.sort((a, b) => a.t - b.t);
    const ops: Op[] = [];
    let now = 0;
    for (const e of events) {
      if (e.t > now) ops.push(['rest', e.t - now]);
      now = Math.max(now, e.t);
      ops.push(...e.ops);
    }
    if (plan.beats * 24 > now) ops.push(['rest', plan.beats * 24 - now]);
    ops.push(['return']);
    scripts[`script_pc_ysl_sub_${plan.id}`] = ops;

    const first = strokes[scripted[0] ?? playerIdx[0]].points[0];
    scripts[`script_pc_ysl_sub_${plan.id}_init`] = [...ev(0, kanaIndex), ...ev(1, 0), ...brushOp(first[0], first[1], false), ...paperOp(0, 0), ['rest', 24], ['return']];
  });

  // The level: the original main script, slot for slot, with the custom characters swapped in.
  const criteriaOf = Object.fromEntries(PLANS.map((p) => [p.id, p.criteria]));
  const main: Op[] = [];
  let pendingCriteria = -1, dancing = false;
  for (const op of data.level.scripts.script_power_calligraphy_main) {
    // Tezzus + Diamond* dance from the first character, already on screen (the original waits for the second half).
    if (!dancing && op[0] === 'call' && String(op[1]).endsWith('_init')) {
      main.push(...DANCERS_ON);
      dancing = true;
    }
    if (op[0] === 'call') {
      const m = String(op[1]).match(/^script_power_calligraphy_sub_(\w+?)(_init)?$/);
      if (m && SLOT[m[1]]) {
        const id = SLOT[m[1]];
        if (!m[2] && pendingCriteria >= 0) main[pendingCriteria] = ['run', 'gameplay_set_marking_criteria', criteriaOf[id]];
        main.push(['call', `script_pc_ysl_sub_${id}${m[2] ?? ''}`]);
        continue;
      }
    }
    if (op[0] === 'run' && op[1] === 'gameplay_set_marking_criteria') pendingCriteria = main.length;
    main.push(op);
  }
  scripts.script_pc_ysl_main = main;
  scripts.script_pc_ysl_entry = [
    ['run', 'set_beatscript_tempo', 124],
    ['rest', 24],
    ['call', 'script_power_calligraphy_prologue'],
    ['run', 'gameplay_set_screen_fade_in_time', 16],
    ['run2', 'gameplay_set_current_engine', 0, ENGINE],
    ['run', 'gameplay_inputs_enabled', 1],
    ['run', 'results_enable_input_tracking', 1],
    ['run', 'set_beatscript_tempo', 120],
    ['rest', 24],
    ['call', 'script_pc_ysl_main'],
    ['run', 'pause_menu_enabled', 0],
    ['run', 'gameplay_inputs_enabled', 0],
    ['fade_music_out', 48],
    ['fade_screen_out', 12, 0],
    ['rest', 24],
    ['rest', 24],
    ['stop'],
  ];
  Object.assign(data.level.scripts, scripts);
  data.level.scenes[YSL_SCENE] = 'script_pc_ysl_entry';
  return { scenes: { [YSL_SCENE]: 'script_pc_ysl_entry' }, chars: PLANS.map((p) => p.char) };
}
