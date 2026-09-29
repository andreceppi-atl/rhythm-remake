// Beatscript (.bs) -> JSON.
//
// Expands the extension macros (include/beatscript.inc) and the game's own macros.inc down to
// the decomp's primitive commands (rest, run, run2, call, goto, loop_start, play_music, ...).
// Every level therefore becomes the same small op vocabulary the runtime interprets in
// src/engine/sequencer.ts, no matter which game it belongs to.

const BUILTIN_CONSTANTS = {
  TRUE: 1,
  FALSE: 0,
  NULL: 0,
  BLACK: 0,
  WHITE: 1,
};

// Parse `.macro name a, b=1` ... `.endm` blocks.
export function parseMacros(src, macros = {}) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^\.macro\s+(\w+)\s*(.*)$/);
    if (!m) continue;
    const params = m[2]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [name, def] = p.split('=').map((s) => s.trim());
        return { name, def };
      });
    const body = [];
    for (i++; i < lines.length && !lines[i].trim().startsWith('.endm'); i++) {
      const l = stripComment(lines[i]).trim();
      if (l) body.push(l);
    }
    macros[m[1]] = { params, body };
  }
  return macros;
}

// `.set NAME, VALUE` anywhere in the source.
export function parseSets(src, consts = {}) {
  for (const line of src.split('\n')) {
    const m = stripComment(line).trim().match(/^\.set\s+(\w+)\s*,\s*(.+)$/);
    if (m) {
      const v = evalExpr(m[2], consts);
      if (typeof v === 'number') consts[m[1]] = v;
    }
  }
  return consts;
}

// C enums from engine headers: `enum X { /* 00 */ A, B = 5, C };`
export function parseEnums(src, consts = {}) {
  for (const block of src.matchAll(/enum\s*\w*\s*\{([\s\S]*?)\}/g)) {
    let next = 0;
    const body = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const part of body.split(',')) {
      const t = part.trim();
      if (!t) continue;
      const [name, val] = t.split('=').map((s) => s.trim());
      if (val !== undefined) {
        const v = evalExpr(val, consts);
        if (typeof v === 'number') next = v;
      }
      consts[name] = next++;
    }
  }
  return consts;
}

function stripComment(l) {
  return l.replace(/\/\*.*?\*\//g, '').replace(/\s@.*$/, '').replace(/^@.*$/, '');
}

function splitArgs(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Evaluate an assembler expression. Returns a number when every identifier resolves,
// otherwise the original (trimmed) string — used for script labels, text and sound names.
export function evalExpr(expr, consts) {
  const e = String(expr).trim();
  if (e === '') return 0;
  let unresolved = false;
  const js = e.replace(/\b[A-Za-z_]\w*\b/g, (id) => {
    if (id in consts) return `(${consts[id]})`;
    if (id in BUILTIN_CONSTANTS) return `(${BUILTIN_CONSTANTS[id]})`;
    unresolved = true;
    return id;
  });
  if (unresolved) return e;
  if (!/^[\d\s()+\-*/%<>&|^~xXa-fA-F.]+$/.test(js)) return e;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${js});`)();
    return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : e;
  } catch {
    return e;
  }
}

// Expand one source line into primitive ops.
function expandLine(line, macros, consts, depth = 0) {
  if (depth > 32) throw new Error(`macro recursion: ${line}`);
  const m = line.match(/^(\w+)\s*(.*)$/);
  if (!m) return [];
  const [, name, rest] = m;
  const args = rest ? splitArgs(rest) : [];
  const macro = macros[name];
  if (!macro) return [[name, ...args]];
  const bound = {};
  macro.params.forEach((p, i) => {
    bound[p.name] = args[i] !== undefined && args[i] !== '' ? args[i] : p.def ?? '';
  });
  const out = [];
  for (const b of macro.body) {
    if (b.startsWith('.set') || b.startsWith('.include')) continue;
    const substituted = b.replace(/\\(\w+)/g, (_, p) => (p in bound ? bound[p] : ''));
    out.push(...expandLine(substituted, macros, consts, depth + 1));
  }
  return out;
}

// Parse a whole .bs file. Returns { scripts: {name: ops[]}, structs: {name: values[]}, scenes }.
export function parseBeatscript(src, macros, consts) {
  const scripts = {};
  const structs = {};
  const scenes = {};
  let cur = null;
  let curStruct = null;
  for (const raw of src.split('\n')) {
    const line = stripComment(raw).trim();
    if (!line || line.startsWith('.include') || line.startsWith('.section') || line === '.end') continue;
    let m;
    if ((m = line.match(/^script\s+(\w+)/))) {
      cur = scripts[m[1]] = [];
      curStruct = null;
      continue;
    }
    if ((m = line.match(/^struct\s+(\w+)/))) {
      curStruct = structs[m[1]] = [];
      cur = null;
      continue;
    }
    if (line === 'endstruct') {
      curStruct = null;
      continue;
    }
    if ((m = line.match(/^define_gameplay_scene\s+(\w+)\s*,\s*(\w+)/))) {
      scenes[m[1]] = m[2];
      cur = null;
      continue;
    }
    if (curStruct) {
      const d = line.match(/^\.(word|hword|byte)\s+(.+)$/);
      if (d) for (const a of splitArgs(d[2])) curStruct.push(evalExpr(a, consts));
      continue;
    }
    if (!cur) continue;
    // A game macro may define labels (.set) before use; honour them in order.
    for (const op of expandLine(line, macros, consts)) {
      const [name, ...args] = op;
      cur.push([name, ...args.map((a) => evalExpr(a, consts))]);
    }
  }
  return { scripts, structs, scenes };
}
