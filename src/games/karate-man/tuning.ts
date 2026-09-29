// Every knob of Karate Man in one place. Defaults = the GBA original (values from src/engines/karate_man.c).
//
// To personalise without touching code, put a partial copy in public/mods/karate_man.json; it is
// deep-merged over these defaults at startup (see loadTuning). Units:
//   px      GBA screen pixels (screen is 240x160)
//   px/f    pixels per 60 Hz frame (the GBA stored these as 24.8 fixed point: 0x100 = 1 px/f)
//   ticks   script ticks, 24 per beat (so they scale with tempo)
//   frames  60 Hz frames (fixed real time, like the original hit windows)
//   angle   1/256ths of a turn

export const KARATE_DEFAULTS = {
  layout: {
    joe: { x: 80, y: 88 }, // Joe's anchor (belt); see reference/specs/karate_man/SPEC.md
    objectStart: { x: 156, y: 52 }, // where objects are created (immediately moved by the approach)
    shadowStartY: 133,
    // Incoming flight: x = centerX + xOffset/p, y = centerY + (lift - arc(p))/p, p = 1 at the ideal hit.
    approach: { centerX: 120, centerY: 80, xOffset: 36, arcHeight: 81, lift: 53, floorDepth: 53 },
    hitEffect: { x: 158, y: 54 },
    flowMeter: { x: 36, y: 16 },
    cueText: { x: 120, y: 24 },
    tutorialButton: { x: 172, y: 112 },
    tutorialCounter: { x: 30, y: 76 },
    despawnX: 272, // punched objects are removed past this x
  },

  timing: {
    cueDurationTicks: 24, // toss -> ideal punch (1 beat)
    windows: {
      normal: { hit: [-3, 3], barely: [-5, 5] }, // frames
      strict: { hit: [-1, 1], barely: [-3, 3] }, // practice pots
    },
    objectLifetimeTicks: 120,
    outOfReachProgress: 1.5, // p where Joe gives up (miss reaction)
    floorProgress: 2.0, // p where the object lands and flow resets
    reactionTicks: { miss: 36, barely: 36, smirk: 36, happy: 108 },
  },

  physics: {
    lowHit: { vx: 4, vy: -2, gravity: 0.25, spin: -6 }, // px/f, px/f², angle/f
    highHit: { vx: 8, vy: -2, gravity: 0, spin: -16 },
    ouch: { vx: 0, vy: 0, gravity: 0.125, angle: 10, spin: 0 }, // rock/bomb at low flow
    barely: { vx: 0.25, vy: -2, gravity: 0.125, spin: 4 },
    landSpinRandom: 16, // random extra angle when an object hits the floor
  },

  flow: {
    enabled: true,
    max: 5,
    highAt: 3, // flow level where punches become "high" (and heavy objects stop hurting)
    heavyNeedsHighFlow: true,
    backgroundLow: [5], // BG palettes cycled into palette 4 each beat
    backgroundHigh: [6, 7],
  },

  // Object types in cue order. `cel` = frame of anim `object`; `heavy` objects hurt without high flow.
  objects: {
    pot: { cel: 0, heavy: false, hitSfx: 's_f_boxing_just_hati_seqData' },
    rock: { cel: 1, heavy: true, hitSfx: 's_f_boxing_just_rock_seqData' },
    ball: { cel: 2, heavy: false, hitSfx: 's_f_boxing_just_ball_seqData' },
    bomb: { cel: 3, heavy: true, hitSfx: 's_f_boxing_just_bomb_seqData' },
    bulb: { cel: 4, heavy: false, hitSfx: 's_f_boxing_just_light_seqData' },
  },

  sounds: {
    toss: 's_f_boxing_fly_nml_seqData',
    barely: 's_witch_donats_seqData',
    lowFlowHit: 's_f_boxing_normal_seqData', // replaces the object's hit sound below high flow
    emptyPunch: 's_f_boxing_punch_seqData',
    land: 's_f_boxing_land_seqData',
    hurt: 's_f_boxing_hard_seqData',
    cheer: 's_f_boxing_kansei_seqData',
    missVoice: 's_f_boxing_v_nua_seqData',
    flowUp: 's_f_boxing_score_up_seqData',
    flowDown: 's_f_boxing_score_down_seqData',
    flowReset: 's_f_boxing_score_reset_seqData',
  },

  // Animation names (decomp names without the "anim_karate_" prefix). Point these at other anims to remap.
  anims: {
    stand: 'joe_stand',
    beat: 'joe_beat',
    punchLow: 'joe_punch_low',
    punchHigh: 'joe_punch_high',
    punchOuch: 'joe_punch_ouch',
    smugLow: 'joe_smug_low',
    smugHigh: 'joe_smug_high',
    barely: 'joe_barely',
    miss: 'joe_miss',
    smirk: 'joe_smirk',
    happy: 'joe_happy',
    object: 'object',
    shadow: 'object_shadow',
    hitEffect: 'hit_effect',
    flowMeter: 'flow_meter',
    cueWarning: 'cue_warning',
    tutorialButton: 'tutorial_text_button',
    tutorialCounter: 'tutorial_counter',
  },

  // Colour overrides, "palette:index" -> "#rrggbb".
  //   Background: BG palette 5 colours 2-3 = low-flow yellow; palettes 6/7 colours 2-3 = high-flow
  //   stripes (they alternate every beat). Joe, objects and hearts use OBJ palette 1:
  //   1:1 outline black, 1:14/1:15 gi white, 1:4 belt red; flow hearts use 1:2 cyan, 1:3 blue, 1:4 red, 1:5 yellow.
  colors: {
    bg: {} as Record<string, string>,
    obj: {} as Record<string, string>,
  },

  // Text overrides by script label (D_xxxxxxx), on top of text-en.ts.
  text: {} as Record<string, string>,

  // Menu, title card and results wording.
  theme: {
    title: 'Karate Man',
    subtitle: 'GBA 1:1 build · placeholder art & audio from the decomp',
    prologueTitle: 'Karate Man',
    resultsHeader: '', // empty = the game's own ("The Master's Words")
    ranks: { try_again: 'Try Again', ok: 'OK', superb: 'Superb' },
  },
};

export type KarateTuning = typeof KARATE_DEFAULTS;

type Json = Record<string, unknown>;
export function mergeTuning<T>(base: T, over: unknown): T {
  return merge(base, over);
}

function merge<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T;
  const out = { ...(base as Json) };
  for (const [k, v] of Object.entries(over as Json)) out[k] = k in out && typeof out[k] === 'object' && !Array.isArray(out[k]) ? merge(out[k], v) : v;
  return out as T;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Defaults, then public/mods/karate_man.json, then the skin's own `tuning` block (its "world").
export async function loadTuning(skinId?: string): Promise<KarateTuning> {
  let t = structuredClone(KARATE_DEFAULTS);
  const mod = await fetchJson(`${import.meta.env.BASE_URL}mods/karate_man.json`);
  if (mod) t = merge(t, mod);
  if (skinId && /^[a-z0-9][a-z0-9_-]*$/.test(skinId)) {
    const skin = (await fetchJson(`${import.meta.env.BASE_URL}skins/${skinId}/skin.json`)) as { tuning?: unknown } | null;
    if (skin?.tuning) t = merge(t, skin.tuning);
  }
  return t;
}
