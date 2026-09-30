# Adding a game

The engine is game-agnostic. A new minigame is **convert its data + write one module**. Charts are never hand-ported.

## Running

```
npm install
npm run convert karate_man            # decomp -> public/gba/karate_man/ (needs `gh` logged in)
npm run dev                           # http://localhost:5185  (preview config: rhythm-heaven)
```

URL flags: `?debug` (timing overlay), `?autoplay=0` (press every cue at +0f; any number = offset in frames), `?manual&selftest` (virtual clock + judge/timeline checks), `?play=<scene>` (start immediately).

`decomp-cache/`, `public/gba/` and `reference/rips/` hold Nintendo-derived data. They're gitignored and local only. Never commit or deploy them.

## Modding a game (no code)

- **Numbers, names, colours, text:** every constant lives in `src/games/<g>/tuning.ts`, and the defaults are the GBA values. Copy `public/mods/karate_man.example.json` to `public/mods/karate_man.json` and reload. Any key you set there overrides the default; everything else stays 1:1. The example widens the hit windows, makes high-flow punches fly further, lowers the flow threshold, recolours the background and gi, and changes a line of text.
- **Tempo and chart** come from the level script, not tuning. Changing BPM means new music plus a new chart (a later "custom level" format).
- **Art:** `npm run spec karate_man` writes `reference/specs/karate_man/`: reference sheets, onion-skin and blank templates (1x/4x), `spec.json` and `SPEC.md`, with the grid, anchor points, per-frame bounding boxes, animation timings and triggers. Replacement sheets on that grid are what the upcoming skin loader will consume.

## Imported songs (auto-chart)

Menu → **+ Import song**, or drop an MP3/WAV/M4A on the page. `src/autochart/` does the rest:
- `analyze.ts`: onset envelope (log-spectral flux), tempo (autocorrelation + fine BPM/phase search), downbeat (kick energy), loudness per bar. Assumes a steady tempo. Tested at 94–150 BPM within ±5 ms, and on `karate_bgm` at 119.99 BPM, 0.3 ms off.
- `chart.ts`: Karate-Man-feel charts: 4-bar phrases by loudness and difficulty, quiet bars rest, a bomb on section drops, rocks on loud downbeats, bulbs on offbeats.
- `level.ts`: chart → beatscript, so the normal engine, judge and results run it.

The import panel has ÷2 / ×2 BPM, ±10 ms offset nudges, Easy/Normal/Hard, **Play**, and **Save chart** (JSON). To replay a saved chart as-is instead of regenerating, drop the audio together with its `.chart.json`. The audio never leaves the browser.

A skin's `skin.json` can carry a `tuning` block (theme, colours, text) that's merged over the game's tuning. That's how `?skin=diamond-star` gets its own title and lavender world.

## Pipeline

```
decomp (arthurtilly/rhythmtengoku)
  games/<g>/*.bs + macros.inc  ─┐
  include/engines/<g>.h (enums) ├─ tools/convert-game.mjs ─> public/gba/<g>/level.json   (scripts as primitive ops)
  games/<g>/graphics/*          │                            gfx.json + *.4bpp/.tilemap (cels, anims, palettes)
  games/<g>/*_text.c            │                            text.json
  audio/* (headers, banks)     ─┘                            sound.json + midi/ + samples/
                                           │
src/engine/runtime.ts ── sequencer.ts (beatscript) ── gameplay.ts (cue judge) ── results.ts
        │                                   │
        ├─ gba/ppu.ts + gba/sprites.ts  (renders decomp cels/BGs/palettes 1:1)
        ├─ audio/sound.ts               (decomp MIDI + samples + ADSR)
        └─ games/<g>/index.ts           GameModule: engine events, cues, physics, NPC states
```

## Checklist for game `<g>`

1. `npm run convert <g>` and check the printed counts plus any `missing:` line.
2. Read `games/<g>/engine.c` (cue definitions, gfx table, engine-event table) and `src/engines/<g>.c`.
3. Create `src/games/<g>/index.ts` implementing `GameModule` (`src/engine/runtime.ts`):
   - `engine`: the decomp symbol, e.g. `power_calligraphy_engine`.
   - `start(rt, version)`: replay the graphics table (`ppu.loadBgTiles/loadObjTiles/loadPalettes` at the same VRAM offsets), set `ppu.layers[n]` from `scene_set_bg_layer_display` (char block × 0x4000, screen block × 0x800), then create sprites exactly as in `*_engine_start`.
   - `cueIndex`: one `CueDef` per entry in `<g>_cue_index`, with duration, hit/barely windows, SFX and callbacks.
   - `engineEvent(id, param)`: the `<g>_engine_events[]` table in order.
   - `commonEvent(0 beat anim | 1 display text | 2 init tutorial)` and `inputEvent()` for stray presses.
   - Keep the fixed-point 24.8 math and constants verbatim. Karate Man shows the pattern.
4. Register it in `src/main.ts` (`rt.register(new X())`) and add it to the song-first menu: an entry in `ORIGINALS` in `src/main.ts` (its scenes from `level.scenes`), and a row in `audioGames()` if it can play imported songs.
5. English text: add a `text-en.ts` keyed by the `D_xxxxxxx` labels and assign it to `rt.translations`.
6. Verify (below).

### Mapping cheat-sheet (decomp → port)

| decomp | port |
|---|---|
| `sprite_create(h, anim, cel, x, y, z, dir, loopCel, flags)` | `rt.sprites.create(anim, cel, x, y, z, dir, loopCel, flags)` |
| `sprite_set_anim(h, s, anim, cel, dir, loopCel, type)` | `rt.sprites.setAnim(s, anim, cel, dir, loopCel, type)` |
| `sprite_set_origin_x_y(h, s, &BG_OFS[n].x, &BG_OFS[n].y)` | `s.origin = rt.ppu.layers[n]` (the sprite follows the BG scroll) |
| `sprite_set_base_tile / base_palette` | `s.baseTile / s.basePalette` |
| affine scale param `p` (0x100 = 1) | `s.affine = { scale: 0x100 / p, angle }` |
| `ticks_to_frames(t)` | `rt.ticksToFrames(t)` |
| `play_sound(&s_x_seqData)` | `rt.playSound('s_x_seqData')` |
| `stop_sound(&s_x_seqData)` | `rt.stopSound('s_x_seqData')` |
| `gameplay_ignore_this_cue_result()` | `rt.gameplay.ignoreThisCueResult = true` |
| `beatscript_enable_loops()` | `rt.sequencer.loopsEnabled = true` |
| `gameplay_get_last_hit_offset()` | `rt.gameplay.lastHitOffset` (frames) |
| `set_pause_beatscript_scene(TRUE)` | `rt.setScriptPaused(true)` |
| `palette_fade_to(...)` | write `rt.ppu.objPal / bgPal` each frame (not yet a helper) |

## Verifying a port

- **Judge:** `?manual&selftest` runs the autoplay offset matrix. Add the game's windows to `src/selftest.ts` (e.g. PC: hit ±4, barely −24/+12).
- **Timing:** the self-test already checks the sequencer against `reference/power-calligraphy-timeline.json`. Generate the same file for a new game with `reference/expand.py`.
- **Visual:** in `?manual`, step with `__rh.rt.step()`, call `__rh.rt.render(canvas ctx)`, and screenshot. Compare against the rip sheet in `reference/rips/`.
- **Feel:** play it with sound. Use Calibrate if presses read consistently early or late.

## Next: Power Calligraphy (pre-assessed)

Data is already converted (`npm run convert power_calligraphy`: 34 scripts, 207 cels, 43 anims, 22 songs). The self-test proves the sequencer reproduces its 29 cue times to <1 ms. What the module needs, from `src/engines/power_calligraphy.c`:

| Piece | Engine support |
|---|---|
| Paper = BG layer 2 whose scroll is nudged by `offset_paper`; kana, brush and stroke sprites use `origin` = layer 2 | ✅ `s.origin` + `ppu.layers[2].x/y` |
| Finished sheet flies off on BG1 (`remove_paper`, velocity −4/−8 or 0/−1 per frame) | ✅ layer scroll per frame |
| Second OBJ tileset (dancers) at `OBJ_TILESET_BASE(0x5800)`, dancers use base tile 0x2C0 | ✅ `loadObjTiles(data, 0x5800)` + `baseTile` |
| Brush glow = palette fade of OBJ palette 11 over 12 ticks | ⚠️ add a small `ppu.fadePalette(slot, from, to, frames)` helper |
| Ink swirl (30 orbiting dots) | remix-only, skip for v1 |
| Stroke sprites spawned with cel = 0 hit / 1 early / 2 late | ✅ plain sprites |
| One cue type: 24 ticks, hit ±4f, barely −24/+12f, miss sfx laugh, mercy 2 | ✅ |
| Prologue title card | ✅ generic `PrologueCard` |

Estimate: one focused session. Spec: [games/power-calligraphy.md](games/power-calligraphy.md).

### Other candidates (all decompiled, all single-button)

- **Rhythm Tweezers**: scrolling vegetable BG plus pulled-hair physics (sprites on a rotating layer, so it needs affine BG or a sprite workaround).
- **Samurai Slice**: demon spawn/arc like Karate Man's objects; reuses the same patterns.
- **Night Walk**: platform jump plus the balloon/fall state machine; also uses a scrolling BG.
- **Spaceball**: 3D-ish ball flight like Karate Man plus camera zoom (affine BG).
- **Marching Orders**: two buttons plus directions. First game needing `buttonFilter` per cue (hit windows are already per cue).

Remixes switch engines mid-script (`load_game`). `run2 gameplay_set_current_engine` already swaps modules, so remixes work once every engine they use is ported.

## Restyle hook (later)

Art and sound are addressed by name (`anim_karate_joe_punch_high`, `s_f_boxing_just_hati_seqData`), never by file. A skin can replace the GBA renderer with an atlas renderer keyed by the same anim/cel names, and swap `sound.json` banks, without touching game modules.
