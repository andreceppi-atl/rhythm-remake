// Every knob of Power Calligraphy in one place. Defaults = the GBA original
// (games/power_calligraphy/engine.c + src/engines/power_calligraphy.c). Override any part in
// public/mods/power_calligraphy.json or a skin's `tuning` block (deep-merged, see loadPcTuning).
// Units as in Karate Man: px, frames (60 Hz), ticks (24 per beat).
import { mergeTuning } from '../karate-man/tuning';

// One player stroke: sprite drawn on the paper (cel 0 clean / 1 early / 2 late), how the paper jolts
// on a clean hit, where the brush ends up for hit / early / late, and the sounds.
export interface Stroke {
  anim: string;
  paperJolt: [number, number];
  brush: { hit: [number, number, number]; early: [number, number, number]; late: [number, number, number] }; // x, y, cel (0 up / 1 down)
  hitSfx: string;
  barelySfx: string;
}

// Index = input stroke id from the level script (KANA_INPUT_*).
const STROKES: Stroke[] = [
  /* ONORE 1   */ { anim: 'onore_input1', paperJolt: [0, -8], brush: { hit: [31, -30, 0], early: [65, -14, 0], late: [36, -7, 0] }, hitSfx: 's_sword_orya_seqData', barelySfx: 's_f_shuji_v_nuaa_seqData' },
  /* CHIKARA 1 */ { anim: 'chikara_input1', paperJolt: [-6, -6], brush: { hit: [1, -22, 0], early: [-11, 28, 0], late: [19, -4, 0] }, hitSfx: 's_sword_orya_seqData', barelySfx: 's_f_shuji_v_nuaa_seqData' },
  /* CHIKARA 2 */ { anim: 'chikara_input2', paperJolt: [-4, 8], brush: { hit: [-61, 43, 0], early: [-46, 40, 0], late: [3, -54, 0] }, hitSfx: 's_sword_orya_seqData', barelySfx: 's_f_shuji_v_unuu_seqData' },
  /* SUN 1     */ { anim: 'sun_input1', paperJolt: [-4, -6], brush: { hit: [-14, -15, 0], early: [-19, -8, 0], late: [9, 6, 0] }, hitSfx: 's_sword_orya_seqData', barelySfx: 's_f_shuji_v_nuaa_seqData' },
  /* SUN 2     */ { anim: 'sun_input2', paperJolt: [4, 4], brush: { hit: [1, -7, 1], early: [2, -8, 1], late: [6, -18, 1] }, hitSfx: 's_sword_hi_seqData', barelySfx: 's_f_shuji_v_ouch_seqData' },
  /* KOKORO 1  */ { anim: 'kokoro_input1', paperJolt: [-4, -6], brush: { hit: [29, -40, 0], early: [76, -30, 0], late: [51, -22, 0] }, hitSfx: 's_sword_orya_seqData', barelySfx: 's_f_shuji_v_nuaa_seqData' },
  /* KOKORO 2  */ { anim: 'kokoro_input2', paperJolt: [4, 4], brush: { hit: [17, -34, 1], early: [15, -41, 1], late: [21, -54, 1] }, hitSfx: 's_sword_hi_seqData', barelySfx: 's_f_shuji_v_ouch_seqData' },
  /* KOKORO 3  */ { anim: 'kokoro_input3', paperJolt: [6, 6], brush: { hit: [44, -36, 1], early: [60, -32, 0], late: [38, -51, 1] }, hitSfx: 's_sword_hi_seqData', barelySfx: 's_f_shuji_v_ouch_seqData' },
  /* RE 1      */ { anim: 're_input1', paperJolt: [6, -6], brush: { hit: [39, -29, 0], early: [30, -14, 0], late: [17, -8, 0] }, hitSfx: 's_sword_orya_seqData', barelySfx: 's_f_shuji_v_nuaa_seqData' },
  /* COMMA 1   */ { anim: 'comma_input1', paperJolt: [5, 6], brush: { hit: [12, -4, 1], early: [35, -6, 0], late: [20, -10, 0] }, hitSfx: 's_sword_hi_seqData', barelySfx: 's_f_shuji_v_ouch_seqData' },
  /* FACE 1    */ { anim: 'face_input1', paperJolt: [6, -1], brush: { hit: [32, -11, 0], early: [10, 81, 0], late: [0, 14, 0] }, hitSfx: 's_sword_orya_seqData', barelySfx: 's_f_shuji_v_unuu_seqData' },
];

export const PC_DEFAULTS = {
  timing: {
    cueDurationTicks: 24, // charge -> stroke, 1 beat
    hitWindow: [-4, 4], // frames
    barelyWindow: [-24, 12], // frames
    cueLifetimeTicks: 48,
    stumbleTicks: 48, // dancers stumble this long after a barely
    chargeGlowTicks: 12,
  },
  layout: {
    paperCenter: { x: 120, y: 84 }, // kana, strokes and brush offsets are relative to this
    brushStart: { x: 180, y: 100 },
    paperExitFast: [-4, -8], // finished sheet flies off (px/frame)
    paperExitSlow: [0, -1],
    raiseBrushBy: 24,
    people: { mColumnX: 32, mStartY: -160, wColumnX: 216, wStartY: 192, spacing: 32, perColumn: 6, scrollPerFrame: 0.125, wrap: 192 },
    captionY: 146,
  },
  strokes: STROKES,
  kanaAnims: ['onore', 'chikara', 'sun', 'kokoro', 're', 'comma', 'face', 'end_kanji'],
  sounds: {
    miss: 's_f_shuji_v_nuahaha_seqData',
    chargeVoice: 's_f_shuji_v_funuue_seqData', // cut off when the stroke lands
    kokoro2Finish: 's_furi_seqData',
  },
  // Brush glow: OBJ palette `slot` fades from palettes[from] to palettes[to] (and back) around each cue.
  glow: { slot: 11, charge: [11, 12], release: [13, 11] },
  colors: {
    bg: {} as Record<string, string>,
    obj: {} as Record<string, string>,
  },
  text: {} as Record<string, string>,
  theme: { title: 'Power Calligraphy' },
};

export type PcTuning = typeof PC_DEFAULTS;

async function fetchJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function loadPcTuning(): Promise<PcTuning> {
  let t = structuredClone(PC_DEFAULTS);
  const mod = await fetchJson(`${import.meta.env.BASE_URL}mods/power_calligraphy.json`);
  if (mod) t = mergeTuning(t, mod);
  return t;
}
