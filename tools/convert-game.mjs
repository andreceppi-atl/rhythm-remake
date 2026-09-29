#!/usr/bin/env node
// Convert one minigame from the Rhythm Tengoku decomp into runtime data under public/gba/<game>/.
//   node tools/convert-game.mjs karate_man
//
// Output (local only, gitignored — it is Nintendo-derived data):
//   level.json   beatscripts expanded to primitive ops + marking-criteria structs + scene entry points
//   gfx.json     palettes, OAM cels, animations (cel name + frame duration)
//   *.4bpp/.tilemap  raw tile and map data, copied as-is
//   text.json    script text labels -> strings (Japanese originals)
//   sound.json   songs -> banks -> instruments -> samples used by this game
//   midi/*.mid, samples/*.wav
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSoundPack } from './lib/audio.mjs';
import { parseBeatscript, parseEnums, parseMacros, parseSets } from './lib/beatscript.mjs';
import { ROOT, fetchBuffer, fetchText, repoTree, tryFetchText } from './lib/decomp.mjs';
import { parseAnims, parseCels, parsePalettes } from './lib/graphics.mjs';

const game = process.argv[2];
if (!game) {
  console.error('usage: node tools/convert-game.mjs <decomp_game_dir, e.g. karate_man>');
  process.exit(1);
}

const tree = repoTree();
const gameDir = `games/${game}`;
const files = tree.filter((p) => p.startsWith(`${gameDir}/`));
if (!files.length) throw new Error(`no such game in decomp: ${game}`);
const out = join(ROOT, 'public', 'gba', game);
mkdirSync(join(out, 'midi'), { recursive: true });
mkdirSync(join(out, 'samples'), { recursive: true });

// ---- Beatscript ----
const macros = parseMacros(fetchText('include/beatscript.inc'));
const consts = {};
parseSets(fetchText('include/beatscript_main.inc'), consts);
parseSets(fetchText('include/beatscript.inc'), consts);
const macroSrc = tryFetchText(`${gameDir}/macros.inc`);
if (macroSrc) {
  parseMacros(macroSrc, macros);
  parseSets(macroSrc, consts);
}
for (const h of [`include/engines/${game}.h`, 'include/cues.h']) {
  const src = tryFetchText(h);
  if (src) parseEnums(src, consts);
}
const level = { scripts: {}, structs: {}, scenes: {} };
const bsFiles = files.filter((p) => p.endsWith('.bs'));
for (const f of bsFiles) {
  const r = parseBeatscript(fetchText(f), macros, consts);
  Object.assign(level.scripts, r.scripts);
  Object.assign(level.structs, r.structs);
  Object.assign(level.scenes, r.scenes);
}
writeFileSync(join(out, 'level.json'), JSON.stringify(level));

// ---- Graphics ----
const gfx = { palettes: {}, cels: {}, anims: {}, binaries: [] };
for (const f of files.filter((p) => p.includes('/graphics/'))) {
  const name = f.split('/').pop();
  if (name.endsWith('_pal.c')) Object.assign(gfx.palettes, parsePalettes(fetchText(f)));
  else if (name.endsWith('_anim_cells.inc.c')) Object.assign(gfx.cels, parseCels(fetchText(f)));
  else if (name.endsWith('_anim.c')) Object.assign(gfx.anims, parseAnims(fetchText(f)));
  else if (/\.(4bpp|8bpp|tilemap|bin)$/.test(name)) {
    writeFileSync(join(out, name), fetchBuffer(f));
    gfx.binaries.push(name);
  }
}
writeFileSync(join(out, 'gfx.json'), JSON.stringify(gfx));

// ---- Text ----
const text = {};
for (const f of files.filter((p) => p.endsWith('_text.c'))) {
  const src = fetchText(f);
  for (const m of src.matchAll(/const char (\w+)\[\]\s*=\s*((?:\s*"(?:[^"\\]|\\.)*")+)\s*;/g)) {
    text[m[1]] = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => s[1].replace(/\\n/g, '\n')).join('');
  }
}
writeFileSync(join(out, 'text.json'), JSON.stringify(text, null, 1));

// ---- Sound ----
const engineSources = [...files.filter((p) => /\.(c|bs)$/.test(p)), `src/engines/${game}.c`]
  .map((p) => tryFetchText(p) ?? '')
  .join('\n');
const songs = [...new Set([...engineSources.matchAll(/\bs_(\w+?)_seqData\b/g)].map((m) => m[1]))];
const { pack, missing } = buildSoundPack(songs);
for (const song of Object.values(pack.songs)) {
  const path = `audio/sequences/${song.midi}.mid`;
  writeFileSync(join(out, 'midi', `${song.midi}.mid`), fetchBuffer(path));
}
for (const s of Object.values(pack.samples)) {
  writeFileSync(join(out, 'samples', s.file), fetchBuffer(`audio/samples/${s.file}`));
}
writeFileSync(join(out, 'sound.json'), JSON.stringify(pack));

console.log(
  `${game}: ${Object.keys(level.scripts).length} scripts, ${Object.keys(gfx.cels).length} cels, ` +
    `${Object.keys(gfx.anims).length} anims, ${Object.keys(pack.songs).length} songs, ` +
    `${Object.keys(pack.samples).length} samples, ${Object.keys(text).length} text strings`,
);
if (missing.length) console.warn('missing:', [...new Set(missing)].join(', '));
