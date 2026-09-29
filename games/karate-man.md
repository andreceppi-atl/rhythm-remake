# Karate Man (GBA): 1:1 spec

Source: `arthurtilly/rhythmtengoku` → `games/karate_man/{karate_man.bs, engine.c, macros.inc}`, `src/engines/karate_man.c`.
Units: tick (24/beat), frame (60 fps), px on a 240×160 screen. Fixed-point values are 24.8 (0x100 = 1.0).

> This is the **GBA** Karate Man: pots, rocks, soccer balls, bombs, light bulbs, and a flow meter. Fever's Karate Man adds kicks and barrels and has different visuals. We start with GBA because it's the version the decomp covers.

## Concept
Objects get tossed from the right toward Karate Joe in a pseudo-3D arc, growing as they approach. Press **A** on the beat they arrive to punch them away.

## Level

- Main: 120 BPM `karate_bgm` → 4 pattern subroutines → 150 BPM stretch → 140 BPM `karate_fan` section.
- Practice: 124 BPM `renshu_bgm1`. There's also `karate_man_2.bs`, the "serious" version.
- Mercy: 2. 35 inputs in the main level (marking criteria 0/1/2: 21/13/1). **Implemented** in `src/games/karate-man/`, with the chart played straight from the converted beatscript.

## Cues

Every cue: press A, **duration 24 ticks** (hit 1 beat after the toss), spawn SFX `f_boxing_fly_nml`, barely SFX `witch_donats`, fixed-frame windows.

| Cue id | Object | Hit window | Barely window | Hit SFX |
|---|---|---|---|---|
| 0x00 | Pot | ±3 f | ±5 f | `f_boxing_just_hati` (becomes `f_boxing_normal` at low flow) |
| 0x02 | Pot (strict) | ±1 f | ±3 f | same as pot |
| 0x04 | Rock | ±3 f | ±5 f | `f_boxing_just_rock` |
| 0x01 | Soccer ball | ±3 f | ±5 f | `f_boxing_just_ball` |
| 0x05 | Bomb | ±3 f | ±5 f | `f_boxing_just_bomb` |
| 0x08 | Light bulb | ±3 f | ±5 f | `f_boxing_just_light` |

These windows are much tighter than Power Calligraphy's (−24/+12). Karate Man's barely band is only ±5 frames.

## Object physics

**Incoming (not hit yet).** `p = runningTime / duration` in 24.8 fixed point, so `p = 1.0` at the ideal hit:

```
scale     = 1 / p                              (object grows as it approaches)
arcY      = 81 − 81·(p − 1)²                   (parabola peaking at p = 1)
x         = 120 + 36 / p
y         =  80 + (53 − arcY) / p
shadowY   =  80 + 53 / p
p > 1.5   → out of reach: Joe plays the miss reaction (36 ticks)
p > 2.0   → lands on the floor: "land" sfx, flow reset, object stays on the ground
despawn after 120 ticks
```

**Punched.** Simple Euler integration each frame: `vel += accel; pos += vel; rot += rotSpeed`. The object clamps to the shadow line on the floor and despawns when x > 272.

| Result | vx | vy | ay | spin/frame |
|---|---|---|---|---|
| Low-flow hit (pot, ball, bulb) | 0x400 (4 px) | −0x200 (−2 px) | 0x40 | −6 |
| High-flow hit (any) | 0x800 (8 px) | −0x200 | (unchanged) | −16 |
| Low-flow hit on rock/bomb ("ouch") | 0 | 0 | 0x20 (drops) | 10 static |
| Barely | 0x40 | −0x200 | 0x20 | 4 |

## Flow meter (0–5)

- A hit increments it. At **3+ = high flow**: the background palette switches to cycle 6→7, `score_up` sfx plays, and punches become the high punch.
- A barely decrements it. Dropping to 2 plays `score_down`.
- An object hitting the floor resets it to 0 (with `score_reset` sfx if it was high).
- At **low flow, punching a rock or bomb hurts**: an "ouch" anim and `boxing_hard` sfx, and it counts as a barely. High flow is required to break them cleanly.

## Karate Joe state machine

```
BEAT (idle bob every beat)   ← default on each beat_anim
  PUNCH_LOW / PUNCH_HIGH      on any press (empty press = air punch + punch sfx)
  SMUG_LOW / SMUG_HIGH        a hit while "use the face" is on
  PUNCH_OUCH                  low-flow rock/bomb
  timers replace the next beat anim:
    smirk  (36 ticks)  after a high-flow rock  + crowd "kansei" cheer
    happy  (108 ticks) after a high-flow bomb
    barely (36 ticks)  after a barely
    miss   (36 ticks)  object passed him, "nua" voice
```

A punch anim isn't interrupted by the beat bob until it's within 4 cels of its end.

## Hit effect
On any real hit, a star/impact sprite spawns at (158, 54).

## Versions
`KARATE_VER_NORMAL`, `KARATE_VER_FACES` (background face reacts: 1 = hit, 2 = ouch/barely, for 48 ticks) and `KARATE_VER_SERIOUS` (Karate Man 2: always high punch, red flash on hit).
