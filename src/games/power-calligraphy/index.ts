// Power Calligraphy — port of the decomp's src/engines/power_calligraphy.c + games/power_calligraphy/engine.c.
// Constants live in tuning.ts (defaults = the GBA values).
//
// Scene: BG3 = desk (static), BG2 = the paper (scrolled by `offset_paper` for the brush-pressure
// shake), BG1 = a copy of the finished sheet that flies off when the next one comes in. The kana,
// brush and stroke sprites use BG2 (or BG1) as their origin so they shake/fly with the paper.
import type { CueDef } from '../../engine/gameplay';
import type { GameModule, Runtime } from '../../engine/runtime';
import type { Animation, Sprite } from '../../gba/sprites';
import { PC_DEFAULTS, type PcTuning } from './tuning';

const STATE_NULL = 0;
const STATE_DANCE = 1;
const STATE_STUMBLE = 2;
const STATE_BOW = 3;
const STATE_END_BOW = 4;

const s8 = (v: number) => ((v & 0xff) << 24) >> 24;

interface Person {
  sprite: Sprite;
  type: number; // 0 = M, 1 = W
  column: number; // 0 = left (M start), 1 = right (W start)
  y: number; // px (fractional)
}

interface PcCueInfo {
  stroke: number;
}

export class PowerCalligraphy implements GameModule {
  readonly engine = 'power_calligraphy_engine';
  private rt!: Runtime;
  private anims!: Record<string, Animation>;
  private brush!: Sprite;
  private brushEffect!: Sprite;
  private kana!: Sprite;
  private kanaExit!: Sprite;
  private currentKana = -1;
  private nextInput = -1;
  private inputSprites: Sprite[] = [];
  private inputExitSprites: Sprite[] = [];
  private paperExit: { vx: number; vy: number } | null = null;
  private people: Person[] = [];
  private danceTimer = 0; // ticks until the dancers switch side
  private danceSide = 0;
  private peopleState = STATE_NULL;
  private peopleReturnState = STATE_NULL;
  private stumbleTimer = 0;

  readonly cueIndex: (CueDef<PcCueInfo> | null)[];

  constructor(readonly t: PcTuning = PC_DEFAULTS) {
    this.cueIndex = [
      {
        duration: t.timing.cueDurationTicks,
        hitWindow: t.timing.hitWindow as [number, number],
        barelyWindow: t.timing.barelyWindow as [number, number],
        sfxMiss: t.sounds.miss,
        spawn: () => {
          const stroke = this.nextInput;
          this.nextInput = -1;
          return { stroke };
        },
        update: (_c, running) => running > this.rt.ticksToFrames(t.timing.cueLifetimeTicks),
        hit: (c) => this.express(c.info.stroke, 0),
        barely: (c) => {
          this.express(c.info.stroke, this.rt.gameplay.lastHitOffset < 0 ? 1 : 2);
          this.rt.sequencer.loopsEnabled = true;
          this.setPeopleState(STATE_STUMBLE);
        },
        miss: () => {
          // The charge animation plays backwards (sprite_set_playback(-1, 0, 0)).
          this.rt.sprites.setPlayback(this.brush, -1, 0, 0);
          this.rt.sequencer.loopsEnabled = true;
        },
      },
    ];
  }

  private anim(name: string) {
    const a = this.anims[`anim_power_calligraphy_${name}`];
    if (!a) throw new Error(`missing anim_power_calligraphy_${name}`);
    return a;
  }

  private pal!: number[][]; // palettes in use (the scene's look can swap them)

  private get paper() {
    return this.rt.ppu.layers[2];
  }

  private get exitLayer() {
    return this.rt.ppu.layers[1];
  }

  // ---- power_calligraphy_engine_start + graphics table ----
  start(rt: Runtime) {
    this.rt = rt;
    this.anims = rt.data.anims;
    const { ppu, data, sprites } = rt;
    const look = rt.look ? data.looks?.[rt.look] : undefined;
    const pal = (this.pal = look?.palettes?.power_calligraphy_pal ?? data.palettes.power_calligraphy_pal);
    ppu.loadBgTiles(data.bins['power_calligraphy_bg_tiles.4bpp'], 0);
    ppu.loadBgTiles(data.bins['power_calligraphy_bg_map.tilemap'], 0xe800);
    ppu.loadObjTiles(look?.bins?.['power_calligraphy_obj.4bpp'] ?? data.bins['power_calligraphy_obj.4bpp'], 0);
    ppu.loadObjTiles(data.bins['power_calligraphy_obj_dancers.4bpp'], 0x5800);
    ppu.loadPalettes('bg', pal, 0, 10);
    ppu.loadPalettes('obj', pal, 0, 14);
    this.applyColorOverrides();
    Object.assign(ppu.layers[0], { visible: false });
    Object.assign(ppu.layers[1], { visible: false, charBase: 0, mapBase: 0xe800, priority: 1, x: 0, y: 0 });
    Object.assign(ppu.layers[2], { visible: true, charBase: 0, mapBase: 0xe800, priority: 2, x: 0, y: 0 });
    Object.assign(ppu.layers[3], { visible: true, charBase: 0, mapBase: 0xe800, priority: 3, x: 0, y: 0 });
    Object.assign(rt.translations, this.t.text);

    const B = this.t.layout.brushStart;
    this.brush = sprites.create(this.anim('brush'), 0, 64, 64, 0x4738, 0, 0, 0);
    this.brush.x = B.x;
    this.brush.y = B.y;
    this.brush.origin = this.paper;
    this.brushEffect = sprites.create(this.anim('brush_charge_effect'), 0, 64, 64, 0x4737, 1, 0, 0x8000 | 2);
    this.brushEffect.origin = this.paper;
    const C = this.t.layout.paperCenter;
    this.kana = sprites.create(this.anim('kokoro'), 0, C.x, C.y, 0x8800, 0, 0, 0x8000);
    this.kana.origin = this.paper;
    this.kanaExit = sprites.create(this.anim('kokoro'), 0, C.x, C.y, 0x4800, 0, 0, 0x8000);
    this.kanaExit.origin = this.exitLayer;

    this.currentKana = -1;
    this.paperExit = null;
    this.nextInput = -1;
    this.inputSprites = [];
    this.inputExitSprites = [];
    this.initPeople();
    rt.gameplay.inputsEnabled = true;
  }

  stop() {
    this.rt.caption(null);
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

  // ---- little people (dancers) ----
  private initPeople() {
    const L = this.t.layout.people;
    this.people = [];
    const starts = [
      { x: L.mColumnX, y: L.mStartY },
      { x: L.wColumnX, y: L.wStartY },
    ];
    starts.forEach((st, column) => {
      let y = st.y;
      for (let j = 0; j < L.perColumn; j++) {
        const type = j & 1;
        const sprite = this.rt.sprites.create(this.danceAnim(type, 0), 0, st.x, y, (-y - 0x7800) & 0xffff, 1, 0x7f, 0);
        sprite.baseTile = 0x2c0;
        this.people.push({ sprite, type, column, y });
        y += L.spacing;
      }
    });
    this.danceTimer = 0;
    this.danceSide = 0;
    this.peopleState = STATE_NULL;
  }

  private danceAnim(type: number, side: number) {
    // power_calligraphy_people_dance_anim: M = {l, r}, W = {r, l}
    const table = [
      ['people_m_dance_l', 'people_m_dance_r'],
      ['people_w_dance_r', 'people_w_dance_l'],
    ];
    return this.anim(table[type][side]);
  }

  private setPeopleState(state: number) {
    const sprites = this.rt.sprites;
    this.peopleState = state;
    const fall = [
      ['people_m_fall_r', 'people_m_fall_l'],
      ['people_w_fall_r', 'people_w_fall_l'],
    ];
    const bow = [
      ['people_m_bow_r', 'people_m_bow_l'],
      ['people_w_bow_r', 'people_w_bow_l'],
    ];
    for (const p of this.people) {
      switch (state) {
        case STATE_DANCE:
          this.peopleReturnState = STATE_DANCE;
          sprites.setAnim(p.sprite, this.danceAnim(p.type, 0), 0x7f, 1, 0x7f, 0);
          break;
        case STATE_STUMBLE:
          this.stumbleTimer = Math.round(this.rt.ticksToFrames(this.t.timing.stumbleTicks));
          sprites.setAnim(p.sprite, this.anim(fall[p.type][p.column]), 0, 1, 0, 0);
          break;
        case STATE_BOW:
          this.peopleReturnState = STATE_BOW;
          sprites.setAnim(p.sprite, this.anim(bow[p.type][p.column]), 0, 1, 0x7f, 0);
          break;
        case STATE_END_BOW:
          this.peopleReturnState = STATE_END_BOW;
          sprites.setAnim(p.sprite, this.anim(bow[p.type][p.column]), 0, 0, 0, 0);
          break;
      }
    }
  }

  private updatePeople() {
    const L = this.t.layout.people;
    let swap = false;
    this.danceTimer -= (this.rt.tempo * 24) / 3600; // ticks per frame
    if (this.danceTimer < 0) {
      this.danceTimer += 24;
      this.danceSide ^= 1;
      swap = true;
    }
    if (this.peopleState === STATE_DANCE) {
      for (const p of this.people) {
        if (p.column === 0) {
          p.y += L.scrollPerFrame;
          if (p.y >= L.wrap - 8) p.y -= L.wrap;
        } else {
          p.y -= L.scrollPerFrame;
          if (p.y < 0) p.y += L.wrap;
        }
        p.sprite.y = Math.floor(p.y);
        if (swap) this.rt.sprites.setAnim(p.sprite, this.danceAnim(p.type, this.danceSide), 0, 1, 0x7f, 0);
      }
    } else if (this.peopleState === STATE_STUMBLE) {
      if (--this.stumbleTimer <= 0) this.setPeopleState(this.peopleReturnState);
    }
  }

  // ---- engine events (power_calligraphy_engine_events[]) ----
  engineEvent(id: number, param: string | number) {
    const v = Number(param) || 0;
    switch (id) {
      case 0x00: // set kana
        this.currentKana = v;
        this.rt.sprites.setAnim(this.kana, this.anim(this.t.kanaAnims[v]), 0, 0, 0, 0);
        return;
      case 0x01: // set kana cel
        if (s8(v) < 0) this.kana.visible = false;
        else {
          this.kana.visible = true;
          this.rt.sprites.setAnimCel(this.kana, v);
        }
        return;
      case 0x02: // offset paper (brush pressure shake)
        this.paper.x += s8(v);
        this.paper.y += s8(v >> 8);
        return;
      case 0x03:
        this.removePaper(!!v);
        return;
      case 0x04:
        this.nextInput = v;
        return;
      case 0x05:
        this.finishKokoro2();
        return;
      case 0x06: // set brush x, y, cel (packed s8s)
        this.setBrush(s8(v), s8(v >> 8), s8(v >> 16));
        return;
      case 0x07: // charge brush
        if (v === 0) this.rt.sprites.setAnim(this.brush, this.anim('brush_charge1'), 1, 1, 6, 0);
        else this.rt.sprites.setAnim(this.brush, this.anim('brush_charge2'), 0, 1, 4, 0);
        return;
      case 0x08: {
        // charge glow (palette fade on OBJ palette 11)
        const pal = this.pal;
        const G = this.t.glow;
        const frames = this.rt.ticksToFrames(this.t.timing.chargeGlowTicks);
        if (v) this.rt.ppu.fadePalette('obj', G.slot, pal[G.charge[0]], pal[G.charge[1]], frames);
        else {
          this.rt.sprites.setAnimCel(this.brushEffect, 0);
          this.rt.ppu.fadePalette('obj', G.slot, pal[G.release[0]], pal[G.release[1]], frames);
        }
        return;
      }
      case 0x09: // raise brush early (SUN only)
        this.brush.y -= this.t.layout.raiseBrushBy;
        this.rt.sprites.setAnim(this.brush, this.anim('brush'), 0, 0, 0, 0);
        return;
      case 0x0a: // ink swirl: remix-only, not used by the main level
        return;
      case 0x0b:
        this.setPeopleState(v);
        return;
      case 0x0c: // shift people columns
        for (const p of this.people) {
          p.y += p.column === 0 ? v : -v;
          p.sprite.y = Math.floor(p.y);
        }
        return;
    }
  }

  commonEvent(id: number, arg: string | number) {
    // 0 = beat animation (unimplemented in the original), 1 = display text, 2 = tutorial (skip icon)
    if (id === 1) this.rt.caption(arg && arg !== 0 ? this.rt.text(arg) : null);
  }

  inputEvent() {}

  // ---- per-frame update (power_calligraphy_engine_update) ----
  update() {
    // paper exit
    if (this.paperExit) {
      const L = this.exitLayer;
      const x = L.x + this.paperExit.vx, y = L.y + this.paperExit.vy;
      if (y < -160) {
        this.paperExit = null;
        L.visible = false;
        this.kanaExit.visible = false;
      } else {
        L.x = x;
        L.y = y;
      }
    }
    this.updatePeople();
    this.brushEffect.x = this.brush.x;
    this.brushEffect.y = this.brush.y;
  }

  private setBrush(x: number, y: number, cel: number) {
    const C = this.t.layout.paperCenter;
    this.rt.sprites.setAnim(this.brush, this.anim('brush'), cel, 0, 0, 0);
    this.brush.x = C.x + x;
    this.brush.y = C.y + y;
  }

  private removePaper(slowly: boolean) {
    const sprites = this.rt.sprites;
    const L = this.t.layout;
    const [vx, vy] = slowly ? L.paperExitSlow : L.paperExitFast;
    this.paperExit = { vx, vy };
    const exit = this.exitLayer;
    exit.visible = true;
    exit.x = this.paper.x;
    exit.y = this.paper.y;
    if (this.currentKana < 0) {
      sprites.setAnim(this.brush, this.anim('brush'), 0, 0, 0, 0);
      this.kanaExit.visible = false;
    } else {
      sprites.setAnim(this.kanaExit, this.kana.anim, this.kana.cel, 0, 0, 0);
      this.kanaExit.visible = true;
    }
    this.kana.visible = false;
    this.paper.x = 0;
    this.paper.y = 0;
    for (const s of this.inputExitSprites) sprites.delete(s);
    for (const s of this.inputSprites) {
      s.z = 0x47f6;
      s.origin = exit;
    }
    this.inputExitSprites = this.inputSprites;
    this.inputSprites = [];
    this.currentKana = -1;
  }

  private finishKokoro2() {
    const target = this.anim('kokoro_input2');
    for (const s of this.inputSprites) {
      if (s.anim === target && s.cel === 0) {
        this.rt.sprites.setAnimCel(s, 3);
        this.paper.y += 2;
        this.rt.playSound(this.t.sounds.kokoro2Finish);
        return;
      }
    }
  }

  // power_calligraphy_express_input: draw the stroke (clean / early / late), jolt, brush follow-through.
  private express(stroke: number, timing: number) {
    const st = this.t.strokes[stroke];
    if (!st) return;
    const C = this.t.layout.paperCenter;
    const s = this.rt.sprites.create(this.anim(st.anim), timing, C.x, C.y, 0x87f6, 0, 0, 0);
    s.origin = this.paper;
    this.inputSprites.push(s);
    this.rt.stopSound(this.t.sounds.chargeVoice);
    if (timing !== 0) this.rt.playSound(st.barelySfx);
    else {
      this.paper.x -= st.paperJolt[0];
      this.paper.y -= st.paperJolt[1];
      this.rt.playSound(st.hitSfx);
    }
    const [x, y, cel] = timing === 0 ? st.brush.hit : timing === 1 ? st.brush.early : st.brush.late;
    this.setBrush(x, y, cel);
  }
}

