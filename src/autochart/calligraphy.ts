// Song -> Power Calligraphy / Young Stoner Life level. The characters' scripts are self-timed (each one writes
// its strokes on fixed beats), so a song level is those character slots laid on the song's bar grid in the
// level's own order, at the song's tempo, with the song as the music.
import { Sequencer, type LevelData, type Op } from '../engine/sequencer';
import type { Analysis } from './analyze';
import type { Difficulty } from './chart';
import { DANCERS_ON } from '../games/power-calligraphy/ysl';

export const PC_SONG_SCENES = { pc: 'scene_pc_song_pc', ysl: 'scene_pc_song_ysl' } as const;
export type CalligraphySet = keyof typeof PC_SONG_SCENES;
const MAINS: Record<CalligraphySet, string> = { pc: 'script_power_calligraphy_main', ysl: 'script_pc_ysl_main' };
const ENGINE = 'power_calligraphy_engine';

interface Slot { init: string; sub: string; criteria: number; ticks: number; firstHit: number; hits: number[] }

// The slots of a level's main script, in order: [call X_init] ... [set_marking_criteria c] [call X].
function slotsOf(level: LevelData, main: string): Omit<Slot, 'ticks' | 'firstHit' | 'hits'>[] {
  const out: Omit<Slot, 'ticks' | 'firstHit' | 'hits'>[] = [];
  let init = '', criteria = 0;
  for (const op of level.scripts[main]) {
    if (op[0] === 'call' && String(op[1]).endsWith('_init')) init = String(op[1]);
    else if (op[0] === 'run' && op[1] === 'gameplay_set_marking_criteria') criteria = Number(op[2]);
    else if (op[0] === 'call' && init && op[1] === init.replace(/_init$/, '')) {
      out.push({ init, sub: String(op[1]), criteria });
      init = '';
    }
  }
  return out;
}

// Length of init + sub in ticks, and when its first stroke lands (cue spawn + 1 beat), by running it.
function measure(level: LevelData, s: Omit<Slot, 'ticks' | 'firstHit' | 'hits'>): Slot {
  const probe = '__pc_probe';
  const spawns: number[] = [];
  let end = 0;
  const seq = new Sequencer({ ...level, scripts: { ...level.scripts, [probe]: [['call', s.init], ['call', s.sub], ['run', '__end']] } }, {
    op: (op, t) => {
      if (op[0] === 'run' && op[1] === 'gameplay_spawn_cue') spawns.push(t);
      if (op[0] === 'run' && op[1] === '__end') end = t;
      return true;
    },
  });
  seq.tempo = 60; // 1 s = 24 ticks
  seq.start(probe, 0);
  seq.run(1e6);
  const hits = spawns.map((t) => Math.round(t * 24) + 24);
  return { ...s, ticks: Math.round(end * 24), firstHit: hits[0] ?? 0, hits };
}

export function calligraphyLevel(level: LevelData, grid: Analysis, set: CalligraphySet, difficulty: Difficulty): Pick<LevelData, 'scripts' | 'scenes'> {
  const main = MAINS[set];
  const order = slotsOf(level, main).map((s) => measure(level, s));
  const finale = order[order.length - 1];
  const loop = order.slice(0, -1);
  const tick = (beat: number) => (grid.firstBeat * grid.bpm / 60 + beat) * 24; // song beat -> ticks after the audio starts
  const bar = 96;
  const endTick = grid.duration * (grid.bpm / 60) * 24;
  // The original slots put their strokes on the beat; keep that phase when snapping slots to bars.
  const phase = ((order[0].firstHit % 24) + 24) % 24;
  // First slot: the first bar with some energy, leaving a bar for "Ready! Calligraphy!!".
  const firstBar = Math.max(1, grid.barEnergy.findIndex((e) => e > 0.3));
  let at = tick(grid.downbeat + 4 * firstBar) - phase;
  const gapBars = difficulty === 'easy' ? 1 : 0;
  // Put the strokes on the song's strongest beat of the bar (e.g. a trap snare on 3): try each beat offset
  // and keep the one whose stroke positions line up with the most onset strength.
  const acc = [0, 1, 2, 3].map((k) => {
    const v = grid.beatStrength.filter((_, b) => (((b - grid.downbeat) % 4) + 4) % 4 === k);
    return v.reduce((a, x) => a + x, 0) / Math.max(1, v.length);
  });
  const shift = [0, 1, 2, 3]
    .map((sft) => ({ sft, score: order.flatMap((o) => o.hits).reduce((a, h) => a + acc[(Math.round((h - phase) / 24) + sft) % 4], 0) }))
    .sort((a, b) => b.score - a.score)[0].sft;
  at += shift * 24;

  const ops: Op[] = [
    ['run', 'set_beatscript_tempo', Math.round(grid.bpm * 100) / 100],
    ['run', 'results_set_header', 'D_0805d2f0'],
    ...level.scripts[main].filter((op) => op[0] === 'run' && ['results_import_marking_criteria', 'gameplay_set_mercy_count', 'results_enable_input_tracking'].includes(String(op[1]))),
    ['play_audio', 'custom'],
  ];
  let t = 0;
  const restTo = (target: number) => {
    if (target > t) ops.push(['rest', target - t]);
    t = Math.max(t, target);
  };
  restTo(Math.max(0, at - bar));
  ops.push(['run2', 'gameplay_run_common_event', 1, 'D_0805d2dc']);
  restTo(at - 24);
  ops.push(['run2', 'gameplay_run_common_event', 1, 0]);
  ops.push(['run', 'gameplay_start_perfect_campaign']);
  if (set === 'ysl') ops.push(...DANCERS_ON); // Tezzus + Diamond* dance the whole song
  let i = 0, slots = 0;
  for (;;) {
    let next = loop[i % loop.length];
    const fitsNext = at + next.ticks + finale.ticks + bar <= endTick;
    if (!fitsNext) next = finale;
    restTo(at);
    ops.push(
      ['run', 'gameplay_set_engine_event_param', 0],
      ['run2', 'gameplay_run_engine_event', 3, ENGINE],
      ['call', next.init],
      ['run', 'gameplay_set_marking_criteria', next.criteria],
      ['call', next.sub],
    );
    t = at + next.ticks;
    slots++;
    if (next === finale) break;
    at += Math.ceil((next.ticks + phase) / bar) * bar + gapBars * bar; // next slot on a bar line (same phase)
    i++;
  }
  // The original ending: last sheet away, perfect check, exit animation.
  ops.push(['run2', 'gameplay_run_engine_event', 6, ENGINE], ['rest', 24], ['run', 'gameplay_check_for_perfect', 0], ['rest_beats', 4]);
  ops.push(['run', 'gameplay_set_engine_event_param', 4], ['run2', 'gameplay_run_engine_event', 11, ENGINE], ['rest_beats', 6], ['return']);

  const songMain = `script_pc_song_${set}_main`, entry = `script_pc_song_${set}_entry`;
  return {
    scripts: {
      [songMain]: ops,
      [entry]: [
        ['run', 'set_beatscript_tempo', grid.bpm],
        ['run', 'gameplay_set_screen_fade_in_time', 0],
        ['run2', 'gameplay_set_current_engine', 0, ENGINE],
        ['run', 'gameplay_inputs_enabled', 1],
        ['run', 'results_enable_input_tracking', 1],
        ['call', songMain],
        ['run', 'pause_menu_enabled', 0],
        ['run', 'gameplay_inputs_enabled', 0],
        ['fade_screen_out', 12, 0],
        ['rest', 24],
        ['stop'],
      ],
    },
    scenes: { [PC_SONG_SCENES[set]]: entry },
  };
}

