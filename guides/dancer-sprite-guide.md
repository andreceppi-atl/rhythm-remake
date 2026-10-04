# Young Stoner Life — Dancer Sprite Guide (4× source art)

This is the art brief for Diamond\* and Tezzus. The project’s canonical artwork is authored and delivered at **4× source resolution**. Claude can then cut the source art into parts and rig it on the 34 original poses while keeping the game's frame timing.

## Approved character and animation direction

`guides/dancer-template/dancers-highres-reference.png` is the authoritative design reference. Draw each pose as its own frame, using the original pose sequence and preserving the approved character designs and pixel-art language. Do not animate a single flattened character by rotating, squashing, or bouncing it. Keep the two artists in separate source sheets and never transfer facial features or clothing between them. Current frame artwork is collected under `guides/dancer-template/generated/`.

## 1. What to deliver

- Two character-exclusive pose sets, 17 cels each: Tezzus cels 0–16, then Diamond* cels 17–33. Each set follows the original sequence: dance ×9, bow ×6, fall ×2. Export each isolated sequence as `public/skins/diamond-star/calligraphy/tezzus@4x.png` and `diamond-star@4x.png`, with matching 1× sheets and `character-sheets.json`.
- Pack the 34 original cels into `public/skins/diamond-star/calligraphy/dancers@4x.png` (224×184 pixels per cel), plus the 1× runtime sheet and matching cell metadata. Preserve the original cel names, anchors, and frame timing.
- Every pose is a separately drawn figure. Keep a consistent ground anchor and character scale; fit wide kneeling/fall poses inside the same cell without clipping.

If you only do #1, I'll cut the parts myself; #2 gives a cleaner result.

## 2. Canvas and scale

The game screen is **240 × 160**. The dancer lives in a **56 × 46 game-pixel cell**; the anchor (where the game positions the sprite) is at **(28, 42)** — centre between the feet, on the ground line.

| | game pixels |
|---|---|
| Target height (feet to top of hair) | **30–32** (original dancers: 28) |
| Width in the base pose | ≤ **28** comfortable, **40** absolute max |
| Head (face + hair) | ~**10–12** wide — big heads read best at this size |
| Limb thickness incl. outline | 4–5 |

Use `guides/dancer-template/dancer-template_8x.png` as the canvas: it is the cell at 8×, red = ground line + anchor + centre, green = original height (28), blue = max height (32) and comfortable width, grey = max width.

**Canonical source: exactly 4× (224×184 per cell).** The project also exports a 1× runtime-compatible sheet. Preserve the approved detailed pixel-art rendering and bold outline; keep final sprite transparency hard-edged and inspect both the 4× sheet and 1× game scale.

## 3. Style rules

- Preserve the approved bold pixel-art contours, clustered texture, and strong costume-color blocks. No painterly, vector, 3D, or unrelated renderer.
- Export sprites on transparent backgrounds with crisp edges and no glow or stage lighting. Keep the silhouettes readable at 1×.
- Don't force a reduced palette if it damages the approved designs; consistency and identity take priority.

## 4. Character notes

**Diamond\*** — the male YSL rapper. Dark skin; dark locs/dreads bundled on top with a red tie and locks hanging at the sides; dark rectangular sunglasses; oversized cream sherpa fleece with red zip/piping and red cuffs; white tee; baggy dark-blue jeans; black Vans with white soles. Keep the front chest plain (no stripe or logo). On back-facing poses, match the user-provided reference: a vertical dark-green/red/dark-green stripe down the cream fleece, with a gold oval Gucci Double-G emblem centered over it. Nine silver/white facial piercings, all present and consistent: **3 descending down the centre of the forehead, 1 on each cheekbone, 1 on each dimple, 1 at each bottom corner of the mouth** (one clear game-pixel mark each at 1×).

**Tezzus** — big loose curly locs, dark shield sunglasses, clean face with no facial piercings, red leather scale-mail jacket (spiky shoulder scales), white tank, silver chain, ripped light-blue jeans, red high-tops, hand tattoos (dark marks on the backs of the hands). No tied-up red hair tie.

## 5. Completion check

- Validate that each original cel has one pose-specific drawing, the correct artist, and the correct front/back view.
- Export the 4× and 1× atlases without changing original timing, then run the project checks and watch the in-game preview through dance, bow, and fall sequences.

Reference: `guides/dancer-template/current-gba-chibi-frames_1x.png` shows the 1× silhouette reference, in the order of the 34 original cels. Final artwork is the 4× source sheet.
