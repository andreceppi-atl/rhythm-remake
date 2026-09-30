// In-browser self test: open /?manual&selftest (or call __rh.selftest()).
// Runs the level deterministically on a virtual clock and checks judgement against the decomp's rules.
import type { Runtime } from './engine/runtime';
import { Sequencer, type LevelData } from './engine/sequencer';
import pcReference from '../reference/power-calligraphy-timeline.json';

type Check = { name: string; pass: boolean; detail: string };

async function runLevel(rt: Runtime, play: (s: string) => Promise<void>, scene: string, autoplay: number | null, maxSeconds = 400) {
  rt.autoplay = autoplay;
  await play(scene);
  let n = 0;
  while (!rt.finished && n < 60 * maxSeconds) {
    rt.step();
    n++;
  }
  const counts = { hit: 0, barely: 0, miss: 0, stray: 0 };
  for (const h of rt.gameplay.history) {
    const k = (['hit', 'barely', 'miss', '', 'stray'] as const)[h.result];
    if (k) counts[k]++;
  }
  return { counts, score: rt.gameplay.results.finalScore(), rank: rt.gameplay.results.evaluate((l) => l).rank };
}

export async function selftest(rt: Runtime, play: (s: string) => Promise<void>): Promise<Check[]> {
  if (!rt.manual) throw new Error('selftest needs ?manual (virtual clock)');
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail: unknown) => checks.push({ name, pass, detail: JSON.stringify(detail) });

  // Karate Man judge matrix: hit ±3f, barely ±5f, 2 mercy misses.
  const scene = 'scene_karate_man_skipped_practice';
  const r0 = await runLevel(rt, play, scene, 0);
  check('KM autoplay 0f: all hit, Superb, 1000', r0.counts.hit === 35 && r0.rank === 'superb' && r0.score === 1000, r0);
  for (const o of [3, -3]) {
    const r = await runLevel(rt, play, scene, o);
    check(`KM ${o > 0 ? '+' : ''}${o}f: still hit (score 640)`, r.counts.hit === 35 && r.score === 640, r);
  }
  for (const o of [4, 5, -5]) {
    const r = await runLevel(rt, play, scene, o);
    check(`KM ${o > 0 ? '+' : ''}${o}f: all barely`, r.counts.barely === 35 && r.rank === 'try_again', r);
  }
  const r6 = await runLevel(rt, play, scene, 6);
  check('KM +6f: miss (first 2 forgiven as barely), presses are stray', r6.counts.miss === 33 && r6.counts.barely === 2 && r6.counts.stray === 34, r6);

  // Miss punishment: a stray press shrinks the next cue's hit window to ±1f for 12 ticks.
  rt.autoplay = null;
  await play(scene);
  while (!rt.gameplay.cues.length) rt.step();
  const cue = rt.gameplay.cues[0];
  while (rt.now < cue.targetTime - 0.1) rt.step();
  rt.pressAt(cue.targetTime - 0.15); // stray (outside the -5f window)
  rt.step();
  while (rt.now < cue.targetTime + 2 / 60) rt.step();
  rt.pressAt(cue.targetTime + 2 / 60); // +2f: a hit normally, barely while punished
  rt.step();
  const last = rt.gameplay.history.filter((h) => h.cue === cue.id).pop();
  const punishTicksLeft = (cue.targetTime - (cue.targetTime - 0.15)) < (12 / 24) * (60 / cue.tempo);
  check('Stray press then +2f inside 12 ticks -> barely', !!last && last.result === 1 && punishTicksLeft, last);

  // Power Calligraphy judge: hit ±4f, barely −24f..+12f (lopsided), 29 strokes, mercy 2.
  const pc = 'scene_power_calligraphy_skipped_practice';
  const p0 = await runLevel(rt, play, pc, 0);
  check('PC autoplay 0f: 29 hits, Superb', p0.counts.hit === 29 && p0.rank === 'superb', p0);
  for (const o of [4, -4]) {
    const r = await runLevel(rt, play, pc, o);
    check(`PC ${o > 0 ? '+' : ''}${o}f: still hit`, r.counts.hit === 29, r);
  }
  for (const o of [5, 12, -24]) {
    const r = await runLevel(rt, play, pc, o);
    check(`PC ${o > 0 ? '+' : ''}${o}f: all barely`, r.counts.barely === 29, r);
  }
  const p13 = await runLevel(rt, play, pc, 13);
  check('PC +13f: miss (first 2 forgiven)', p13.counts.miss === 27 && p13.counts.barely === 2, p13);

  // Sequencer timing vs the reference timeline extracted from the decomp (Power Calligraphy).
  try {
    const level: LevelData = await (await fetch(`${import.meta.env.BASE_URL}gba/power_calligraphy/level.json`)).json();
    const spawns: number[] = [];
    const seq = new Sequencer(level, {
      op: (op, t) => {
        if (op[0] === 'run' && op[1] === 'gameplay_spawn_cue') spawns.push(t);
        return true;
      },
    });
    seq.tempo = 127;
    seq.start('script_power_calligraphy_main', 0);
    seq.run(200);
    const ref = (pcReference.events as { spawnMs?: number }[]).filter((e) => e.spawnMs !== undefined).map((e) => e.spawnMs! / 1000);
    const maxErrMs = Math.max(...ref.map((t, i) => Math.abs(t - (spawns[i] ?? Infinity)) * 1000));
    check('Power Calligraphy: 29 cue spawns match reference timeline (<1ms)', spawns.length === ref.length && maxErrMs < 1, { spawns: spawns.length, ref: ref.length, maxErrMs });
  } catch (e) {
    check('Power Calligraphy timeline', false, String(e));
  }
  return checks;
}
