# Young Stoner Life — Dancer Sprite Guide 1 (base sprite)

Hand this to whoever (or whatever model) draws the art. It covers **one base sprite per character** (Diamond\* and Tezzus). Claude takes it from there: cuts it into parts, rigs it on the 34 original poses, and keeps the game's frame timing.

## 1. What to deliver (per character)

1. **`<name>_base.png`** — the character standing **front-facing, neutral**: arms slightly out from the body (hands clear of the torso, ~15° down from horizontal), legs a little apart, feet flat. Nothing overlapping, so every limb can be cut out cleanly.
2. **`<name>_parts.png`** *(strongly preferred)* — the same character split into separate pieces on one transparent sheet, with space between them:
   - head with hair (front) · head with hair (turned left) · head (turned right, can be a mirror)
   - torso (with jacket/top) · neck if visible
   - upper arm ×2 · forearm ×2 (sleeve cuff included) · hand ×2 (an open mitt and a fist if you can)
   - thigh ×2 · shin ×2 · shoe ×2 (side view, toe pointing outward)
   - back hair / dreads that hang behind the head, as its own piece
   - optional: a **back-of-head** (for the bow and lying-down poses)
3. Optional: **face variants** on the head (eyes closed, mouth open) — used on bows and falls.

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

**Deliver at exactly 1× (56×46) or exactly 8× (448×368)** — at 8× every game pixel must be a clean 8×8 block (nearest-neighbour, no smoothing). Any other size gets snapped and loses detail.

## 3. Style rules (GBA Rhythm Tengoku)

- **True pixel art:** no anti-aliasing, no gradients, no soft shadows, no semi-transparent pixels. Transparent background (PNG alpha, fully on/off).
- **1-pixel black outline** (`#000000`) around the whole figure and between overlapping parts (arm over jacket, hair over face).
- **Palette: max 15 colours per character** + transparency (one GBA sprite palette). Flat colour blocks, at most one shade per material.
- **Faces are placed pixel by pixel:** eyes 1–2 px (on dark skin use a white + black pair so they read), mouth 2–3 px. Keep the face clear of hair — at least rows for eyes, cheeks and mouth.
- Readability first: silhouette and colour blocks should identify the character at 1× on a white page.

## 4. Character notes

**Diamond\*** — tied-up dreads (bundle on top, red tie), dark skin, oversized cream sherpa fleece with red zip and red cuffs, Gucci web stripe (green-red-green) with gold GG, white tee at the collar, baggy dark-blue jeans, black Vans with white sole. Piercings, all present and consistent: **3 descending down the centre of the forehead, 1 on each cheekbone, 1 on each dimple, 1 at each bottom corner of the mouth** (single silver/white pixels at 1×).

**Tezzus** — big curly dreads (mop on top, locks hanging at the sides), shield sunglasses, red leather scale-mail jacket (spiky shoulder scales), white tank, silver chain, ripped light-blue jeans, red high-tops, hand tattoos (dark marks on the backs of the hands).

## 5. What happens after

- I rig the parts on the 34 original poses (dance ×9, bow ×6, fall ×2 per character), keeping the original frame counts — every beat lands where it did.
- Optional smooth mode: generated in-between poses inside the original holds (more drawings, same timing).
- You get a sprite sheet + an animated preview to approve before it goes in the game.

Reference: `guides/dancer-template/current-gba-chibi-frames_1x.png` is my current 1× attempt (chibi), sheet order = the 34 original cels.
