// Chart -> beatscript, so imported songs run on the unchanged engine (sequencer, cue judge, results).
import type { LevelData, Op } from '../engine/sequencer';
import type { Chart, CueKind } from './chart';

export const CUSTOM_SCRIPT = 'script_custom_song';
const CUE_ID: Record<CueKind, number> = { pot: 0, ball: 1, rock: 4, bomb: 5, bulb: 8 };

export const CUSTOM_TEXT: Record<string, string> = {
  CUSTOM_HEADER: 'Results',
  CUSTOM_POS: 'You were locked into the beat!',
  CUSTOM_NEG: 'You lost the beat.',
};

export function chartToLevel(chart: Chart): Pick<LevelData, 'scripts' | 'structs'> {
  const ticksPerSec = (chart.bpm * 24) / 60;
  const beatTick = (b: number) => chart.firstBeat * ticksPerSec + b * 24;
  const events: { tick: number; order: number; op: Op }[] = [];
  const lastBeat = Math.floor((chart.duration - chart.firstBeat) * (chart.bpm / 60));
  for (let b = 0; b <= lastBeat; b++) events.push({ tick: beatTick(b), order: 0, op: ['run2', 'gameplay_run_common_event', 0, 0] });
  for (const c of chart.cues) events.push({ tick: beatTick(c.beat - 1), order: 1, op: ['run', 'gameplay_spawn_cue', CUE_ID[c.kind]] });
  events.sort((p, q) => p.tick - q.tick || p.order - q.order);

  const ops: Op[] = [
    ['run', 'set_beatscript_tempo', chart.bpm],
    ['run2', 'gameplay_set_current_engine', 0, 'karate_man_engine'],
    ['run', 'results_set_header', 'CUSTOM_HEADER'],
    ['run', 'results_import_marking_criteria', 'custom_criteria'],
    ['run', 'gameplay_set_mercy_count', 2],
    ['run', 'gameplay_set_marking_criteria', 0],
    ['run', 'results_enable_input_tracking', 1],
    ['rest', 24],
    ['play_audio', 'custom'],
  ];
  let t = 0;
  for (const e of events) {
    if (e.tick < 0) continue;
    if (e.tick > t) ops.push(['rest', e.tick - t]);
    t = Math.max(t, e.tick);
    ops.push(e.op);
  }
  const end = chart.duration * ticksPerSec + 24;
  if (end > t) ops.push(['rest', end - t]);
  ops.push(['stop']);

  return {
    scripts: { [CUSTOM_SCRIPT]: ops },
    structs: {
      // Superb: 90%+ hits and no misses. Try Again: under 60% hits or over 30% misses.
      custom_criteria_0: ['CUSTOM_POS', 'CUSTOM_NEG', 0x181, 0xe6, 0x99, 0x4c],
      custom_criteria: ['custom_criteria_0', 'END_OF_CRITERIA'],
    },
  };
}
