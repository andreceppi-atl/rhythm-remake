# Karate Man Character Modding Guide 1

**Replacing Karate Joe: brief and output contract for an image-generation model**

Contract version 1 · Game: Karate Man (Rhythm Tengoku, GBA) · Character slot: `karate_man/joe` · 35 frames

---

## Part A: For you (the person running the model)

**What to send the model:** this whole document, plus the per-frame images for whatever you're generating in that session (from `reference/specs/karate_man/joe_frames/`; run `npm run spec karate_man` first if the folder is missing):

- `celNNN_guide.png`: the exact canvas with the original silhouette in grey, the bounds, the ground line and the anchor. **This is the layout to match.**
- `celNNN_original.png`: the original pose in full detail (transparent background). **This is the pose to copy.**

**Fill in the Character Brief (B1) before sending.** Everything else is fixed.

**Recommended order** (keeps the character consistent):

1. Frame `cel000` alone, iterating until the design is right. This becomes the master.
2. The rest of the standing group (001–014, 027–030), always attaching your approved `cel000` as the identity reference.
3. The punch groups (015–026, 031–034).

**Where results go:**

```
public/skins/<skin-id>/
  skin.json          ← copy guides/skin.template.json and fill it in
  joe/cel000.png
  joe/cel001.png
  ...
  joe/cel034.png
```

**Check them:**

```bash
node tools/check-skin.mjs public/skins/<skin-id>
```

Errors (wrong canvas, opaque background, missing frames) must be fixed. Warnings mean a pose drifted from the original's footprint. Fix those if the timing reads wrong in-game.

**Style decision still open:** B3 has two tracks, pixel and HD. Pick one and delete the other before sending. The in-game loader supports both on this same canvas.

---

## Part B: Instructions for the image model

You are drawing replacement frames for the player character of a rhythm game. The game places each frame by a fixed anchor point and plays them as animation, so **layout rules are strict and identical on every frame**. Creative freedom is in the character design only.

### B1. Character brief *(filled in by the requester)*

```
Name / who it is:        ______________________
Look (face, hair, build): ______________________
Outfit (replaces the white karate gi):  ______________________
Signature colours (max 3 + outline):     ______________________
Must keep:               ______________________
Must avoid:              ______________________
Mood / attitude:         confident, playful, a little cocky (matches the original)
```

The character is a **martial artist punching objects that fly at them from the right**. Keep a clear fighting stance, visible fists, bare feet or shoes, and a flat oval shadow under the feet.

### B2. Output contract (hard rules, every frame)

| Rule | Value |
|---|---|
| File | PNG, 8-bit RGBA, non-interlaced, one frame per file, named `celNNN.png` |
| Canvas | **exactly 492 × 572 px** (do not crop, pad or resize) |
| Background | **fully transparent** (alpha 0). No white, no floor, no scenery |
| Facing | Character faces **right** (toward +x), body in 3/4 view like the original |
| Anchor | The character's **belt / centre of hips** sits at pixel **(132, 312)**. This is the point the game moves around |
| Ground | The bottom of the feet and shadow touches **y = 556**. Nothing below it |
| Footprint | Stay close to the original frame's bounds (blue box in the guide). The back edge is at x ≈ 16–20 on every frame |
| Impact point | The flying object is hit at canvas **(436, 168)**. High-punch fists (frames 019/020) must reach it; low jabs (015, 024–026, 031) stop at x ≈ 396 |
| Content | One character only. No text, labels, grid, guide lines, borders or watermarks |
| Consistency | Same character, proportions, line weight and palette on every frame. Only what the frame table says changes |

The guide image shows all of the above: grey silhouette = original pose, blue box = bounds, green line = ground, red cross = anchor. **Do not draw the guide marks.**

### B3. Style track *(requester keeps ONE)*

**Track P: Pixel art (faithful).** The game shows this canvas at ¼ size (123 × 143 px), so draw on a **4 × 4 px grid**: every "pixel" is a 4×4 block, and the outline is one block (4 px) wide. Use hard edges only: no anti-aliasing, gradients or soft shadows. Stick to a small palette of about 4–8 flat colours, and make the outline black or a very dark colour. The body should be about 62 × 126 game pixels, like the original.

**Track H: HD illustration (modernised).** Clean vector-like line art with a consistent outline weight (about 6–8 px) and flat or two-tone cel shading. Transparent edges may be anti-aliased. It must still read clearly at ¼ size: strong silhouette, big readable fist and face, no fine texture.

**Both tracks:** the background behind the character is bright yellow (`#ffe76b`) with orange-yellow stripes (`#ffc652`) during combos, so the character needs a dark outline and must not be mostly yellow. Keep the fist a distinct, bold shape. The punch is the most important read in the game.

### B4. The frames

Coordinates are canvas pixels (left, top → right, bottom). Bottom is always 556 (the ground).

**Idle "bob":** every animation below starts on its lowest frame and springs up. Within a triple the body is **the same drawing**. The upper body sits **0 / 4 / 8 px lower** on frames X0 / X1 / X2 with the feet fixed, like a small knee-bend on the beat.

| Frames | Pose (copy `celNNN_original.png`) | Face / detail | Box (L,T → R) |
|---|---|---|---|
| **000**, 001, 002 | **Master stance.** 3/4 view facing right, knees slightly bent, front fist up at chest, rear fist tucked, feet apart, oval shadow | Neutral, focused, mouth closed | 16,52 → 264 (001: T56, 002: T60) |
| 003, 004, 005 | Master stance | **Worried.** Knitted brows, wobbly frown (after a sloppy "barely" hit) | as 000–002 |
| 006, 007 | Master stance | **Stunned.** Blank eyes, small open "o" mouth (something got past) | as 000–001 |
| 008 | Master stance | Stunned face plus a **jagged shock burst** of spiky lines around the head | 16,**16** → 264 |
| 009, 010, 011 | Master stance | **Smirk.** Narrowed eyes, one-sided grin (after smashing a rock) | as 000–002 |
| 012, 013, 014 | Master stance | **Big happy grin, closed eyes, round blush on cheeks** (after smashing a bomb) | as 000–002 |
| 027 | Master stance, shoulders slightly slumped | **Sad.** Droopy eyes, frown, deflated hair (optional, unused in-game) | 16,68 → 264 |
| 028, 029, 030 | Master stance | **Smug.** Half-lidded eyes, raised brow, self-satisfied closed smile | as 000–002 |
| **015** | **Low jab, full extension.** Front arm straight out at shoulder height, rear fist at chest | Neutral/focused | 16,68 → **396** |
| 016 | Jab arm pulling back, elbow bending | same | 16,64 → 352 |
| 017 | Arm further back | same | 16,60 → 324 |
| 018 | Fist almost back at the chest | same | 16,60 → 280 |
| 031, 032, 033, 034 | Same as 015 / 016 / 017 / 018 | **Smug** face (as 028) | same boxes as 015–018 |
| **019** | **Power punch.** Whole body lunges forward, torso nearly horizontal, head low, front arm fully extended, **fist on the impact point (436,168)** | Determined | 20,76 → **476** |
| 020 | Identical to 019 **plus 3–4 speed lines** streaking along the arm | Determined | 20,76 → 476 |
| 021 | Recovering: body upright again, punching arm still forward but bent | Determined | 16,56 → 384 |
| 022 | Guard: both fists raised in front of the face | Determined | 16,60 → 312 |
| 023 | Settling back toward the master stance, fists at chest | Neutral | 16,60 → 272 |
| **024** | Low-jab extension (like 015) but the **fist is red and swollen** from hitting something too heavy | **Pained** grimace, jagged shock burst around the head | 16,**20** → 396 |
| 025, 026 | Same as 024 without the burst | Pained. The two frames **alternate rapidly** (throbbing), so make them differ slightly (fist size, wince) | 16,68 → 396 |

### B5. How the frames are used (so poses read right)

Durations are at 60 fps. The key frame of a hit is shown **first and very briefly**, so it must read instantly.

| Animation | Frame sequence (ms) | When it plays |
|---|---|---|
| `joe_stand` | 000 (400) | Idle before the first beat. |
| `joe_beat` | 002 (50) → 001 (50) → 000 (400) | Every beat: a small bob, then holds. |
| `joe_punch_low` | 015 (67) → 016 (33) → 017 (33) → 018 (33) → 002 (17) → 001 (17) → 000 (667) | Normal hit before the combo meter is high. |
| `joe_punch_high` | 020 (17) → 019 (50) → 021 (33) → 022 (33) → 023 (33) → 002 (17) → 001 (17) → 000 (250) | Hit during a combo, or a sloppy hit. |
| `joe_punch_ouch` | 024 (50) → 025/026 alternating ×5 (33 each) → 026 (333) | Punching a rock or bomb without a combo: it hurts. |
| `joe_smug_low` / `joe_smug_high` | 031–034 / 020–023, then 030 → 029 → 028 | Same as the punches while "smug mode" is on. |
| `joe_barely` | 005 (50) → 004 (50) → 003 (400) | Idle after a sloppy hit. |
| `joe_miss` | 008 (50) → 007 (50) → 006 (400) | Idle after an object got past. |
| `joe_smirk` | 011 (50) → 010 (50) → 009 (400) | Idle after smashing a rock. |
| `joe_happy` | 014 (50) → 013 (50) → 012 (400) | Idle after smashing a bomb. |
| `joe_sad` | 027 | Unused. |

### B6. Don'ts

- Don't change the canvas size, crop to the character, or centre the character. Position comes from the anchor.
- Don't add a background, floor, frame, text or the guide marks.
- Don't turn the character to face left or toward the camera.
- Don't let the feet float above or sink below y = 556.
- Don't redesign the character between frames. Frame 000 is the model sheet.
- Don't add motion blur except the speed lines on 020.

---

## Part C: Reference (for tools and future guides)

- Machine-readable spec: `reference/specs/karate_man/spec.json` → `groups.joe.frame` = `{ scale: 4, w: 492, h: 572, anchorX: 132, anchorY: 312 }`, and per-frame original bounds under `groups.joe.cels`.
- In game terms (1×): Joe's anchor is screen pixel (80, 88) on the 240×160 screen; the frame canvas is 123×143 with the anchor at (33, 78).
- Timing, hit windows, physics and colours live in `src/games/karate-man/tuning.ts` / `public/mods/karate_man.json`, never in the art.
- Future guides: **2** props (pot, rock, ball, bomb, bulb, shadow, impact flash), **3** HUD (flow meter, prompts), **4** background. Same contract style: fixed canvas, fixed anchor, transparent background.
