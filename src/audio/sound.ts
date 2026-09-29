// Web Audio port of the decomp's MIDI sound driver (src/midi/*.c), close enough to sound like the GBA:
//   song -> MIDI events -> channel (program/volume/expression/pan/bend) -> instrument from the song's bank
//   PCM instruments play decomp samples at 2^((key - samplePitch)/12); ADSR runs per 60 Hz frame
//   exactly like midi_note_update_adsr (linear, Q16.16 units of 0..127), expressed as gain ramps.
//   Rhythm sub-banks (drum kits) use the sub-instrument's fixed key; split sub-banks pick by key.
//   "[" / "]" markers loop the song. Speed scales sequence tempo only (not pitch), as on the GBA.
import { parseMidi, type MidiFile } from './midi';

type Adsr = [number, number, number, number, number, number]; // initial, sustain, attack, decay, fade, release
type Instrument =
  | { kind: 'pcm'; fixed: boolean; key: number; pan: number; sample: string; adsr: Adsr }
  | { kind: 'psg'; key: number; pan: number; wave: number[] | null; adsr: Adsr; channel: string; duty: number; noise: string }
  | { kind: 'rhythm'; baseKey: number; bank: string }
  | { kind: 'split'; baseKey: number; table: number[]; bank: string };

export interface SoundPack {
  songs: Record<string, { midi: string; bank: string; volume: number; priority: number; player: string }>;
  banks: Record<string, (string | null)[]>;
  instruments: Record<string, Instrument>;
  samples: Record<string, { file: string; pitch: number; loop: [number, number] | null }>;
}

export interface PlayOptions {
  at?: number; // AudioContext time; default now
  volume?: number; // 0..256 like the decomp (256 = full)
  pitch?: number; // Q8 semitones (256 = +1 semitone)
  speed?: number; // sequence speed multiplier
  loop?: boolean; // honour [ ] markers (default true)
}

const FRAME = 1 / 60;
const E = 65536;

export interface SoundLogEntry {
  name: string;
  at: number;
  opts: PlayOptions;
}

// Envelope as piecewise-linear points (time offset in seconds, level 0..1), from note-on.
function adsrPoints(adsr: Adsr): { pts: [number, number][]; endsSelf: boolean } {
  const [init, sus, atk, dec, fade] = adsr;
  const pts: [number, number][] = [];
  let t = 0;
  let e = Math.min(init, 127 * E);
  pts.push([0, e / (127 * E)]);
  // ATTACK
  if (e < 127 * E) {
    if (atk <= 0) return { pts, endsSelf: false };
    t += Math.ceil((127 * E - e) / atk) * FRAME;
    e = 127 * E;
    pts.push([t, 1]);
  }
  // DECAY
  if (sus < e) {
    if (dec <= 0) return { pts, endsSelf: false };
    t += Math.ceil((e - sus) / dec) * FRAME;
    e = sus;
    pts.push([t, e / (127 * E)]);
  }
  // SUSTAIN with fade
  if (fade > 0) {
    t += Math.ceil(e / fade) * FRAME;
    pts.push([t, 0]);
    return { pts, endsSelf: true };
  }
  return { pts, endsSelf: e <= 0 };
}

function levelAt(pts: [number, number][], t: number) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1];
      const [t1, v1] = pts[i];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return pts[pts.length - 1][1];
}

interface Voice {
  ch: number;
  key: number;
  start: number;
  src: AudioScheduledSourceNode;
  gain: GainNode;
  pts: [number, number][];
  release: number;
  detuneParam: AudioParam | null;
  released: boolean;
}

interface Channel {
  program: number;
  volume: number;
  expression: number;
  pan: number;
  bend: number;
  bendRange: number;
  gain: GainNode | null;
  voices: Voice[];
}

export class SongPlayer {
  readonly name: string;
  private readonly midi: MidiFile;
  private idx = 0;
  private tick = 0;
  private time: number;
  private usPerQ = 500000;
  private channels: Channel[] = [];
  private readonly out: GainNode | null;
  stopped = false;
  finishedAt = Infinity;

  constructor(
    private readonly engine: SoundEngine,
    name: string,
    readonly opts: Required<PlayOptions>,
    private readonly bank: (string | null)[],
    songVolume: number,
  ) {
    this.name = name;
    this.midi = engine.midis.get(name)!;
    this.time = opts.at;
    const ctx = engine.ctx;
    if (ctx) {
      this.out = ctx.createGain();
      this.out.gain.value = (songVolume / 127) * (opts.volume / 256);
      this.out.connect(engine.master!);
    } else this.out = null;
    for (let c = 0; c < 16; c++) {
      this.channels.push({ program: 0, volume: 100, expression: 127, pan: 64, bend: 0, bendRange: 2, gain: null, voices: [] });
    }
  }

  private secondsPerTick() {
    return this.usPerQ / 1e6 / this.midi.ppq / this.opts.speed;
  }

  private channelGain(ch: Channel, at: number) {
    const ctx = this.engine.ctx!;
    if (!ch.gain) {
      ch.gain = ctx.createGain();
      ch.gain.connect(this.out!);
    }
    ch.gain.gain.setValueAtTime((ch.volume / 127) * (ch.expression / 127), Math.max(at, ctx.currentTime));
    return ch.gain;
  }

  // Schedule every event up to `until` (AudioContext time).
  schedule(until: number) {
    if (this.stopped) return;
    const { events, loopStart, loopEnd } = this.midi;
    for (;;) {
      if (this.opts.loop && loopEnd !== null && loopStart !== null && loopEnd > loopStart) {
        const next = this.idx < events.length ? events[this.idx].tick : Infinity;
        if (next >= loopEnd) {
          const tEnd = this.time + (loopEnd - this.tick) * this.secondsPerTick();
          if (tEnd > until) return;
          this.time = tEnd;
          this.tick = loopStart;
          this.idx = events.findIndex((e) => e.tick >= loopStart && e.type !== 'marker');
          if (this.idx < 0) this.idx = events.length;
          continue;
        }
      }
      if (this.idx >= events.length) {
        const tEnd = this.time + (this.midi.endTick - this.tick) * this.secondsPerTick();
        this.finishedAt = Math.max(tEnd, ...this.channels.flatMap((c) => c.voices.map((v) => v.start + 4)));
        return;
      }
      const ev = events[this.idx];
      const t = this.time + (ev.tick - this.tick) * this.secondsPerTick();
      if (t > until) return;
      this.time = t;
      this.tick = ev.tick;
      this.idx++;
      this.handle(ev, t);
    }
  }

  private handle(ev: MidiFile['events'][number], t: number) {
    const ctx = this.engine.ctx;
    switch (ev.type) {
      case 'tempo':
        this.usPerQ = ev.usPerQuarter;
        return;
      case 'program':
        this.channels[ev.ch].program = ev.program;
        return;
      case 'cc': {
        const ch = this.channels[ev.ch];
        if (ev.cc === 7) ch.volume = ev.value;
        else if (ev.cc === 11) ch.expression = ev.value;
        else if (ev.cc === 10) ch.pan = ev.value;
        else if (ev.cc === 0x14) ch.bendRange = ev.value;
        else return;
        if (ctx && (ev.cc === 7 || ev.cc === 11)) this.channelGain(ch, t);
        return;
      }
      case 'bend': {
        const ch = this.channels[ev.ch];
        ch.bend = ev.value;
        const cents = (ev.value / 8192) * ch.bendRange * 100 + (this.opts.pitch / 256) * 100;
        if (ctx) for (const v of ch.voices) v.detuneParam?.setValueAtTime(cents, Math.max(t, ctx.currentTime));
        return;
      }
      case 'noteOff': {
        const ch = this.channels[ev.ch];
        for (const v of ch.voices) if (v.key === ev.key && !v.released) this.releaseVoice(v, t);
        return;
      }
      case 'noteOn':
        this.noteOn(ev.ch, ev.key, ev.vel, t);
        return;
    }
  }

  private noteOn(chn: number, noteKey: number, vel: number, t: number) {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const ch = this.channels[chn];
    let inst = this.engine.instrument(this.bank[ch.program]);
    if (!inst) return;
    let key = noteKey;
    let panOffset = 0;
    if (inst.kind === 'rhythm') {
      const sub = this.engine.instrument(this.engine.pack.banks[inst.bank]?.[noteKey - inst.baseKey] ?? null);
      if (!sub || sub.kind === 'rhythm' || sub.kind === 'split') return;
      inst = sub;
      key = sub.key;
      panOffset = sub.pan === 127 ? 0 : sub.pan - 64;
    } else if (inst.kind === 'split') {
      const sub = this.engine.instrument(this.engine.pack.banks[inst.bank]?.[inst.table[noteKey - inst.baseKey]] ?? null);
      if (!sub || sub.kind === 'rhythm' || sub.kind === 'split') return;
      inst = sub;
    }
    const start = Math.max(t, ctx.currentTime);
    let src: AudioScheduledSourceNode;
    let detuneParam: AudioParam | null = null;
    if (inst.kind === 'pcm') {
      const sample = this.engine.pack.samples[inst.sample];
      const buffer = this.engine.buffers.get(inst.sample);
      if (!sample || !buffer) return;
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      if (!inst.fixed) s.playbackRate.value = Math.pow(2, (key - sample.pitch) / 12);
      if (sample.loop) {
        s.loop = true;
        s.loopStart = sample.loop[0] / buffer.sampleRate;
        s.loopEnd = sample.loop[1] / buffer.sampleRate;
      }
      detuneParam = s.detune;
      src = s;
    } else if (inst.kind === 'psg') {
      const s = ctx.createBufferSource();
      s.buffer = this.engine.psgBuffer(inst);
      s.loop = true;
      s.playbackRate.value = Math.pow(2, (key - 60) / 12);
      detuneParam = s.detune;
      src = s;
    } else return;
    if (detuneParam) detuneParam.value = (ch.bend / 8192) * ch.bendRange * 100 + (this.opts.pitch / 256) * 100;

    const { pts } = adsrPoints(inst.adsr);
    const gain = ctx.createGain();
    const velGain = vel / 127;
    gain.gain.setValueAtTime(pts[0][1] * velGain, start);
    for (let i = 1; i < pts.length; i++) gain.gain.linearRampToValueAtTime(pts[i][1] * velGain, start + pts[i][0]);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, (ch.pan + panOffset - 64) / 64));
    src.connect(gain).connect(pan).connect(this.channelGain(ch, t));
    src.start(start);
    const last = pts[pts.length - 1];
    if (last[1] === 0) src.stop(start + last[0] + 0.01);
    else if (inst.kind === 'pcm' && !this.engine.pack.samples[inst.sample]?.loop) {
      const buf = this.engine.buffers.get(inst.sample)!;
      src.stop(start + buf.duration / (src as AudioBufferSourceNode).playbackRate.value + 0.01);
    }
    const voice: Voice = { ch: chn, key: noteKey, start, src, gain, pts: pts.map(([a, b]) => [a, b * velGain]), release: inst.adsr[5], detuneParam, released: false };
    ch.voices.push(voice);
    src.onended = () => {
      const i = ch.voices.indexOf(voice);
      if (i >= 0) ch.voices.splice(i, 1);
    };
  }

  private releaseVoice(v: Voice, t: number, force = false) {
    const ctx = this.engine.ctx!;
    v.released = true;
    const at = Math.max(t, ctx.currentTime);
    const level = levelAt(v.pts, at - v.start);
    const rel = force && v.release === 0 ? 6 * E : v.release;
    const dur = rel > 0 ? Math.ceil((level * 127 * E) / rel) * FRAME : Infinity;
    v.gain.gain.cancelScheduledValues(at);
    v.gain.gain.setValueAtTime(level, at);
    if (dur === Infinity) return;
    v.gain.gain.linearRampToValueAtTime(0, at + dur);
    try {
      v.src.stop(at + dur + 0.01);
    } catch {
      /* already stopped */
    }
  }

  setVolume(volume: number, at: number, rampSeconds = 0) {
    if (!this.out || !this.engine.ctx) return;
    const songVol = (this.engine.pack.songs[this.name]?.volume ?? 127) / 127;
    const g = this.out.gain;
    const t = Math.max(at, this.engine.ctx.currentTime);
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (rampSeconds > 0) g.linearRampToValueAtTime(songVol * (volume / 256), t + rampSeconds);
    else g.setValueAtTime(songVol * (volume / 256), t);
  }

  stop(at?: number) {
    if (this.stopped) return;
    this.stopped = true;
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const t = Math.max(at ?? ctx.currentTime, ctx.currentTime);
    for (const ch of this.channels) for (const v of ch.voices) this.releaseVoice(v, t, true);
    this.out?.gain.setValueAtTime(this.out.gain.value, t);
    this.out?.gain.linearRampToValueAtTime(0, t + 0.1);
  }
}

export class SoundEngine {
  ctx: AudioContext | null;
  master: GainNode | null = null;
  pack: SoundPack = { songs: {}, banks: {}, instruments: {}, samples: {} };
  readonly midis = new Map<string, MidiFile>();
  readonly buffers = new Map<string, AudioBuffer>();
  private readonly psgCache = new Map<string, AudioBuffer>();
  private players: SongPlayer[] = [];
  private music: SongPlayer | null = null;
  private bufferPlayers: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
  private timer: number | null = null;
  readonly log: SoundLogEntry[] = [];
  lookahead = 0.3;

  constructor(ctx: AudioContext | null) {
    this.ctx = ctx;
    if (ctx) {
      this.master = ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(ctx.destination);
    }
  }

  async loadPack(base: string, pack: SoundPack) {
    this.pack = {
      songs: { ...this.pack.songs, ...pack.songs },
      banks: { ...this.pack.banks, ...pack.banks },
      instruments: { ...this.pack.instruments, ...pack.instruments },
      samples: { ...this.pack.samples, ...pack.samples },
    };
    const jobs: Promise<void>[] = [];
    for (const [name, song] of Object.entries(pack.songs)) {
      if (this.midis.has(name)) continue;
      jobs.push(
        fetch(`${base}midi/${song.midi}.mid`)
          .then((r) => r.arrayBuffer())
          .then((b) => void this.midis.set(name, parseMidi(b))),
      );
    }
    if (this.ctx) {
      for (const [id, s] of Object.entries(pack.samples)) {
        if (this.buffers.has(id)) continue;
        jobs.push(
          fetch(`${base}samples/${s.file}`)
            .then((r) => r.arrayBuffer())
            .then((b) => this.ctx!.decodeAudioData(b))
            .then((buf) => void this.buffers.set(id, buf))
            .catch(() => undefined),
        );
      }
    }
    await Promise.all(jobs);
  }

  instrument(name: string | null | undefined): Instrument | null {
    return name ? this.pack.instruments[name] ?? null : null;
  }

  // Square / wave / noise buffers at C4 (key 60), looped.
  psgBuffer(inst: Extract<Instrument, { kind: 'psg' }>): AudioBuffer {
    const key = `${inst.channel}:${inst.duty}:${inst.noise}:${inst.wave?.join(',') ?? ''}`;
    let buf = this.psgCache.get(key);
    if (buf) return buf;
    const ctx = this.ctx!;
    const c4 = 261.6256;
    if (inst.channel.includes('NOISE')) {
      const sr = 44100;
      buf = ctx.createBuffer(1, sr, sr);
      const d = buf.getChannelData(0);
      const short = inst.noise.endsWith('7');
      let lfsr = 0x7fff;
      for (let i = 0; i < d.length; i++) {
        const bit = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        if (short) lfsr = (lfsr & ~0x40) | (bit << 6);
        d[i] = (lfsr & 1 ? 1 : -1) * 0.5;
      }
    } else {
      const n = 32;
      const reps = 64;
      buf = ctx.createBuffer(1, n * reps, Math.round(c4 * n));
      const d = buf.getChannelData(0);
      const wave: number[] = [];
      if (inst.wave) {
        for (const word of inst.wave) for (let b = 0; b < 4; b++) {
          const byte = (word >>> (b * 8)) & 0xff;
          wave.push(byte >> 4, byte & 15);
        }
      }
      const dutyFrac = [0.125, 0.25, 0.5, 0.75][inst.duty & 3];
      for (let i = 0; i < d.length; i++) {
        const ph = i % n;
        d[i] = inst.wave && wave.length === 32 ? (wave[ph] / 7.5 - 1) * 0.5 : (ph / n < dutyFrac ? 1 : -1) * 0.35;
      }
    }
    this.psgCache.set(key, buf);
    return buf;
  }

  now() {
    return this.ctx?.currentTime ?? 0;
  }

  private ensureTimer() {
    if (this.timer !== null || !this.ctx) return;
    this.timer = window.setInterval(() => this.pump(), 25);
  }

  pump() {
    if (!this.ctx) return;
    const until = this.ctx.currentTime + this.lookahead;
    this.players = this.players.filter((p) => !p.stopped && p.finishedAt > this.ctx!.currentTime);
    for (const p of this.players) p.schedule(until);
  }

  play(name: string, opts: PlayOptions = {}): SongPlayer | null {
    const song = this.pack.songs[name];
    const full: Required<PlayOptions> = { at: opts.at ?? this.now(), volume: opts.volume ?? 256, pitch: opts.pitch ?? 0, speed: opts.speed ?? 1, loop: opts.loop ?? true };
    this.log.push({ name, at: full.at, opts });
    if (this.log.length > 2000) this.log.splice(0, 1000);
    if (!song || !this.midis.has(name)) {
      if (!song) console.warn('unknown sound', name);
      return null;
    }
    const p = new SongPlayer(this, name, full, this.pack.banks[song.bank] ?? [], song.volume);
    if (!this.ctx) return p;
    this.players.push(p);
    p.schedule(this.ctx.currentTime + this.lookahead);
    this.ensureTimer();
    return p;
  }

  playMusic(name: string, opts: PlayOptions = {}) {
    this.music?.stop(opts.at);
    this.music = this.play(name, opts);
    return this.music;
  }

  get currentMusic() {
    return this.music;
  }

  stopMusic(at?: number) {
    this.music?.stop(at);
    this.music = null;
  }

  stopByName(name: string, at?: number) {
    for (const p of this.players) if (p.name === name) p.stop(at);
  }

  // Plain audio file playback (imported songs), on the same clock and output as the MIDI players.
  playBuffer(buffer: AudioBuffer, at = this.now(), volume = 1) {
    this.log.push({ name: '<audio buffer>', at, opts: {} });
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buffer;
    gain.gain.value = volume;
    src.connect(gain).connect(this.master!);
    src.start(Math.max(at, this.ctx.currentTime), Math.max(0, this.ctx.currentTime - at));
    const entry = { src, gain };
    this.bufferPlayers.push(entry);
    src.onended = () => (this.bufferPlayers = this.bufferPlayers.filter((b) => b !== entry));
  }

  stopAll(at?: number) {
    for (const p of this.players) p.stop(at);
    this.music = null;
    const t = this.ctx ? Math.max(at ?? this.ctx.currentTime, this.ctx.currentTime) : 0;
    for (const b of this.bufferPlayers) {
      b.gain.gain.setValueAtTime(b.gain.gain.value, t);
      b.gain.gain.linearRampToValueAtTime(0, t + 0.05);
      try {
        b.src.stop(t + 0.06);
      } catch {
        /* already stopped */
      }
    }
    this.bufferPlayers = [];
  }
}
