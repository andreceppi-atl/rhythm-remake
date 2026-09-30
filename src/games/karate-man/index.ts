// Karate Man — port of the decomp's src/engines/karate_man.c + games/karate_man/engine.c.
// Every constant lives in tuning.ts (defaults = the GBA values); physics runs in the GBA's 24.8 fixed
// point (0x100 = 1 px) so the defaults reproduce the original exactly.
import type { Cue, CueDef } from '../../engine/gameplay';
import { RESULT_BARELY } from '../../engine/results';
import type { GameModule, Runtime } from '../../engine/runtime';
import type { Animation, Sprite } from '../../gba/sprites';
import { PLAYBACK_DELETE } from '../../gba/sprites';
import { KARATE_DEFAULTS, type KarateTuning } from './tuning';

const VER_0 = 0;
const VER_FACES = 1;
const VER_SERIOUS = 2;

type ObjectKind = keyof KarateTuning['objects'];
// Decomp object type order (KarateObjectsEnum) and cue index (karate_cue_index).
const OBJECT_ORDER: ObjectKind[] = ['pot', 'rock', 'ball', 'bomb', 'bulb'];

const s8 = (v: number) => ((v & 0xff) << 24) >> 24;
const fixedToInt = (v: number) => v >> 8;
const fx = (px: number) => Math.round(px * 256); // px/frame -> 24.8

interface KarateCueInfo {
  isHit: boolean;
  miss: boolean;
  kind: ObjectKind;
  sprite: Sprite;
  shadow: Sprite;
  x: number; // unkC  (24.8)
  y: number; // unk10 (24.8)
  landY: number; // unk14 (int)
  vx: number; // unk18
  vy: number; // unk1C
  ay: number; // unk24 (gravity)
  dist: number; // unk28 progress, 0x100 at the ideal hit
  scale: number; // unk2A affine parameter (0x100 = 1.0; larger = smaller on screen)
  angle: number; // unk2C (s8)
  spin: number; // unk2D
  zBump: number; // unk2E
}

interface Joe {
  sprite: Sprite;
  isNotBeat: boolean;
  barely: number;
  miss: number;
  smirk: number;
  happy: number;
}

export class KarateMan implements GameModule {
  readonly engine = 'karate_man_engine';
  private rt!: Runtime;
  private anims!: Record<string, Animation>;
  private version = VER_0;
  private joe!: Joe;
  private flowSprite!: Sprite;
  private flowLevel = 0;
  private flowEnabled = true;
  private bg = 0;
  private bgPalIndex: number[] = [];
  private cueTextSprite!: Sprite;
  private textButtonSprite!: Sprite;
  private tutorialText!: Sprite;
  private tutorialCounter = 0;
  private awaitingInput = false;
  private seriousModeStarted = false;
  private seriousModeStopped = false;
  private useTheFace = false;
  private objects = new Set<Cue<KarateCueInfo>>();

  cueIndex: (CueDef<KarateCueInfo> | null)[] = [];

  constructor(readonly t: KarateTuning = KARATE_DEFAULTS) {
    const w = t.timing.windows;
    const cue = (kind: ObjectKind, win: { hit: number[]; barely: number[] }): CueDef<KarateCueInfo> => ({
      duration: t.timing.cueDurationTicks,
      hitWindow: win.hit as [number, number],
      barelyWindow: win.barely as [number, number],
      spawnParam: OBJECT_ORDER.indexOf(kind),
      sfxSpawn: t.sounds.toss,
      sfxHit: t.objects[kind].hitSfx,
      sfxBarely: t.sounds.barely,
      sfxMiss: null,
      spawn: (c) => this.cueSpawn(c, kind),
      update: (c, running, duration) => this.cueUpdate(c, running, duration),
      hit: (c) => this.cueHit(c),
      barely: (c) => this.cueBarely(c),
      miss: () => (this.rt.sequencer.loopsEnabled = true),
      despawn: (c) => this.cueDespawn(c),
    });
    this.cueIndex = [
      /* 0x00 */ cue('pot', w.normal),
      /* 0x01 */ cue('ball', w.normal),
      /* 0x02 */ cue('pot', w.strict),
      /* 0x03 */ null,
      /* 0x04 */ cue('rock', w.normal),
      /* 0x05 */ cue('bomb', w.normal),
      /* 0x06 */ null,
      /* 0x07 */ null,
      /* 0x08 */ cue('bulb', w.normal),
    ];
  }

  private anim(role: keyof KarateTuning['anims']) {
    const name = `anim_karate_${this.t.anims[role]}`;
    const a = this.anims[name];
    if (!a) throw new Error(`missing ${name}`);
    return a;
  }

  private ticks(n: number) {
    return Math.round(this.rt.ticksToFrames(n));
  }

  // ---- engine start (karate_engine_start + graphics table) ----
  start(rt: Runtime, version: number) {
    this.rt = rt;
    this.anims = rt.data.anims;
    this.version = version;
    this.objects.clear();
    const { ppu, data } = rt;
    const L = this.t.layout;
    const pal = data.palettes.karate_man_pal;
    ppu.loadBgTiles(data.bins['karate_man_bg_tiles.4bpp'], 0);
    ppu.loadBgTiles(data.bins['karate_man_bg_map.tilemap'], 0xe800);
    ppu.loadObjTiles(data.bins['karate_man_obj.4bpp'], 0);
    ppu.loadPalettes('bg', pal, 0, 10);
    ppu.loadPalettes('bg', pal, 12, 4);
    ppu.loadPalettes('obj', pal, 0, 10);
    this.applyColorOverrides();
    Object.assign(ppu.layers[0], { visible: false, charBase: 0x8000, mapBase: 0xe000, priority: 1, x: 0, y: 0 });
    Object.assign(ppu.layers[1], { visible: true, charBase: 0, mapBase: 0xe800, priority: 2, x: 0, y: 0 });
    Object.assign(rt.translations, this.t.text);

    this.joe = {
      sprite: rt.sprites.create(this.anim('stand'), 0, L.joe.x, L.joe.y, 0x4800, 1, 0, 0),
      isNotBeat: false,
      barely: 0,
      miss: 0,
      smirk: 0,
      happy: 0,
    };
    if (version === VER_SERIOUS) this.joe.sprite.basePalette = 1;
    this.useTheFace = false;
    this.initFlow();
    this.seriousModeStarted = false;
    this.seriousModeStopped = false;

    this.cueTextSprite = rt.sprites.create(this.anim('cueWarning'), 0, L.cueText.x, L.cueText.y, 0, 0, 0, 0x8000);
    this.awaitingInput = false;
    this.textButtonSprite = rt.sprites.create(this.anim('tutorialButton'), 0, L.tutorialButton.x, L.tutorialButton.y, 0x4f00, 1, 0, 0x8000);
    this.tutorialText = rt.sprites.create(this.anim('tutorialCounter'), 0, L.tutorialCounter.x, L.tutorialCounter.y, 0, 0, 0, 0x8000);
    this.tutorialCounter = 0;
    rt.gameplay.inputsEnabled = true;
    this.updateBgPalette();
  }

  private applyColorOverrides() {
    const apply = (dst: Uint32Array, map: Record<string, string>) => {
      for (const [key, hex] of Object.entries(map)) {
        const [p, i] = key.split(':').map(Number);
        if (p >= 0 && p < 16 && i >= 0 && i < 16) dst[p * 16 + i] = parseInt(hex.replace('#', ''), 16);
      }
    };
    apply(this.rt.ppu.bgPal, this.t.colors.bg);
    apply(this.rt.ppu.objPal, this.t.colors.obj);
  }

  stop() {
    this.rt.textbox(null);
  }

  // ---- engine events ----
  engineEvent(id: number, param: string | number) {
    switch (id) {
      case 0x00: // reset BG face (faces version only)
        return;
      case 0x01:
        if (this.version === VER_0) this.seriousModeStarted = true;
        return;
      case 0x02:
        if (this.version === VER_SERIOUS) this.seriousModeStopped = true;
        return;
      case 0x03: // print textbox
        this.rt.textbox(param && param !== 0 ? this.rt.text(param) : null);
        return;
      case 0x04: // wait at textbox for A
        this.rt.sprites.setAnimCel(this.textButtonSprite, 0);
        this.textButtonSprite.visible = true;
        this.rt.gameplay.inputsEnabled = false;
        this.rt.setScriptPaused(true);
        this.awaitingInput = true;
        return;
      case 0x05:
        this.flowEnabled = this.t.flow.enabled && !!Number(param);
        this.flowSprite.visible = this.flowEnabled;
        return;
      case 0x06: {
        const n = Number(param);
        this.tutorialCounter = n;
        this.tutorialText.visible = n > 0;
        if (n) this.rt.sprites.setAnimCel(this.tutorialText, n);
        return;
      }
      case 0x07:
        this.rt.sequencer.loopsEnabled = this.tutorialCounter !== 0;
        return;
      case 0x08:
        this.useTheFace = !!Number(param);
        return;
    }
  }

  commonEvent(id: number, arg: string | number) {
    if (id === 0) this.beatAnimation();
    else if (id === 1) {
      const n = Number(arg);
      this.cueTextSprite.visible = n !== 0;
      if (n) this.rt.sprites.setAnimCel(this.cueTextSprite, n - 1);
    }
  }

  // ---- per-frame update (karate_engine_update) ----
  update() {
    if (this.awaitingInput && this.rt.aPressed) {
      this.textButtonSprite.visible = false;
      this.rt.gameplay.inputsEnabled = true;
      this.rt.setScriptPaused(false);
      this.awaitingInput = false;
    }
    const j = this.joe;
    if (j.barely) j.barely--;
    if (j.miss) j.miss--;
    if (j.smirk) j.smirk--;
    if (j.happy) j.happy--;
  }

  private get isHighFlow() {
    return this.flowLevel >= this.t.flow.highAt;
  }

  // Irrelevant press: empty punch.
  inputEvent() {
    const j = this.joe;
    j.isNotBeat = true;
    this.rt.sprites.setAnim(j.sprite, this.anim(this.isHighFlow ? 'punchHigh' : 'punchLow'), 0, 1, 0x7f, 0);
    this.rt.playSound(this.t.sounds.emptyPunch);
  }

  // karate_common_beat_animation
  private beatAnimation() {
    const j = this.joe;
    const sprites = this.rt.sprites;
    this.updateBgPalette();
    if (j.isNotBeat && j.sprite.cel < j.sprite.anim.length - 4) return;
    j.isNotBeat = false;
    sprites.setAnim(j.sprite, this.anim('beat'), 0, 1, 0x7f, 0);
    if (j.smirk) sprites.setAnim(j.sprite, this.anim('smirk'), 0, 1, 0x7f, 0);
    if (j.barely) sprites.setAnim(j.sprite, this.anim('barely'), 0, 1, 0x7f, 0);
    if (j.happy) sprites.setAnim(j.sprite, this.anim('happy'), 0, 1, 0x7f, 0);
    if (j.miss) {
      sprites.setAnim(j.sprite, this.anim('miss'), 0, 1, 0x7f, 0);
      this.rt.playSound(this.t.sounds.missVoice);
    }
  }

  // ---- flow meter ----
  private initFlow() {
    const L = this.t.layout;
    this.flowLevel = 0;
    this.flowSprite = this.rt.sprites.create(this.anim('flowMeter'), 0, L.flowMeter.x, L.flowMeter.y, 0x47f6, 0, 0, 0);
    this.flowEnabled = this.t.flow.enabled;
    if (this.version === VER_SERIOUS || !this.flowEnabled) {
      this.flowSprite.visible = false;
      this.flowEnabled = false;
    }
    this.bgPalIndex = this.t.flow.backgroundLow;
  }

  private setFlowCel() {
    const cels = this.flowSprite.anim.length;
    this.rt.sprites.setAnimCel(this.flowSprite, Math.min(this.flowLevel, cels - 1));
  }

  private resetFlow() {
    if (this.isHighFlow) this.rt.playSound(this.t.sounds.flowReset);
    this.flowLevel = 0;
    this.setFlowCel();
    this.bg = 0;
    this.bgPalIndex = this.t.flow.backgroundLow;
    this.updateBgPalette();
  }

  private incrementFlow() {
    if (!this.flowEnabled || this.flowLevel >= this.t.flow.max) return;
    this.flowLevel++;
    this.setFlowCel();
    if (this.flowLevel === this.t.flow.highAt) {
      this.bg = 0;
      this.bgPalIndex = this.t.flow.backgroundHigh;
      this.updateBgPalette();
      this.rt.playSound(this.t.sounds.flowUp);
    }
  }

  private decrementFlow() {
    if (!this.flowEnabled || !this.flowLevel) return;
    this.flowLevel--;
    this.setFlowCel();
    if (this.flowLevel === this.t.flow.highAt - 1) {
      this.bg = 0;
      this.bgPalIndex = this.t.flow.backgroundLow;
      this.updateBgPalette();
      this.rt.playSound(this.t.sounds.flowDown);
    }
  }

  // Copies colours 0-3 of the next palette in the cycle into BG palette 4, once per beat.
  private updateBgPalette() {
    if (this.version === VER_SERIOUS || !this.bgPalIndex.length) return;
    if (this.bg >= this.bgPalIndex.length) this.bg = 0;
    const id = this.bgPalIndex[this.bg++];
    const pal = this.rt.ppu.bgPal;
    for (let i = 0; i < 4; i++) pal[4 * 16 + i] = pal[id * 16 + i];
  }

  // ---- cues ----
  private cueSpawn(cue: Cue<KarateCueInfo>, kind: ObjectKind): KarateCueInfo {
    const sprites = this.rt.sprites;
    const L = this.t.layout;
    const info: KarateCueInfo = {
      isHit: false,
      miss: false,
      kind,
      sprite: sprites.create(this.anim('object'), 0, L.objectStart.x, L.objectStart.y, 0x4800, 0, 0, 0),
      shadow: sprites.create(this.anim('shadow'), 0, L.objectStart.x, L.shadowStartY, 0x4a00, 0, 0, 0),
      x: 0, y: 0, landY: 0, vx: 0, vy: 0, ay: 0, dist: 0, scale: 0x100, angle: 0, spin: 0, zBump: 0,
    };
    info.sprite.affine = { scale: 1, angle: 0 };
    info.shadow.affine = { scale: 1, angle: 0 };
    sprites.setAnim(info.sprite, this.anim('object'), this.t.objects[kind].cel, 0, 0, 0);
    // karate_cue_increment_z_for_existing_objects
    for (const other of this.objects) other.info.zBump++;
    this.objects.add(cue);
    return info;
  }

  private cueDespawn(cue: Cue<KarateCueInfo>) {
    this.rt.sprites.delete(cue.info.sprite);
    this.rt.sprites.delete(cue.info.shadow);
    this.objects.delete(cue);
  }

  private cueUpdate(cue: Cue<KarateCueInfo>, running: number, duration: number): boolean {
    const d = cue.info;
    const T = this.t.timing;
    if (running > this.rt.ticksToFrames(T.objectLifetimeTicks)) return true;
    if (!d.isHit) {
      d.dist = Math.floor((running * 256) / duration) & 0xffff;
      if (d.dist > T.floorProgress * 256) {
        // Object hits the floor.
        d.isHit = true;
        d.angle = s8(d.angle + Math.floor(Math.random() * this.t.physics.landSpinRandom));
        this.resetFlow();
        this.rt.playSound(this.t.sounds.land);
        return false;
      }
      if (d.dist > T.outOfReachProgress * 256 && !d.miss) {
        d.miss = true;
        this.joe.miss = this.ticks(T.reactionTicks.miss);
      }
      this.updateLaunched(d);
      this.updateObject(d);
    } else {
      this.updatePunched(d);
      if (fixedToInt(d.x) > this.t.layout.despawnX) return true;
      if (fixedToInt(d.y) > d.landY) {
        d.y = d.landY << 8;
        d.vx = 0;
        d.vy = 0;
        d.ay = 0;
        d.spin = 0;
      }
      this.updateObject(d);
    }
    return false;
  }

  // karate_cue_update_launched_object: pseudo-3D approach toward the camera.
  private updateLaunched(d: KarateCueInfo) {
    const A = this.t.layout.approach;
    const p = Math.max(1, d.dist);
    const t = p - 0x100;
    const arc = A.arcHeight - fixedToInt(fixedToInt(t * A.arcHeight * t));
    const lift = A.lift - arc;
    d.x = (Math.trunc((A.xOffset << 8) / p) + A.centerX) << 8;
    d.y = (Math.trunc((lift << 8) / p) + A.centerY) << 8;
    d.landY = Math.trunc((A.floorDepth << 8) / p) + A.centerY;
    d.scale = Math.trunc((256 << 8) / p);
  }

  private updatePunched(d: KarateCueInfo) {
    d.vy += d.ay;
    d.x += d.vx;
    d.y += d.vy;
    d.angle = s8(d.angle + d.spin);
  }

  private updateObject(d: KarateCueInfo) {
    d.sprite.x = fixedToInt(d.x);
    d.sprite.y = fixedToInt(d.y);
    d.sprite.z = 0x4700 + d.dist + d.zBump;
    d.shadow.x = fixedToInt(d.x);
    d.shadow.y = d.landY;
    const visual = 0x100 / Math.max(1, d.scale);
    d.sprite.affine = { scale: visual, angle: -d.angle };
    d.shadow.affine = { scale: visual, angle: 0 };
    d.sprite.visible = true;
    d.shadow.visible = true;
  }

  private launch(d: KarateCueInfo, m: { vx: number; vy: number; gravity?: number; spin: number }) {
    d.vx = fx(m.vx);
    d.vy = fx(m.vy);
    if (m.gravity !== undefined) d.ay = fx(m.gravity);
    d.spin = m.spin;
  }

  private hitEffect() {
    const H = this.t.layout.hitEffect;
    this.rt.sprites.create(this.anim('hitEffect'), 0, H.x, H.y, 0x4f00, 1, 0, PLAYBACK_DELETE);
  }

  private cueHit(cue: Cue<KarateCueInfo>) {
    const d = cue.info;
    const j = this.joe;
    const P = this.t.physics;
    const sprites = this.rt.sprites;
    d.isHit = true;
    if (this.seriousModeStarted) this.startSeriousMode();
    if (this.seriousModeStopped) this.stopSeriousMode();
    const isHigh = this.isHighFlow || this.version === VER_SERIOUS;
    const heavy = this.t.objects[d.kind].heavy && this.t.flow.heavyNeedsHighFlow;

    if (!isHigh) {
      if (heavy) {
        // Too heavy without flow: ouch, counts as a barely.
        this.launch(d, P.ouch);
        d.angle = s8(P.ouch.angle);
        j.isNotBeat = true;
        sprites.setAnim(j.sprite, this.anim('punchOuch'), 0, 1, 0x7f, 0);
        this.rt.playSound(this.version === VER_FACES ? cue.barelySfx ?? '' : this.t.sounds.hurt);
        const g = this.rt.gameplay;
        g.ignoreThisCueResult = true;
        g.addResult(cue.markingCriteria, RESULT_BARELY, g.lastHitOffset, cue as Cue, this.rt.now);
        this.decrementFlow();
      } else {
        this.launch(d, P.lowHit);
        j.isNotBeat = true;
        sprites.setAnim(j.sprite, this.anim(this.useTheFace ? 'smugLow' : 'punchLow'), 0, 1, 0x7f, 0);
        this.hitEffect();
        if (this.version !== VER_FACES) cue.hitSfx = this.t.sounds.lowFlowHit;
        this.incrementFlow();
      }
    } else {
      this.launch(d, P.highHit);
      j.isNotBeat = true;
      sprites.setAnim(j.sprite, this.anim(this.useTheFace ? 'smugHigh' : 'punchHigh'), 0, 1, 0x7f, 0);
      this.hitEffect();
      if (d.kind === 'rock') {
        j.smirk = this.ticks(this.t.timing.reactionTicks.smirk);
        this.rt.playSound(this.t.sounds.cheer);
      } else if (d.kind === 'bomb') {
        j.happy = this.ticks(this.t.timing.reactionTicks.happy);
      }
      this.incrementFlow();
    }

    if (this.tutorialCounter) {
      this.tutorialCounter--;
      sprites.setAnimCel(this.tutorialText, this.tutorialCounter);
    }
  }

  private cueBarely(cue: Cue<KarateCueInfo>) {
    const d = cue.info;
    const j = this.joe;
    d.isHit = true;
    this.launch(d, this.t.physics.barely);
    j.isNotBeat = true;
    this.rt.sprites.setAnim(j.sprite, this.anim('punchHigh'), 0, 1, 0x7f, 0);
    j.barely = this.ticks(this.t.timing.reactionTicks.barely);
    this.decrementFlow();
    this.rt.sequencer.loopsEnabled = true;
  }

  private startSeriousMode() {
    this.seriousModeStarted = false;
    this.joe.sprite.basePalette = 1;
    this.rt.ppu.layers[0].visible = true;
    this.rt.ppu.layers[1].visible = false;
    this.flowSprite.visible = false;
    this.version = VER_SERIOUS;
  }

  private stopSeriousMode() {
    this.seriousModeStopped = false;
    this.joe.sprite.basePalette = 0;
    this.rt.ppu.layers[0].visible = false;
    this.rt.ppu.layers[1].visible = true;
    this.flowSprite.visible = true;
    this.version = VER_0;
    this.updateBgPalette();
    this.rt.gameplay.inputsEnabled = false;
  }
}

// Stand-in for each game's prologue engine (title card before practice): a plain title screen.
export class PrologueCard implements GameModule {
  readonly engine = '*prologue*';
  cueIndex = [];
  private rt!: Runtime;
  constructor(public title: string) {}
  start(rt: Runtime) {
    this.rt = rt;
    rt.ppu.bgPal[0] = 0x000000;
    rt.caption(this.title);
  }
  stop() {
    this.rt.caption(null);
  }
  update() {}
  engineEvent() {}
  commonEvent() {}
  inputEvent() {}
}
