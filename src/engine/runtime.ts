// Runtime: glues the beatscript sequencer, cue judge, sprite handler, PPU and sound engine together,
// and steps everything at a fixed 60 Hz on the audio clock.
//
// Timing model:
//   - logic time runs slightly ahead of AudioContext.currentTime (`lead`), so every sound a frame
//     triggers can be scheduled exactly at its script time;
//   - key presses are converted to the audio time the player was *hearing* when they pressed
//     (AudioContext.getOutputTimestamp) and judged against cue targets in that time base;
//   - a cue is only declared missed once the heard time has passed its late window.
import type { GameData } from '../gba/assets';
import { Ppu } from '../gba/ppu';
import { SpriteHandler } from '../gba/sprites';
import { SoundEngine } from '../audio/sound';
import { Gameplay, type CueDef } from './gameplay';
import { parseCriteria, type ResultSummary } from './results';
import { Sequencer, type Op } from './sequencer';

export interface GameModule {
  // The decomp engine symbol this module implements, e.g. "karate_man_engine".
  engine: string;
  start(rt: Runtime, version: number): void;
  stop?(): void;
  update(): void; // once per frame, after cues
  engineEvent(id: number, param: string | number): void;
  commonEvent(id: number, arg: string | number): void;
  cueIndex: (CueDef<any> | null)[];
  inputEvent(): void; // irrelevant (unmatched) press
}

export interface RuntimeUi {
  textbox(text: string | null): void; // engine text boxes (tutorials)
  caption(text: string | null): void; // print_text_f / display_text
  skipAvailable(available: boolean): void;
  finished(summary: ResultSummary): void;
}

export interface RuntimeOptions {
  manualClock?: boolean; // tests: no audio, step() driven by hand
  autoplay?: number | null; // press every cue at this offset (frames)
}

function scriptName(sound: string | number) {
  return String(sound).replace(/^s_/, '').replace(/_seqData$/, '');
}

export class Runtime {
  readonly ppu = new Ppu();
  readonly sprites = new SpriteHandler();
  readonly sound: SoundEngine;
  readonly gameplay: Gameplay;
  sequencer!: Sequencer;
  data!: GameData;
  game: GameModule | null = null;
  readonly modules = new Map<string, GameModule>();

  frame = 0;
  t0 = 0; // audio time of frame 0
  now = 0; // logic time of the current frame
  lead = 0.03;
  inputOffsetMs = 0; // calibration: added to heard time
  autoplay: number | null;
  readonly manual: boolean;

  // A pressed this frame (raw, before judgement) — engines poll this for tutorial "press A" waits.
  aPressed = false;
  private pressQueue: number[] = [];
  private engineParam: string | number = 0;
  private musicVolume = 256;
  sfxTempo = 0;
  skipScene: string | null = null;
  private fade: { from: number; to: number; start: number; frames: number; color: number } | null = null;
  private fadeInFrames = 0;
  private autoplayed = new Set<number>();
  finished = false;
  private stoppedAt = -1;

  constructor(
    private readonly ui: RuntimeUi,
    opts: RuntimeOptions = {},
  ) {
    this.manual = !!opts.manualClock;
    this.autoplay = opts.autoplay ?? null;
    const ctx = this.manual ? null : new AudioContext({ latencyHint: 'interactive' });
    this.sound = new SoundEngine(ctx);
    this.gameplay = new Gameplay({
      playSound: (name, at) => this.playSound(name, at, true),
      inputEvent: () => this.game?.inputEvent(),
      enableLoops: () => (this.sequencer.loopsEnabled = true),
    });
  }

  register(m: GameModule) {
    this.modules.set(m.engine, m);
  }

  async load(data: GameData) {
    this.data = data;
    this.ppu.setRasterCels(data.skin?.cels);
    await this.sound.loadPack(data.base, data.sound);
  }

  get tempo() {
    return this.sequencer.tempo;
  }

  ticksToFrames(ticks: number) {
    return (ticks / 24) * (60 / this.tempo) * 60;
  }

  // Imported song for `play_audio` ops (see src/autochart/level.ts).
  customAudio: AudioBuffer | null = null;

  // Script text by label; `translations` (per game, English) wins over the Japanese original.
  translations: Record<string, string> = {};
  text(label: string | number) {
    return this.translations[String(label)] ?? this.data.text[String(label)] ?? '';
  }

  // ---- clock ----
  audioNow() {
    return this.manual ? this.t0 + this.frame / 60 : this.sound.ctx!.currentTime;
  }

  heardNow() {
    if (this.manual) return this.now;
    const ctx = this.sound.ctx!;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || 0) - ctx.baseLatency;
  }

  // Convert a keydown timestamp (performance.now() domain) to heard audio time.
  perfToHeard(perfMs: number) {
    if (this.manual) return this.now;
    const ctx = this.sound.ctx!;
    const ts = ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
    }
    return ctx.currentTime - (ctx.outputLatency || 0) - ctx.baseLatency - (performance.now() - perfMs) / 1000;
  }

  // ---- scene control ----
  async startScene(scene: string) {
    const script = this.data.level.scenes[scene] ?? scene;
    if (this.sound.ctx?.state === 'suspended') await this.sound.ctx.resume();
    this.sound.stopAll();
    this.game?.stop?.();
    this.game = null;
    this.sprites.clear();
    this.ppu.layers.forEach((l) => (l.visible = false));
    this.gameplay.reset();
    this.gameplay.inputsEnabled = true;
    this.skipScene = null;
    this.ui.skipAvailable(false);
    this.ui.textbox(null);
    this.ui.caption(null);
    this.finished = false;
    this.stoppedAt = -1;
    this.autoplayed.clear();
    this.fade = null;
    this.ppu.fade.amount = 0;
    this.musicVolume = 256;
    this.sfxTempo = 0;
    this.frame = 0;
    this.t0 = this.manual ? 0 : this.sound.ctx!.currentTime + 0.1;
    this.now = this.t0;
    this.sequencer = new Sequencer(this.data.level, { op: (op, t) => this.op(op, t) });
    this.sequencer.start(script, this.t0);
  }

  skipTutorial() {
    if (!this.skipScene) return;
    const s = this.skipScene;
    void this.startScene(s);
  }

  press(perfMs?: number) {
    const heard = perfMs === undefined ? this.heardNow() : this.perfToHeard(perfMs);
    this.pressQueue.push(heard + this.inputOffsetMs / 1000);
  }

  // Tests: press at an exact heard time.
  pressAt(heardTime: number) {
    this.pressQueue.push(heardTime);
  }

  // ---- frame loop ----
  // Advance logic to the current audio time (browser) — returns frames stepped.
  tick() {
    if (this.manual || !this.sequencer) return 0;
    const target = Math.floor((this.sound.ctx!.currentTime + this.lead - this.t0) * 60);
    let n = 0;
    while (this.frame < target && n < 600) {
      this.step();
      n++;
    }
    return n;
  }

  step() {
    this.frame++;
    this.now = this.t0 + this.frame / 60;
    const heardNow = this.heardNow();

    this.aPressed = false;
    if (this.pressQueue.length) {
      const presses = this.pressQueue.splice(0).sort((a, b) => a - b);
      for (const h of presses) {
        this.aPressed = true;
        this.gameplay.press(h, this.now);
      }
    }
    if (this.autoplay !== null) {
      for (const cue of this.gameplay.cues) {
        const t = cue.targetTime + this.autoplay / 60;
        if (!cue.judged && !cue.expired && !this.autoplayed.has(cue.id) && t <= this.now) {
          this.autoplayed.add(cue.id);
          this.aPressed = true;
          this.gameplay.press(t, this.now);
        }
      }
    }

    this.sequencer.run(this.now);
    this.gameplay.update(this.now, this.manual ? this.now : heardNow);
    this.game?.update();
    this.sprites.update();
    this.ppu.stepPaletteFades();
    this.updateFade();

    if (!this.sequencer.running && !this.finished) {
      if (this.stoppedAt < 0) this.stoppedAt = this.frame;
      if (this.frame - this.stoppedAt > 30) {
        this.finished = true;
        this.ui.finished(this.gameplay.results.evaluate((l) => this.text(l)));
      }
    }
  }

  render(ctx2d: CanvasRenderingContext2D) {
    ctx2d.putImageData(this.ppu.render(this.sprites.drawList()), 0, 0);
  }

  private updateFade() {
    if (this.fadeInFrames > 0 && this.fade === null) {
      this.fade = { from: 1, to: 0, start: this.frame, frames: this.fadeInFrames, color: 0 };
      this.fadeInFrames = 0;
    }
    if (!this.fade) return;
    const k = Math.min(1, (this.frame - this.fade.start) / Math.max(1, this.fade.frames));
    this.ppu.fade.amount = this.fade.from + (this.fade.to - this.fade.from) * k;
    this.ppu.fade.color = this.fade.color;
    if (k >= 1 && this.fade.to === 0) this.fade = null;
  }

  // ---- sound helpers for engines ----
  // Engine sounds. `aligned`: stretch the sequence to the script tempo (gameplay_align_soundplayer_to_tempo).
  playSound(name: string, at = this.now, aligned = false, opts: { volume?: number; pitch?: number } = {}) {
    const speed = aligned && this.sfxTempo ? this.tempo / this.sfxTempo : 1;
    return this.sound.play(scriptName(name), { at, speed, loop: false, ...opts });
  }

  stopSound(name: string) {
    this.sound.stopByName(scriptName(name), this.now);
  }

  // ---- beatscript op dispatch ----
  private op(op: Op, t: number): boolean {
    const [name, a, b, c] = op;
    switch (name) {
      case 'play_music':
        this.sound.playMusic(scriptName(a), { at: t, volume: this.musicVolume });
        return true;
      case 'play_sfx':
        this.sound.play(scriptName(a), { at: t, loop: false });
        return true;
      case 'play_audio':
        if (this.customAudio) this.sound.playBuffer(this.customAudio, t, this.musicVolume / 256);
        return true;
      case 'play_sfx_vol':
        this.sound.play(scriptName(a), { at: t, volume: Number(b), loop: false });
        return true;
      case 'play_sfx_vol_pitch':
        this.sound.play(scriptName(c), { at: t, volume: Number(a), pitch: Number(b), loop: false });
        return true;
      case 'play_sfx_synced':
      case 'play_sfx_synced_pitch': {
        const packed = Number(c ?? 0);
        const volume = name === 'play_sfx_synced' ? Number(c) : packed & 0xffff;
        const pitch = name === 'play_sfx_synced' ? 0 : packed >> 16;
        this.sound.play(scriptName(a), { at: t, speed: this.tempo / Number(b), volume, pitch, loop: false });
        return true;
      }
      case 'fade_music_out': {
        const secs = this.sequencer.ticksToSeconds(Number(a));
        this.sound.currentMusic?.setVolume(0, t, secs);
        const m = this.sound.currentMusic;
        if (m) setTimeoutAudio(this, t + secs, () => m.stop());
        return true;
      }
      case 'mod_music_volume': {
        this.musicVolume = Number(a);
        this.sound.currentMusic?.setVolume(this.musicVolume, t, this.sequencer.ticksToSeconds(Number(b)));
        return true;
      }
      case 'fade_screen_out':
        this.fade = { from: this.ppu.fade.amount, to: 1, start: this.frame, frames: this.ticksToFrames(Number(a)), color: Number(b) === 1 ? 0xffffff : 0 };
        return true;
      case 'fade_screen_in':
        this.fade = { from: 1, to: 0, start: this.frame, frames: this.ticksToFrames(Number(a)), color: Number(b) === 1 ? 0xffffff : 0 };
        return true;
      case 'run':
        return this.run(String(a), b ?? 0, t);
      case 'run2':
        return this.run2(String(a), b ?? 0, c ?? 0, t);
    }
    return false;
  }

  private run(fn: string, arg: string | number, t: number): boolean {
    const g = this.gameplay;
    switch (fn) {
      case 'set_beatscript_tempo':
        return true; // tempo already applied by the sequencer
      case 'scene_set_music_volume':
        this.musicVolume = Number(arg);
        this.sound.currentMusic?.setVolume(this.musicVolume, t);
        return true;
      case 'scene_stop_music':
        this.sound.stopMusic(t);
        return true;
      case 'stop_all_soundplayers':
        this.sound.stopAll(t);
        return true;
      case 'results_set_header':
        g.results.header = this.text(arg);
        return true;
      case 'results_import_marking_criteria':
        g.results.criteria = parseCriteria(this.data.level.structs, String(arg));
        return true;
      case 'results_enable_input_tracking':
        g.results.tracking = !!Number(arg);
        return true;
      case 'gameplay_set_marking_criteria':
        g.markingCriteria = Number(arg);
        return true;
      case 'gameplay_set_mercy_count':
        g.forgivableMisses = Number(arg);
        return true;
      case 'gameplay_enable_mercy':
        g.mercyEnabled = !!Number(arg);
        return true;
      case 'gameplay_assess_irrelevant_inputs':
        g.assessIrrelevantInputs = !!Number(arg);
        return true;
      case 'gameplay_inputs_enabled':
        g.inputsEnabled = !!Number(arg);
        return true;
      case 'gameplay_set_engine_event_param':
        this.engineParam = arg;
        return true;
      case 'gameplay_spawn_cue': {
        const def = this.game?.cueIndex[Number(arg)];
        if (def) g.spawn(def, t, this.tempo);
        return true;
      }
      case 'gameplay_set_sound_tempo':
        this.sfxTempo = Number(arg);
        return true;
      case 'gameplay_set_screen_fade_in_time':
        this.fadeInFrames = this.ticksToFrames(Number(arg));
        return true;
      case 'gameplay_start_perfect_campaign':
      case 'gameplay_check_for_perfect':
      case 'gameplay_set_reverb':
      case 'pause_menu_enabled':
      case 'gameplay_display_skip_icon':
        return true;
      case 'gameplay_set_tutorial':
        this.setSkip(arg);
        return true;
    }
    return fn.startsWith('func_'); // unnamed decomp helpers (prologue fades etc.) — safe to ignore
  }

  private run2(fn: string, a: string | number, b: string | number, _t: number): boolean {
    switch (fn) {
      case 'gameplay_set_current_engine': {
        const m = this.modules.get(String(b)) ?? this.modules.get('*prologue*');
        this.game?.stop?.();
        this.sprites.clear();
        this.ppu.layers.forEach((l) => (l.visible = false));
        this.game = m ?? null;
        this.game?.start(this, Number(a));
        return true;
      }
      case 'gameplay_run_engine_event':
        this.game?.engineEvent(Number(a), this.engineParam);
        return true;
      case 'gameplay_run_common_event':
        if (Number(a) === 2) this.setSkip(b);
        this.game?.commonEvent(Number(a), b);
        return true;
    }
    return false;
  }

  private setSkip(scene: string | number) {
    this.skipScene = scene && scene !== 'NULL' && scene !== 0 ? String(scene) : null;
    this.ui.skipAvailable(!!this.skipScene);
  }

  // UI passthroughs for engines
  textbox(text: string | null) {
    this.ui.textbox(text);
  }

  caption(text: string | null) {
    this.ui.caption(text);
  }

  setScriptPaused(paused: boolean) {
    this.sequencer.setPaused(paused, this.now);
  }
}

// Run a callback once logic time passes `at` (checked each frame).
function setTimeoutAudio(rt: Runtime, at: number, fn: () => void) {
  const check = () => {
    if (rt.now >= at) fn();
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
