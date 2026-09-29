// Beatscript interpreter. Scripts come from tools/convert-game.mjs as primitive ops:
//   ["rest", 24], ["call", "sub"], ["run", "fn", arg], ["run2", "fn", a, b], ["play_music", "s_x_seqData"], ...
//
// Time is exact (seconds on the audio clock) rather than frame-quantised: every op gets the precise
// moment it would fire given `rest` ticks at the current tempo (24 ticks = 1 beat). The runtime asks
// the sequencer to run everything due up to the current logic time each frame.

export type Op = [string, ...(string | number)[]];

export interface LevelData {
  scripts: Record<string, Op[]>;
  structs: Record<string, (string | number)[]>;
  scenes: Record<string, string>;
}

export interface SequencerHost {
  // Returns true if the op was handled; anything unhandled is logged once.
  op(op: Op, time: number): boolean;
}

interface Frame {
  script: string;
  pc: number;
  loopStart: number | null;
}

export class Sequencer {
  tempo = 120;
  nextTime = 0; // when the next op runs
  running = false;
  paused = false;
  private pausedAt = 0;
  private stack: Frame[] = [];
  private cur: Frame | null = null;
  loopsEnabled = true;
  private readonly warned = new Set<string>();

  constructor(
    private readonly level: LevelData,
    private readonly host: SequencerHost,
  ) {}

  start(script: string, time: number) {
    if (!this.level.scripts[script]) throw new Error(`no script ${script}`);
    this.cur = { script, pc: 0, loopStart: null };
    this.stack = [];
    this.nextTime = time;
    this.running = true;
    this.paused = false;
  }

  stop() {
    this.running = false;
  }

  ticksToSeconds(ticks: number, tempo = this.tempo) {
    return (ticks / 24) * (60 / tempo);
  }

  setPaused(paused: boolean, now: number) {
    if (paused === this.paused) return;
    if (paused) this.pausedAt = now;
    else this.nextTime += Math.max(0, now - this.pausedAt);
    this.paused = paused;
  }

  // Run every op due at or before `now`.
  run(now: number) {
    let guard = 0;
    while (this.running && !this.paused && this.cur && this.nextTime <= now + 1e-9) {
      if (guard++ > 10000) throw new Error('beatscript runaway');
      const script = this.level.scripts[this.cur.script];
      if (this.cur.pc >= script.length) {
        if (!this.ret()) this.running = false;
        continue;
      }
      const op = script[this.cur.pc++];
      this.exec(op);
    }
  }

  private ret() {
    const f = this.stack.pop();
    if (!f) return false;
    this.cur = f;
    return true;
  }

  private exec(op: Op) {
    const [name, a, b] = op;
    const t = this.nextTime;
    switch (name) {
      case 'rest':
        this.nextTime += this.ticksToSeconds(Number(a));
        return;
      case 'rest_beats':
        this.nextTime += this.ticksToSeconds(Number(a) * 24);
        return;
      case 'stop':
        this.running = false;
        return;
      case 'call':
        this.stack.push(this.cur!);
        this.cur = { script: String(a), pc: 0, loopStart: null };
        return;
      case 'return':
        if (!this.ret()) this.running = false;
        return;
      case 'goto':
        this.cur = { script: String(a), pc: 0, loopStart: null };
        return;
      case 'loop_start':
        this.cur!.loopStart = this.cur!.pc;
        return;
      case 'loop_end':
        if (this.loopsEnabled && this.cur!.loopStart !== null) this.cur!.pc = this.cur!.loopStart;
        return;
      case 'run':
        if (a === 'set_beatscript_tempo') {
          this.tempo = Number(b);
          this.host.op(op, t);
          return;
        }
        if (a === 'beatscript_disable_loops') {
          this.loopsEnabled = false;
          return;
        }
        if (a === 'beatscript_enable_loops') {
          this.loopsEnabled = true;
          return;
        }
        break;
      case 'switch_random': {
        // Pick one `case` block at random and skip to its body; `break` jumps to end_switch.
        const script = this.level.scripts[this.cur!.script];
        const cases: number[] = [];
        let depth = 0;
        let i = this.cur!.pc;
        for (; i < script.length; i++) {
          const n = script[i][0];
          if (n === 'switch_random' || n === 'switch') depth++;
          if (n === 'end_switch') {
            if (depth === 0) break;
            depth--;
          }
          if (n === 'case' && depth === 0) cases.push(i + 1);
        }
        const pick = cases[Math.floor(Math.random() * Math.max(1, Math.min(cases.length, Number(a) || cases.length)))];
        this.cur!.pc = pick ?? i;
        return;
      }
      case 'break': {
        const script = this.level.scripts[this.cur!.script];
        let i = this.cur!.pc;
        while (i < script.length && script[i][0] !== 'end_switch') i++;
        this.cur!.pc = i + 1;
        return;
      }
      case 'case':
      case 'end_switch':
        return;
    }
    if (!this.host.op(op, t)) {
      const key = name === 'run' || name === 'run2' ? `${name}:${a}` : name;
      if (!this.warned.has(key)) {
        this.warned.add(key);
        console.debug('beatscript: ignored', key);
      }
    }
  }
}
