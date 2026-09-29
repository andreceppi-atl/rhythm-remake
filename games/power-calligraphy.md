# Power Calligraphy (習字 / "shuji"): 1:1 spec

Source: `arthurtilly/rhythmtengoku` → `games/power_calligraphy/{power_calligraphy.bs, subroutines.bs, engine.c, macros.inc}`, `src/engines/power_calligraphy.c`, `include/engines/power_calligraphy.h`.
Every number below is copied from those files. Units: **tick** (24 per beat), **frame** (60 fps), **px** (GBA 240×160 screen).

## Concept
A calligrapher paints characters. The script animates most of each stroke. At the climax of each character, the brush charges up with a strained "funuue!" voice and the player presses **A** exactly one beat later to finish the power stroke. There's one button, and every input is the same kind of cue.

## Level structure (main script)

| Section | BPM | Music | Characters in order |
|---|---|---|---|
| Intro | 127 | `shuji_bgm1` | ~9 beats of text, then practice-free start |
| Part 1 | 127 | `shuji_bgm1` | RE, COMMA, RE, CHIKARA, RE, COMMA, RE, ONORE, CHIKARA, ONORE, RE, SUN, CHIKARA, ONORE, COMMA, KOKORO |
| Part 2 (dancers appear) | 161 | `shuji_bgm2` | RE, COMMA, CHIKARA, SUN, RE, COMMA, ONORE, KOKORO |
| Finale | 98 | `shuji_bgm3` | FACE (long drawing, 1 input) |
| Outro | 98 | `shuji_bgm_end` | End kanji shown, dancers bow |

**29 player inputs total.** Exact ms timeline: [`../reference/power-calligraphy-timeline.json`](../reference/power-calligraphy-timeline.json).

Between characters, `remove_paper` slides the finished sheet away (velocity −4, −8 px/frame, slow version 0, −1). Then `sub_<kana>_init` sets up the blank sheet and a raised brush for 1 beat before the character's subroutine runs.

Practice (skippable, 140 BPM, `mario2` music): loops RE until it's hit cleanly, then loops COMMA. A barely or a miss calls `beatscript_enable_loops()`, which makes the practice loop repeat.

## Character patterns

Each subroutine is **7 beats (168 ticks)**, except FACE at 15. Beat 0 = subroutine start. **HIT** = when the player presses.

| Kana | Scripted part | Voice/charge | Cue spawn → **HIT** | Input stroke(s) |
|---|---|---|---|---|
| **RE** (レ) | b0 "ho!" voice, brush raised; b2 brush down; b2.96–3.04 swipe (`swing1`) | b4 `funuue` + charge | b5 → **b6** | RE1 |
| **COMMA** (、) | b0 "ha", b2 "ha", b3 "ha", b4 "ha(3)": brush bounces 2 px each time | b5 comma-charge + `rabbit_break2` sfx (vol 160, pitch −512) | b5 → **b6** | COMMA1 |
| **CHIKARA** (力) | b0–b1 first stroke (sfx start/swing1/swing2); b2 lift (`furi`); b3 brush down | b4 `funuue` + charge | b5 → **b6** | CHIKARA2 |
| **ONORE** (己) | b0–b4.25: 3 scripted strokes (start/furi/furi/start/swing1/swing2) | b4 `funuue`, charge at b4.25 | b5 → **b6** | ONORE1 |
| **SUN** (寸) | b0–b1.6 two strokes | b2 `funuue` + charge | b3 → **b4**, then comma-charge b5 → **b6**; brush lifts 24 px at b6.5 | SUN1, SUN2 |
| **KOKORO** (心) | b0 hook stroke; b1 `funuue` + stroke; b1.5 charge | b1.5 charge | b2 → **b3**; b4 dot (start), b4.5 lift; comma-charge b5 → **b6** | KOKORO1, KOKORO3 |
| **FACE** (finale) | b3.9–b12 ~30-cel scripted face drawing | b12 `funuue` + charge | b13 → **b14** | FACE1 |

The full per-tick breakdown (every `set_kana_cel`, brush x/y, paper offset, sfx) can be regenerated with `python3 reference/parse.py subroutines.bs re comma ...`. This is the animation timeline to copy frame-for-frame.

Rhythm feel: the cue is always **one beat after the charge starts**, and the charge follows the "funuue" voice. Players are really reacting to *voice → (1 beat) → charge → (1 beat) → HIT*.

KOKORO_INPUT2 exists in the tables but is **unused** (event 0x05 `finish_input_kokoro2` auto-completes it).

`subroutines.bs` also has `sub_swing_*` variants of every character (swung timing). The remixes use them.

## Cue definition (the only cue)

```
Input:          press A
Duration:       24 ticks  (hit target = spawn + 1 beat)
Hit window:     -4 .. +4 frames   (±66.7 ms)
Barely window:  -24 .. +12 frames (−400 ms .. +200 ms)
Tempo-dependent: no (windows are fixed frames at every BPM)
Miss SFX:       f_shuji_v_nuahaha  (the calligrapher laughing?)
Auto-despawn:   runningTime > ticks_to_frames(48)
Mercy:          first 2 misses become barelies
```

## Result reactions

**On any hit or barely** (`express_input`): stop the `funuue` voice. Spawn the stroke sprite `<stroke>_input` at (120, 84) on the paper layer with **cel = timing type** (0 = hit, 1 = early, 2 = late). That's 3 pre-drawn versions of every stroke: clean, early-smudged, late-smudged. Then move the brush to the table position below.

**HIT:** play the hit SFX and shove the paper by −paperMotion (the "impact" jolt).
**BARELY:** play the barely voice and make the dancers **stumble** for 48 ticks. No paper jolt.
**MISS:** set the brush sprite's playback to −1, which runs the charge anim backwards (TODO: confirm against the real game), and play the miss laugh.

| Stroke | Hit SFX | Barely SFX | Paper jolt (x,y) | Brush hit (x,y,cel) | Brush early | Brush late |
|---|---|---|---|---|---|---|
| ONORE1 | sword_orya | v_nuaa | 0,−8 | 31,−30,0 | 65,−14,0 | 36,−7,0 |
| CHIKARA1 | sword_orya | v_nuaa | −6,−6 | 1,−22,0 | −11,28,0 | 19,−4,0 |
| CHIKARA2 | sword_orya | v_unuu | −4,8 | −61,43,0 | −46,40,0 | 3,−54,0 |
| SUN1 | sword_orya | v_nuaa | −4,−6 | −14,−15,0 | −19,−8,0 | 9,6,0 |
| SUN2 | sword_hi | v_ouch | 4,4 | 1,−7,1 | 2,−8,1 | 6,−18,1 |
| KOKORO1 | sword_orya | v_nuaa | −4,−6 | 29,−40,0 | 76,−30,0 | 51,−22,0 |
| KOKORO3 | sword_hi | v_ouch | 6,6 | 44,−36,1 | 60,−32,0 | 38,−51,1 |
| RE1 | sword_orya | v_nuaa | 6,−6 | 39,−29,0 | 30,−14,0 | 17,−8,0 |
| COMMA1 | sword_hi | v_ouch | 5,6 | 12,−4,1 | 35,−6,0 | 20,−10,0 |
| FACE1 | sword_orya | v_unuu | 6,−1 | 32,−11,0 | 10,81,0 | 0,14,0 |

Brush positions are offsets from (120, 84). Cel 0 = raised, 1 = down. The paper jolt is applied negated to the paper layer's scroll.

## Visual components and state

- **Paper layer** (BG2): scroll offset is nudged by every `offset_paper` event. The kana sprite, brush and stroke sprites are all parented to it, so they shake together. On `remove_paper`, the finished sheet is copied to BG1 and flies away while BG2 resets to (0, 0).
- **Kana sprite:** one animation per character. `set_kana_cel n` steps through the pre-drawn progress frames (onore 0–15, face 0–30, …).
- **Brush:** 2 cels (raised/down) plus `brush_charge1` (stroke) and `brush_charge2` (comma) anims.
- **Charge effect:** a palette fade on OBJ palette 11 (pal[11] → pal[12] over 12 ticks on start, pal[13] → pal[11] on end). The brush glows.
- **Ink swirl:** 30 dots orbiting the brush on random angles/speeds with a sine distance profile. Defined but **not used in the main level** (remix-only).
- **Little people (dancers):** 2 columns × 6 (alternating M/W types). M column at x=32, W column at x=216, spaced 32 px vertically.
  - `DANCE` (from part 2): the columns scroll in opposite directions at 32/256 px per frame, wrap every 192 px, and flip the L/R dance anim every beat.
  - `STUMBLE`: on a barely, play the fall anim for 48 ticks, then return to the previous state.
  - `BOW` / `END_BOW`: finale and outro.

## Results (marking criteria)

| ID | Used for | Rule |
|---|---|---|
| 0 | RE, COMMA, ONORE, SUN | negative if < 50% hits or > 30% misses |
| 1 | CHIKARA | positive at 100%, negative < 30% |
| 2 | KOKORO | positive at 100%, negative < 50% |
| 3 | FACE | positive at 100% |

## Player state machine (for our implementation)

```
IDLE (brush raised, waiting)
  → SCRIPTED (script drives kana cel + brush + paper)
  → CHARGING (charge anim, "funuue" voice, glow on at spawn)
  → cue window open: [target−24f, target+12f]
      press in ±4f       → HIT    (clean stroke, jolt, sword sfx)
      press elsewhere in → BARELY (smudged early/late stroke, grunt, dancers stumble)
      window passes      → MISS   (charge rewinds, laugh)
  → glow off 1 beat after target → paper removed → next kana
```

## Open questions for 1:1

- Fever (Wii) vs GBA: compare tempos and the pattern order by ear. The Fever sheet has 15 PNGs.
- What exactly `sprite_set_playback(-1)` looks like on a miss. Check in the rhythmtengoku-pc build.
- Audio: sequences are MIDI + GBA samples. For placeholders, record from a legit build; for the restyle, write new stems.
