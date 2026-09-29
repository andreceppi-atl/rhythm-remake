// Cues and input judgement — a port of src/scenes/gameplay.c.
//
// A cue is spawned by the script; its ideal hit is `duration` ticks later. A press is judged by its
// offset from that target in 60 Hz frames (fractional here, integer on the GBA):
//   inside hitWindow -> HIT, inside barelyWindow -> BARELY, otherwise this cue ignores the press.
// Closest cue wins. A press no cue accepts is an "irrelevant input": the game's input event runs and
// for the next 12 ticks every hit window shrinks to [-1, +1] (miss punishment).
// A cue nobody hit expires once `target + barelyLate` has passed -> MISS (the first `mercy` misses
// count as barelies).
import { Results, RESULT_BARELY, RESULT_HIT, RESULT_MISS, RESULT_NONE } from './results';

// The GBA compared whole frames; allow for float error so a press exactly on a window edge counts.
const EPS = 1e-4;

export interface CueDef<Info = unknown> {
  duration: number; // ticks
  hitWindow: [number, number]; // frames
  barelyWindow: [number, number]; // frames
  tempoDependent?: boolean; // windows in ticks instead of frames
  spawnParam?: number;
  sfxSpawn?: string | null;
  sfxHit?: string | null;
  sfxBarely?: string | null;
  sfxMiss?: string | null;
  spawn?(cue: Cue<Info>, param: number): Info;
  // Return true to despawn. runningFrames/durationFrames are fractional frames.
  update?(cue: Cue<Info>, runningFrames: number, durationFrames: number): boolean;
  hit?(cue: Cue<Info>): void;
  barely?(cue: Cue<Info>): void;
  miss?(cue: Cue<Info>): void;
  despawn?(cue: Cue<Info>): void;
}

export interface Cue<Info = unknown> {
  id: number;
  def: CueDef<Info>;
  info: Info;
  spawnTime: number;
  targetTime: number;
  tempo: number;
  markingCriteria: number;
  judged: boolean; // hit or barely registered (unk48_b0)
  expired: boolean; // missed
  hitSfx: string | null;
  barelySfx: string | null;
}

export interface GameplayHost {
  playSound(name: string, at: number): void;
  inputEvent(time: number): void; // irrelevant input -> engine input event
  enableLoops(): void;
}

export class Gameplay {
  cues: Cue[] = [];
  private nextId = 1;
  readonly results = new Results();
  markingCriteria = 0;
  mercyEnabled = true;
  forgivableMisses = 0;
  assessIrrelevantInputs = false;
  inputsEnabled = true;
  punishUntil = -Infinity; // time until which miss punishment applies
  missPunishmentTicks = 12;
  lastHitOffset = 0; // frames
  ignoreThisCueResult = false;
  // Timeline of judgements for the debug overlay / tests.
  readonly history: { time: number; target: number; offset: number; result: number; cue: number; forgiven?: boolean }[] = [];

  constructor(private readonly host: GameplayHost) {}

  reset() {
    this.cues = [];
    this.results.reset();
    this.forgivableMisses = 0;
    this.punishUntil = -Infinity;
    this.history.length = 0;
  }

  spawn<I>(def: CueDef<I>, time: number, tempo: number): Cue<I> {
    const durSec = (def.duration / 24) * (60 / tempo);
    const cue: Cue<I> = {
      id: this.nextId++,
      def,
      info: undefined as I,
      spawnTime: time,
      targetTime: time + durSec,
      tempo,
      markingCriteria: this.markingCriteria,
      judged: false,
      expired: false,
      hitSfx: def.sfxHit ?? null,
      barelySfx: def.sfxBarely ?? null,
    };
    this.cues.push(cue as Cue);
    if (def.spawn) cue.info = def.spawn(cue, def.spawnParam ?? 0);
    if (def.sfxSpawn) this.host.playSound(def.sfxSpawn, time);
    return cue;
  }

  private windows(cue: Cue, time: number) {
    const d = cue.def;
    const conv = (v: number) => (d.tempoDependent ? (v / 24) * (60 / cue.tempo) * 60 : v);
    let [hitEarly, hitLate] = d.hitWindow.map(conv);
    const [missEarly, missLate] = d.barelyWindow.map(conv);
    if (time < this.punishUntil) {
      hitEarly = -1;
      hitLate = 1;
    }
    return { hitEarly, hitLate, missEarly, missLate };
  }

  // Per-frame update. `now` is the logic time; `heardNow` is the latest time the player could have
  // heard, used so a cue is only declared missed once its window has really closed.
  update(now: number, heardNow: number) {
    for (const cue of [...this.cues]) {
      const running = (now - cue.spawnTime) * 60;
      const duration = (cue.targetTime - cue.spawnTime) * 60;
      if (!cue.judged && !cue.expired) {
        const { missLate } = this.windows(cue, now);
        if ((heardNow - cue.targetTime) * 60 > missLate + EPS) {
          cue.expired = true;
          this.ignoreThisCueResult = false;
          cue.def.miss?.(cue);
          if (!this.ignoreThisCueResult) this.addResult(cue.markingCriteria, RESULT_MISS, 0, cue, now);
          if (cue.def.sfxMiss) this.host.playSound(cue.def.sfxMiss, now);
        }
      }
      if (cue.def.update?.(cue, running, duration)) this.despawn(cue);
    }
  }

  despawn(cue: Cue) {
    const i = this.cues.indexOf(cue);
    if (i < 0) return;
    this.cues.splice(i, 1);
    cue.def.despawn?.(cue);
  }

  // A button press heard at `heardTime`; reactions play at `now` (logic time).
  press(heardTime: number, now: number) {
    if (!this.inputsEnabled) return;
    let best: Cue | null = null;
    let bestOffset = Infinity;
    let bestHit = false;
    for (const cue of this.cues) {
      if (cue.judged || cue.expired) continue;
      const w = this.windows(cue, heardTime);
      const offset = (heardTime - cue.targetTime) * 60;
      if (offset < w.missEarly - EPS || offset > w.missLate + EPS) continue;
      if (Math.abs(offset) < Math.abs(bestOffset)) {
        best = cue;
        bestOffset = offset;
        bestHit = offset >= w.hitEarly - EPS && offset <= w.hitLate + EPS;
      }
    }
    if (best) {
      this.judge(best, bestHit, bestOffset, now);
      return;
    }
    if (this.assessIrrelevantInputs) this.results.registerInput(0, RESULT_NONE, 0);
    this.history.push({ time: heardTime, target: NaN, offset: NaN, result: RESULT_NONE, cue: 0 });
    this.host.inputEvent(now);
    this.punishUntil = heardTime + (this.missPunishmentTicks / 24) * (60 / (this.cues[0]?.tempo ?? 120));
  }

  private judge(cue: Cue, hit: boolean, offset: number, now: number) {
    cue.judged = true;
    this.lastHitOffset = offset;
    this.ignoreThisCueResult = false;
    if (hit) {
      cue.def.hit?.(cue);
      if (!this.ignoreThisCueResult) {
        this.addResult(cue.markingCriteria, RESULT_HIT, offset, cue, now);
        if (cue.hitSfx) this.host.playSound(cue.hitSfx, now);
      }
    } else {
      cue.def.barely?.(cue);
      if (!this.ignoreThisCueResult) {
        this.addResult(cue.markingCriteria, RESULT_BARELY, offset, cue, now);
        if (cue.barelySfx) this.host.playSound(cue.barelySfx, now);
      }
    }
  }

  addResult(criteria: number, result: number, offset: number, cue?: Cue, now = 0) {
    let forgiven = false;
    if (result === RESULT_MISS && this.mercyEnabled && this.forgivableMisses > 0) {
      result = RESULT_BARELY;
      this.forgivableMisses--;
      forgiven = true;
    }
    this.results.registerInput(0, result, Math.round(offset));
    this.results.registerCueInput(criteria, result, Math.round(offset));
    this.history.push({ time: now, target: cue?.targetTime ?? NaN, offset, result, cue: cue?.id ?? 0, forgiven });
  }
}
