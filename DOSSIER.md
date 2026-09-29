# Rhythm Heaven Remake — Dossier

Goal: sprite-based recreations of Rhythm Heaven minigames. First match the originals 1:1 (timing, animation, physics, states), then restyle them around music acts with original art.

Research date: 2026-09-29.

---

## 1. The big find: the GBA game is fully decompiled

**[arthurtilly/rhythmtengoku](https://github.com/arthurtilly/rhythmtengoku)** is a complete, byte-matching decompilation of *Rhythm Tengoku* (GBA, 2006), the first game in the series. That gives us more than sprite rips. It gives us the **actual game logic**: every cue, hit window, tempo change, brush coordinate and sound trigger, as readable C and "beatscript".

That's how we can get **1:1 timing**. Where the decomp has a value, we don't guess, we copy it.

| What we get from the decomp | Where it lives |
|---|---|
| Level script (the "chart"): tempo, music, cue spawns, per-frame animation | `games/<game>/<game>.bs`, `subroutines.bs` |
| Cue definitions (hit/barely windows, SFX per result) | `games/<game>/engine.c` |
| Game logic (hit/barely/miss reactions, physics, NPC state machines) | `src/engines/<game>.c`, `include/engines/<game>.h` |
| Shared judge (input → hit/barely/miss, mercy, miss penalty) | `src/scenes/gameplay.c` |
| Animation cel tables | `games/<game>/graphics/*_anim.c`, `*_anim_cells.inc.c` |
| Sound names (MIDI sequences) | `audio/sequences/` |

The decomp includes these 30+ minigames under `games/`: bon_odori, bouncy_road, bunny_hop, clappy_trio, fireworks, **karate_man**, mannequin_factory, marching_orders, night_walk, ninja_bodyguard, polyrhythm, **power_calligraphy**, quiz_show, rap_men, rat_race, rhythm_tweezers, samurai_slice, showtime, sick_beats, sneaky_spirits, space_dance, spaceball, tap_trial, toss_boys, tram_and_pauline, wizards_waltz, remixes 1–8, and more.

Related projects:
- [Starpelly/rhythmtengoku-decompiled](https://github.com/Starpelly/rhythmtengoku-decompiled): a second decomp.
- [kibinago0/rhythmtengoku-pc](https://github.com/kibinago0/rhythmtengoku-pc): a native macOS/Windows build of the decomp. It needs your own ROM. Useful as a **side-by-side reference** to check our version against the real thing.
- [Nibbl-z/yanimator](https://github.com/Nibbl-z/yanimator): an animation editor for Rhythm Tengoku's animation format. Handy for viewing the original cels.
- [chrislo27/RhythmHeavenRemixEditor](https://github.com/chrislo27/RhythmHeavenRemixEditor) (RHRE): an older remix tool.

### Heaven Studio: gone
Heaven Studio was the big fan project recreating nearly every RH minigame on PC in Unity. Its GitHub repo **was DMCA'd by Nintendo on 2024-06-17** and now returns HTTP 451. Nintendo also [took down](https://www.videogameschronicle.com/news/nintendo-takes-down-fan-made-rhythm-heaven-remix-tool/) a remix tool. Takeaway in §5.

---

## 2. Sprite sheets (The Spriters Resource)

Rhythm Tengoku (GBA), [full index](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/). Relevant sheets:

| Game | GBA sheet | Fever (Wii) sheet |
|---|---|---|
| Power Calligraphy | [asset 606692](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/606692/) | [asset 55912](https://www.spriters-resource.com/wii/rhythmheavenfever/asset/55912/) (15 PNGs), [Korean ver. 125802](https://www.spriters-resource.com/wii/rhythmheavenfever/asset/125802/) |
| Karate Man | [asset 13170](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/13170/) | on the [Fever index](https://www.spriters-resource.com/wii/rhythmheavenfever/) |
| Rhythm Tweezers | [13172](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/13172/) | |
| Marching Orders | [13171](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/13171/) | |
| Night Walk | [90097](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/90097/) | |
| Samurai Slice | [99002](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/99002/) | |
| Spaceball | [89252](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/89252/) | |
| Tap Trial | [595504](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/595504/) | |
| Polyrhythm | [49618](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/49618/) | |
| Clappy Trio | [89270](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/89270/) | |
| Bon Dance | [69266](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/69266/) | |
| Toss Boys | [77273](https://www.spriters-resource.com/game_boy_advance/rhythmtengoku/asset/77273/) | |

Other indexes: [Fever (Wii)](https://www.spriters-resource.com/wii/rhythmheavenfever/), [Rhythm Heaven (DS)](https://www.spriters-resource.com/ds_dsi/rhythmheaven/), [Rhythm Tengoku Arcade](https://www.spriters-resource.com/arcade/rhythmtengoku/).

Downloaded (2026-09-29): `reference/rips/karate_man_gba.png` (130 KB) and `reference/rips/power_calligraphy_gba.png` (84 KB). The ripper recolored these, so they're **visual reference only**. The game renders straight from the decomp's tiles, palettes and OAM cels, which is exact. Local only, see §5.

**GBA vs Fever:** Power Calligraphy started on GBA (stage 4, game 3). Fever brought it back as an Extra Game (41 medals) with HD art. The decomp only covers GBA, so our **timing source of truth is the GBA script**. If you know it from Fever, the pattern will feel the same, but tempos and art details may differ a little. We should listen side by side before calling it 1:1.

---

## 3. How a Rhythm Tengoku minigame works (the engine model to copy)

Every minigame runs on the same engine, so we build this once and each game plugs into it.

**Time.** Everything is measured in **ticks: 24 ticks = 1 beat**. `set_tempo N` sets BPM. The engine runs at 60 fps, and `ticks_to_frames(t) = t × 150 / BPM`.

**Beatscript.** Each level is a linear script: `rest N` (wait N ticks), `call sub`, `set_tempo`, `play_music`, `play_sfx`, engine events (`power_calligraphy_set_brush`, etc.) and `spawn_cue`. In our version this becomes a data file (JSON) that a sequencer steps through against the audio clock.

**Cues.** `spawn_cue X` creates a pending input. Its `duration` (in ticks) is how far after spawning the player should press. So the ideal hit time is **spawn + duration**. Each cue definition has:
- `hitWindow` [early, late] and `barelyWindow` [early, late], **in 60fps frames** (unless the cue is tempo-dependent)
- callbacks: `spawn`, `update` (per frame), `hit`, `barely`, `miss`, `despawn`
- SFX for spawn, hit, barely and miss

**Judging** (`gameplay.c`, copied exactly):
1. On a press, look at every live cue and compute `offset = runningTime − duration`.
2. Outside the barely window → this cue ignores the press. Inside the hit window → **HIT**. Otherwise → **BARELY**. The closest cue wins.
3. If a press matches no cue, it's a stray press. It's logged as an "irrelevant input", the game's `inputEvent` runs (e.g. an empty punch), and a **miss-punishment timer** starts (12 ticks by default). While it runs, every hit window shrinks to [−1, +1] frame. Button-mashing is punished.
4. If a cue passes `duration + barelyLate` with no press → **MISS** and the `miss` callback runs.
5. **Mercy:** `gameplay_set_mercy_count(n)` turns the first *n* misses into barelies. Power Calligraphy sets n = 2.
6. Results use **marking criteria**. Each cue is tagged with a criteria ID, and the results screen checks the hit % per criteria to pick the comments ("You were late on the big strokes", etc.).

**Per-game state.** Each engine keeps a data struct (brush sprite, NPC states, timers) and gets `start`, `update` (every frame), `stop`, and numbered engine events that the script can fire.

---

## 4. Starter games

Picked for (a) fully decompiled and (b) the simplest input model: **one button, single-press cues**.

1. **Power Calligraphy**: your favorite. One button, 29 inputs, 3 tempo sections, and every brush and paper position is scripted. The hard part is animation playback, not physics. → [games/power-calligraphy.md](games/power-calligraphy.md)
2. **Karate Man**: the series mascot game. One button, with objects flying toward the player in a pseudo-3D arc (real physics), plus a flow meter and an NPC state machine. → [games/karate-man.md](games/karate-man.md)

Doing these two first covers both engine patterns: *scripted-animation* games (PC, Rhythm Tweezers, Tap Trial) and *physics-object* games (Karate Man, Spaceball, Toss Boys).

Good next candidates (all in the decomp): Rhythm Tweezers, Samurai Slice, Night Walk, Spaceball, Marching Orders.

---

## 5. Legal / distribution line (read this)

- Nintendo actively enforces here (Heaven Studio DMCA 2024, remix tool takedown).
- **Ripped sprites, music and SFX are local reference and placeholders only.** They go in `reference/rips/`, stay out of any repo or deploy, and are never shared publicly.
- What we *ship* is our own code, **original art** (the music-act restyle) and **original or licensed music**. Game mechanics and timing numbers aren't copyrightable art, but using Nintendo's names, characters, sprites or audio in a public build is the risk.
- Since you're at Atlantic, the restyle around real artists raises its own questions (likeness, audio licensing). Worth clearing before anything goes public.

---

## 6. Build plan

**Status 2026-09-29:** Phase 0 + Karate Man (GBA) done. Run it with `npm run dev`. See [ADAPTING.md](ADAPTING.md) for the pipeline and how to add Power Calligraphy next.


- **Phase 0, engine core:** audio clock (Web Audio, latency calibration), tick/beat sequencer, cue system + judge copied from §3, input handling, a debug overlay showing timing offsets.
- **Phase 1, Power Calligraphy 1:1:** placeholder sprites from the rips, script data from `reference/power-calligraphy-timeline.json` plus the per-kana animation tables, brush/paper/ink swirl/dancer states, results screen.
- **Phase 2, Karate Man 1:1:** object flight physics, Joe's states, flow meter, the object types.
- **Phase 3, restyle:** swap sprite atlases and music per act. The engine stays the same.

Stack suggestion: Phaser or plain Canvas + Vite (same setup as Webspun). The GBA screen is 240×160, so render at that size and scale up with integer pixel scaling for exact sprite coordinates.

---

## Reference files in this folder

- `reference/power-calligraphy-timeline.json`: all 29 player inputs with exact spawn/hit ms, tempo and music changes.
- `reference/parse.py`: dumps one subroutine's timing (tick/beat for every event).
- `reference/expand.py`: expands the full level into the ms timeline.

Both scripts read `.bs` files from the decomp. To refetch them:
`gh api repos/arthurtilly/rhythmtengoku/contents/games/power_calligraphy/subroutines.bs -H "Accept: application/vnd.github.raw" > subroutines.bs` (same pattern for `power_calligraphy.bs`).
