import type { Cel } from './ppu';
import type { RasterCel } from './raster-cel';

export interface LoadedSkin {
  id: string;
  name: string;
  cels: Map<Cel, RasterCel>;
}

export type SkinResult = { skin: LoadedSkin; warning?: never } | { skin?: never; warning: string };

const CONTRACT = { scale: 4, w: 492, h: 572, anchorX: 132, anchorY: 312 };

// The complete set is loaded before any cel is replaced: a broken skin falls back as a whole.
export async function loadSkin(game: string, id: string, cels: Record<string, Cel>): Promise<SkinResult> {
  try {
    if (game !== 'karate_man') throw new Error('this loader supports Karate Man skins');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new Error('invalid skin id');
    const base = `${import.meta.env.BASE_URL}skins/${id}/`;
    const response = await fetch(`${base}skin.json`);
    if (!response.ok) throw new Error(`skin.json returned ${response.status}`);
    let manifest;
    try { manifest = await response.json(); } catch { throw new Error('skin.json is missing or unreadable'); }
    if (manifest.contract !== 1 || manifest.id !== id || manifest.replaces !== 'karate_man/joe') {
      throw new Error('skin.json must match contract 1, the requested id, and karate_man/joe');
    }
    for (const [key, value] of Object.entries(CONTRACT)) {
      if (manifest.frame?.[key] !== value) throw new Error(`skin.json frame.${key} must be ${value}`);
    }
    const entries = await Promise.all(Array.from({ length: 35 }, async (_, index): Promise<[Cel, RasterCel]> => {
      const name = `cel${String(index).padStart(3, '0')}`;
      const original = cels[`karate_man_${name}`];
      if (!original) throw new Error(`game data has no ${name}`);
      const image = new Image();
      image.src = `${base}joe/${name}.png`;
      try { await image.decode(); } catch { throw new Error(`${name}.png is missing or unreadable`); }
      if (image.naturalWidth !== CONTRACT.w || image.naturalHeight !== CONTRACT.h) {
        throw new Error(`${name}.png must be 492 × 572 pixels`);
      }
      const full = document.createElement('canvas');
      full.width = CONTRACT.w;
      full.height = CONTRACT.h;
      const fullCtx = full.getContext('2d', { willReadFrequently: true })!;
      fullCtx.drawImage(image, 0, 0);
      const rgba = fullCtx.getImageData(0, 0, full.width, full.height).data;
      const corners = [0, full.width - 1, (full.height - 1) * full.width, full.width * full.height - 1];
      if (corners.some((pixel) => rgba[pixel * 4 + 3] !== 0)) throw new Error(`${name}.png must have a transparent background`);
      if (!rgba.some((value, i) => i % 4 === 3 && value > 0)) throw new Error(`${name}.png is empty`);
      const canvas = document.createElement('canvas');
      canvas.width = CONTRACT.w / CONTRACT.scale;
      canvas.height = CONTRACT.h / CONTRACT.scale;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return [original, {
        w: canvas.width, h: canvas.height,
        x0: -CONTRACT.anchorX / CONTRACT.scale,
        y0: -CONTRACT.anchorY / CONTRACT.scale,
        rgba: context.getImageData(0, 0, canvas.width, canvas.height).data,
        priority: 0,
      }];
    }));
    return { skin: { id, name: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : id, cels: new Map(entries) } };
  } catch (error) {
    const warning = `Skin “${id}” could not load. Playing with Karate Joe. ${error instanceof Error ? error.message : String(error)}`;
    console.warn(warning);
    return { warning };
  }
}
