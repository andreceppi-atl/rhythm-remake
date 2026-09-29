// Port of the decomp's sprite handler (src/lib_0804ca80.c): sprites play animations of cels,
// each cel shown for N frames at 60 Hz. Mirrors sprite_create / sprite_set_anim / playback types
// so engine code can be translated line-for-line.
import type { Cel, DrawSprite } from './ppu';

export type AnimFrame = { cel: Cel; frames: number };
export type Animation = AnimFrame[];

export const PLAYBACK_LOOP = 0;
export const PLAYBACK_ALTERNATING = 1;
export const PLAYBACK_HIDE = 2;
export const PLAYBACK_DELETE = 3;
export const PLAYBACK_CALLBACK = 4;

export type Origin = { x: number; y: number };

export interface Sprite {
  id: number;
  anim: Animation;
  cel: number;
  celTime: number; // frames left on the current cel
  celInc: number; // 1 forward, -1 backward, 0 paused
  loopCel: number;
  playback: number;
  x: number;
  y: number;
  z: number;
  visible: boolean;
  basePalette: number;
  baseTile: number;
  speed: number; // 1 = normal
  origin: Origin | null; // screen position = (x - origin.x, y - origin.y), for sprites stuck to a scrolling BG
  affine: { scale: number; angle: number } | null;
  hflip: boolean;
  vflip: boolean;
  callback: ((s: Sprite) => void) | null;
  callbackCel: number;
}

export class SpriteHandler {
  private sprites = new Map<number, Sprite>();
  private nextId = 1;

  create(anim: Animation, startCel: number, x: number, y: number, z: number, celInc = 0, loopCel = 0, playbackFlags = 0): Sprite {
    const s: Sprite = {
      id: this.nextId++,
      anim,
      cel: 0,
      celTime: 0,
      celInc,
      loopCel,
      playback: playbackFlags & 0xff,
      x, y, z,
      visible: (playbackFlags & 0x8000) === 0,
      basePalette: 0,
      baseTile: 0,
      speed: 1,
      origin: null,
      affine: null,
      hflip: false,
      vflip: false,
      callback: null,
      callbackCel: -1,
    };
    this.sprites.set(s.id, s);
    this.setCel(s, startCel, true);
    return s;
  }

  delete(s: Sprite | null | undefined) {
    if (s) this.sprites.delete(s.id);
  }

  exists(s: Sprite | null | undefined) {
    return !!s && this.sprites.has(s.id);
  }

  clear() {
    this.sprites.clear();
  }

  // sprite_set_anim(anim, startCel, direction, loopCel, playbackType). startCel < 0 keeps playback state.
  setAnim(s: Sprite, anim: Animation, startCel: number, celInc: number, loopCel: number, playback: number) {
    s.anim = anim;
    if (startCel >= 0) {
      s.celInc = celInc;
      s.loopCel = loopCel;
      s.playback = playback;
      this.setCel(s, startCel, true);
    }
  }

  setPlayback(s: Sprite, celInc: number, loopCel: number, playback: number) {
    s.celInc = celInc;
    s.loopCel = loopCel;
    s.playback = playback & 0xff;
  }

  setAnimCel(s: Sprite, cel: number) {
    this.setCel(s, cel, true);
  }

  // sprite_update_anim_cel
  private setCel(s: Sprite, next: number, resetDuration: boolean) {
    if (resetDuration) s.celTime = 0;
    const total = s.anim.length;
    let loopCel = Math.min(s.loopCel, total - 1);
    if (loopCel < 0) loopCel = 0;
    let cel = next;
    if (cel < 0 || cel >= total) {
      switch (s.playback) {
        case PLAYBACK_LOOP:
          cel = loopCel;
          break;
        case PLAYBACK_HIDE:
          cel = loopCel;
          s.visible = false;
          break;
        case PLAYBACK_CALLBACK:
          cel = loopCel;
          if (s.callback) {
            s.celTime += s.anim[cel].frames;
            s.cel = cel;
            s.callback(s);
            return;
          }
          break;
        case PLAYBACK_ALTERNATING:
          if (cel < 1) {
            cel = Math.min(-cel, total - 1);
          } else {
            cel = Math.max(0, total - 3 - (cel - total));
          }
          s.celInc = -s.celInc;
          break;
        case PLAYBACK_DELETE:
          this.delete(s);
          return;
      }
    }
    s.celTime += s.anim[cel]?.frames ?? 1;
    s.cel = cel;
    if (s.callback && cel === s.callbackCel) s.callback(s);
  }

  // One 60 Hz frame of animation.
  update() {
    for (const s of [...this.sprites.values()]) {
      if (!this.sprites.has(s.id) || s.celInc === 0 || !s.anim.length) continue;
      s.celTime -= s.speed;
      let guard = 0;
      while (s.celTime <= 0 && s.celInc !== 0 && this.sprites.has(s.id) && guard++ < 64) {
        this.setCel(s, s.cel + s.celInc, false);
      }
    }
  }

  drawList(): DrawSprite[] {
    const list: DrawSprite[] = [];
    for (const s of this.sprites.values()) {
      if (!s.visible || !s.anim.length) continue;
      const frame = s.anim[s.cel];
      if (!frame) continue;
      list.push({
        cel: frame.cel,
        x: s.x - (s.origin?.x ?? 0),
        y: s.y - (s.origin?.y ?? 0),
        z: s.z,
        basePalette: s.basePalette,
        baseTile: s.baseTile,
        hflip: s.hflip,
        vflip: s.vflip,
        affine: s.affine,
        order: s.id,
      });
    }
    return list;
  }
}
