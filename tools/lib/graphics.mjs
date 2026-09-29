// Decomp graphics sources -> JSON.
//   *_pal.c            Palette name[] = { /* PALETTE 00 */ { TO_RGB555(0xRRGGBB), ... }, ... }
//   *_anim_cells.inc.c AnimationCel name[] = { /* Len */ N, a0, a1, a2, ... }   (GBA OAM attributes)
//   *_anim.c           struct Animation name[] = { { celName, duration }, ..., END_ANIMATION }

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// Returns { name: number[][] } — each palette is 16 colours as 0xRRGGBB, quantised to RGB555 like the GBA.
export function parsePalettes(src) {
  const out = {};
  for (const m of src.matchAll(/Palette\s+(\w+)\[\]\s*=\s*\{([\s\S]*?)\n\};/g)) {
    const pals = [];
    for (const block of m[2].matchAll(/\{([^{}]*)\}/g)) {
      const colors = [...block[1].matchAll(/TO_RGB555\((0x[0-9a-fA-F]+)\)/g)].map((c) => quantise(parseInt(c[1], 16)));
      if (colors.length) pals.push(colors);
    }
    out[m[1]] = pals;
  }
  return out;
}

function quantise(rgb) {
  const q = (v) => {
    const five = v >> 3;
    return (five << 3) | (five >> 2);
  };
  return (q((rgb >> 16) & 0xff) << 16) | (q((rgb >> 8) & 0xff) << 8) | q(rgb & 0xff);
}

// Returns { celName: [[attr0, attr1, attr2], ...] }
export function parseCels(src) {
  const out = {};
  const clean = stripComments(src);
  for (const m of clean.matchAll(/AnimationCel\s+(\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    const nums = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseInt(s, s.startsWith('0x') ? 16 : 10));
    const len = nums[0];
    const entries = [];
    for (let i = 0; i < len; i++) entries.push(nums.slice(1 + i * 3, 4 + i * 3));
    out[m[1]] = entries;
  }
  return out;
}

// Returns { animName: [[celName, frames], ...] }
export function parseAnims(src) {
  const out = {};
  const clean = stripComments(src);
  for (const m of clean.matchAll(/struct\s+Animation\s+(\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    const frames = [...m[2].matchAll(/\{\s*(\w+)\s*,\s*(\d+)\s*\}/g)].map((f) => [f[1], Number(f[2])]);
    out[m[1]] = frames;
  }
  return out;
}
