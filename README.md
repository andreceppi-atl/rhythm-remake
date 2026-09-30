# Rhythm Remake

A browser engine that plays minigames from the GBA Rhythm Tengoku ("Rhythm Heaven") 1:1: same scripts, timing windows, physics and animation data. It adds character skins, a mod file for tuning, and an auto-charter that turns any song into a playable level.

Showcase: **Diamond\*** as the player character, with the song *GG*.

## What's in this repo (and what isn't)

This repo holds the engine, tools, docs, the Diamond\* skin and the GG track. **It contains no Nintendo data.** Graphics, samples, MIDI and level scripts are generated locally from the community decompilation ([arthurtilly/rhythmtengoku](https://github.com/arthurtilly/rhythmtengoku)). They're gitignored and never committed.

## Run it

```bash
npm install
npm run convert karate_man     # needs the GitHub CLI (gh) logged in; writes public/gba/karate_man/
npm run dev                    # http://localhost:5185
```

- `?skin=diamond-star` plays as Diamond\*. `?song=diamond-gg` opens GG.
- The menu is song-first: search or pick a song (the originals, GG, or **+ Import song** / drag-and-drop an MP3/WAV), then pick a game. Every game has **Play** and **Auto** (autoplay). Imported songs auto-chart for Karate Man, Power Calligraphy and Young Stoner Life.
- `?manual&selftest` runs the timing and judgement checks.

## Docs

- [DOSSIER.md](DOSSIER.md): research and sources.
- [ADAPTING.md](ADAPTING.md): how the engine works, modding, auto-chart, adding a game.
- [guides/karate-man-character-modding-guide-1.md](guides/karate-man-character-modding-guide-1.md): the frame contract for replacement characters.

Custom Power Calligraphy characters (若 少 石 草 生, "Young Stoner Life") are generated from [KanjiVG](https://kanjivg.tagaini.net) stroke data, © Ulrich Apel, CC BY-SA 3.0 (`src/games/power-calligraphy/ysl/kanji-data.json`, made with `node tools/kanji-fetch.mjs`).

Fan project, not affiliated with or endorsed by Nintendo.
