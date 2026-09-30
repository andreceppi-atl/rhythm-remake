// Loads a converted game (public/gba/<game>/, produced by tools/convert-game.mjs).
import type { Cel } from './ppu';
import type { Animation } from './sprites';
import type { LevelData } from '../engine/sequencer';
import type { SoundPack } from '../audio/sound';
import { loadSkin, type LoadedSkin } from './skin';
import type { RasterCel } from './raster-cel';

export interface GameData {
  base: string;
  level: LevelData;
  palettes: Record<string, number[][]>;
  cels: Record<string, Cel>;
  anims: Record<string, Animation>;
  bins: Record<string, Uint8Array>;
  text: Record<string, string>;
  sound: SoundPack;
  skin?: LoadedSkin;
  skinWarning?: string;
  // Extra replacement/new art keyed by cel identity (e.g. generated custom characters).
  raster?: Map<Cel, RasterCel>;
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export async function loadGameData(game: string, skinId?: string): Promise<GameData> {
  const base = `${import.meta.env.BASE_URL}gba/${game}/`;
  const [level, gfx, text, sound] = await Promise.all([
    json<LevelData>(`${base}level.json`),
    json<{ palettes: Record<string, number[][]>; cels: Record<string, Cel>; anims: Record<string, [string, number][]>; binaries: string[] }>(`${base}gfx.json`),
    json<Record<string, string>>(`${base}text.json`),
    json<SoundPack>(`${base}sound.json`),
  ]);
  const anims: Record<string, Animation> = {};
  for (const [name, frames] of Object.entries(gfx.anims)) {
    anims[name] = frames.map(([cel, n]) => ({ cel: gfx.cels[cel] ?? [], frames: n }));
  }
  const bins: Record<string, Uint8Array> = {};
  await Promise.all(
    gfx.binaries.map(async (b) => {
      const r = await fetch(base + b);
      bins[b] = new Uint8Array(await r.arrayBuffer());
    }),
  );
  const replacement = skinId === undefined ? undefined : await loadSkin(game, skinId, gfx.cels);
  return { base, level, palettes: gfx.palettes, cels: gfx.cels, anims, bins, text, sound, skin: replacement?.skin, skinWarning: replacement?.warning };
}
