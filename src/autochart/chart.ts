// Chart generation with a Karate Man feel.
//
// Every cue is "toss on beat b-1, punch on beat b" (24-tick cue, like the original).
// 1. Accent profile: the song's average onset strength at each of the 4 beats in a bar (and the
//    offbeats). Punches go on the song's own strongest positions first (e.g. the trap snare on 3).
// 2. Bar intensity is ranked *within the song* (quiet / mid / high), so loud, flat masters still
//    breathe; intensity + difficulty decide how many accent positions a bar uses.
// 3. 4-bar phrases: the fourth bar thins out (Rhythm Heaven's call-and-response space).
// 4. Objects: a bomb opens a new loud section, rocks land on loud downbeats every other bar,
//    offbeat punches are light bulbs, some mid-intensity punches are balls. Rest = pots.
import type { Analysis } from './analyze';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type CueKind = 'pot' | 'ball' | 'bulb' | 'rock' | 'bomb';

export interface Chart {
  version: 1;
  title: string;
  difficulty: Difficulty;
  bpm: number;
  firstBeat: number; // seconds into the audio file
  duration: number;
  cues: { beat: number; kind: CueKind }[]; // beat = punch time in beats from firstBeat
}

type Level = 'quiet' | 'mid' | 'high';
// How many accent positions (strongest first) a bar uses.
const DENSITY: Record<Difficulty, Record<Level, number>> = {
  easy: { quiet: 0, mid: 1, high: 2 },
  normal: { quiet: 1, mid: 2, high: 3 },
  hard: { quiet: 2, mid: 3, high: 4 },
};

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

export function accentProfile(a: Analysis) {
  const on = [0, 0, 0, 0], off = [0, 0, 0, 0], n = [0, 0, 0, 0];
  for (let k = 0; k < a.beatCount; k++) {
    const p = (((k - a.downbeat) % 4) + 4) % 4;
    on[p] += a.beatStrength[k] ?? 0;
    off[p] += a.offStrength[k] ?? 0;
    n[p]++;
  }
  const beats = on.map((v, i) => v / Math.max(1, n[i]));
  const offs = off.map((v, i) => v / Math.max(1, n[i]));
  // Beat positions, strongest first (ties keep the downbeat first).
  const order = [0, 1, 2, 3].sort((x, y) => beats[y] - beats[x] || x - y);
  const bestOff = [0, 1, 2, 3].sort((x, y) => offs[y] - offs[x])[0];
  return { beats, offs, order, bestOff, offIsStrong: offs[bestOff] > 0.8 * Math.max(...beats) };
}

export function generateChart(a: Analysis, difficulty: Difficulty, title: string): Chart {
  const rand = rng(Math.round(a.duration * 1000) ^ Math.round(a.bpm * 100) ^ (difficulty.length * 7919));
  const prof = accentProfile(a);
  const ranked = [...a.barEnergy].sort((x, y) => x - y);
  const rankOf = (e: number) => ranked.findIndex((v) => v >= e) / Math.max(1, ranked.length - 1);
  const level = (e: number): Level => (e < 0.3 || rankOf(e) < 0.2 ? 'quiet' : rankOf(e) < 0.55 ? 'mid' : 'high');

  const cues: Chart['cues'] = [];
  const lastBeat = a.beatCount - 2;
  for (let bar = 0; bar < a.barEnergy.length; bar++) {
    const start = a.downbeat + bar * 4;
    if (start + 4 > lastBeat) break;
    const e = a.barEnergy[bar];
    const lv = level(e);
    const prevAvg = bar >= 2 ? (a.barEnergy[bar - 1] + a.barEnergy[bar - 2]) / 2 : e;
    const sectionStart = bar > 0 && e - prevAvg > 0.3 && lv === 'high';
    const phraseEnd = bar % 4 === 3;

    let count = DENSITY[difficulty][lv];
    if (phraseEnd && count > 1) count--; // breathe at the end of the phrase
    if (lv === 'high' && difficulty !== 'easy' && rand() < 0.25) count = Math.max(1, count - 1); // variety
    const hits = prof.order.slice(0, count).sort((x, y) => x - y) as number[];
    // Hard, loud bars: add the song's strongest offbeat if it really carries a hit.
    if (difficulty === 'hard' && lv === 'high' && !phraseEnd && prof.offIsStrong && (a.offStrength[start + prof.bestOff] ?? 0) > 0.5) {
      hits.push(prof.bestOff + 0.5);
      hits.sort((x, y) => x - y);
    }
    hits.forEach((h, i) => {
      const beat = start + h;
      if (beat < 2 || beat > lastBeat) return;
      let kind: CueKind = 'pot';
      if (h % 1 !== 0) kind = 'bulb';
      else if (i === 0 && sectionStart && difficulty !== 'easy') kind = 'bomb';
      else if (h === 0 && lv === 'high' && bar % 2 === 1 && difficulty !== 'easy') kind = 'rock';
      else if (lv === 'mid' && rand() < 0.2) kind = 'ball';
      cues.push({ beat, kind });
    });
  }
  cues.sort((p, q) => p.beat - q.beat);
  const spaced = cues.filter((c, i) => i === 0 || c.beat - cues[i - 1].beat >= 0.5);
  return { version: 1, title, difficulty, bpm: a.bpm, firstBeat: a.firstBeat, duration: a.duration, cues: spaced };
}
