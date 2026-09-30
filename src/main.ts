import './style.css';
import { loadGameData } from './gba/assets';
import { Runtime, type RuntimeUi } from './engine/runtime';
import type { ResultSummary } from './engine/results';
import { KarateMan, PrologueCard } from './games/karate-man';
import { KARATE_DEFAULTS, loadTuning } from './games/karate-man/tuning';
import { KARATE_TEXT_EN } from './games/karate-man/text-en';
import { adjustGrid, analyzeAudio, type Analysis } from './autochart/analyze';
import { generateChart, type Chart, type Difficulty } from './autochart/chart';
import { chartToLevel, CUSTOM_SCRIPT, CUSTOM_TEXT } from './autochart/level';
import { PowerCalligraphy } from './games/power-calligraphy';
import { loadPcTuning } from './games/power-calligraphy/tuning';
import { PC_TEXT_EN } from './games/power-calligraphy/text-en';
import { addYoungStonerLife, YSL_SCENE } from './games/power-calligraphy/ysl';
import { loadHandLook } from './games/power-calligraphy/hand-look';
import type { PcTuning } from './games/power-calligraphy/tuning';
import type { GameData } from './gba/assets';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('screen');
const ctx2d = canvas.getContext('2d')!;
const textbox = $('textbox');
const caption = $('caption');
const skip = $('skip');
const menu = $('menu');
const results = $('results');
const debugEl = $('debug');
const params = new URLSearchParams(location.search);

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

// Integer-scale the 240x160 stage to fit the window.
function layout() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / 240, innerHeight / 160)));
  stage.style.transform = `scale(${s}) translate(-50%, -50%)`;
}
addEventListener('resize', layout);
layout();

let lastScene = 'scene_karate_man';
let theme = KARATE_DEFAULTS.theme;

const ui: RuntimeUi = {
  textbox(text) {
    textbox.hidden = !text;
    textbox.textContent = text ?? '';
  },
  caption(text) {
    caption.hidden = !text;
    caption.textContent = text ?? '';
  },
  skipAvailable(on) {
    skip.hidden = !on;
  },
  finished(summary) {
    showResults(summary);
  },
};

const autoplayParam = params.get('autoplay');
const rt = new Runtime(ui, {
  manualClock: params.has('manual'),
  autoplay: autoplayParam === null ? null : Number(autoplayParam) || 0,
});
rt.translations = { ...KARATE_TEXT_EN, ...PC_TEXT_EN };
rt.inputOffsetMs = Number(store.get('rh.inputOffsetMs') ?? 0);

const autoplayBox = $<HTMLInputElement>('opt-autoplay');
const debugBox = $<HTMLInputElement>('opt-debug');
autoplayBox.checked = rt.autoplay !== null;
debugBox.checked = params.has('debug') || store.get('rh.debug') === '1';
debugEl.hidden = !debugBox.checked;
autoplayBox.onchange = () => (rt.autoplay = autoplayBox.checked ? 0 : null);
debugBox.onchange = () => {
  debugEl.hidden = !debugBox.checked;
  store.set('rh.debug', debugBox.checked ? '1' : '0');
};
const offsetLabel = $('offset-label');
const showOffset = () => (offsetLabel.textContent = rt.inputOffsetMs ? `(${rt.inputOffsetMs > 0 ? '+' : ''}${Math.round(rt.inputOffsetMs)} ms)` : '');
showOffset();

let playing = false;
let pinnedDebug = false; // selftest output stays on screen

// Each minigame has its own converted data; load on demand and swap it into the runtime.
const GAME_TITLES: Record<string, string> = { karate_man: 'Karate Man', power_calligraphy: 'Power Calligraphy' };
const gameCache = new Map<string, GameData>();
let currentGame = '';
let prologue: PrologueCard | null = null;
let pcTuning: PcTuning | null = null;
const gameOfScene = (scene: string) => (scene.startsWith('scene_power_calligraphy') || scene.startsWith('scene_pc_') ? 'power_calligraphy' : 'karate_man');

async function ensureGame(game: string) {
  if (currentGame === game) return;
  let data = gameCache.get(game);
  if (!data) {
    $('loading').hidden = false;
    $('loading').textContent = `Loading ${GAME_TITLES[game] ?? game}…`;
    data = await loadGameData(game, game === 'karate_man' ? params.get('skin') ?? undefined : undefined);
    if (game === 'power_calligraphy' && pcTuning) addYoungStonerLife(data, pcTuning);
    if (game === 'power_calligraphy') {
      try {
        const look = await loadHandLook(data, `${import.meta.env.BASE_URL}skins/diamond-star/calligraphy/hand.json`);
        (data.looks ??= {})['diamond-star'] = look;
      } catch (e) {
        console.warn('Diamond* hand look not loaded:', e);
      }
    }
    gameCache.set(game, data);
    $('loading').hidden = true;
  }
  await rt.load(data);
  currentGame = game;
  if (prologue) prologue.title = game === 'karate_man' ? theme.prologueTitle : GAME_TITLES[game];
}

async function play(scene: string) {
  await ensureGame(scene === CUSTOM_SCRIPT ? 'karate_man' : gameOfScene(scene));
  if (prologue && scene === YSL_SCENE) prologue.title = 'Young Stoner Life';
  else if (prologue && gameOfScene(scene) === 'power_calligraphy') prologue.title = GAME_TITLES.power_calligraphy;
  rt.look = scene === YSL_SCENE ? 'diamond-star' : null; // Young Stoner Life uses Diamond*'s hand
  lastScene = scene;
  menu.hidden = true;
  results.hidden = true;
  playing = true;
  await rt.startScene(scene);
}

function toMenu() {
  playing = false;
  $('import').hidden = true;
  rt.sound.stopAll();
  ui.textbox(null);
  ui.caption(null);
  ui.skipAvailable(false);
  results.hidden = true;
  menu.hidden = false;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
}

function showResults(s: ResultSummary) {
  playing = false;
  $('res-header').textContent = theme.resultsHeader || rt.gameplay.results.header;
  $('res-rank').textContent = theme.ranks[s.rank];
  const list = $('res-comments');
  list.replaceChildren();
  const comments = s.negative.length ? s.negative : s.positive;
  for (const c of comments) {
    const li = document.createElement('li');
    li.textContent = c;
    list.append(li);
  }
  const t = rt.gameplay.results.any;
  $('res-score').textContent = `score ${s.score}/1000 · ${t.hits} hit · ${t.barelies} barely · ${t.inputs - t.hits - t.barelies} miss · ${s.irrelevantInputs} stray`;
  results.hidden = false;
  $<HTMLButtonElement>('res-again').focus();
}

for (const b of menu.querySelectorAll<HTMLButtonElement>('button[data-scene]')) {
  b.onclick = () => void play(b.dataset.scene!);
}
$('res-again').onclick = () => void play(lastScene);
$('res-menu').onclick = toMenu;

// ---- input ----
const A_KEYS = new Set(['Space', 'KeyJ', 'KeyK', 'KeyZ', 'KeyX']);
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (playing && A_KEYS.has(e.code)) {
    e.preventDefault();
    rt.press(e.timeStamp);
  } else if (playing && e.code === 'Enter') {
    e.preventDefault();
    rt.skipTutorial();
  } else if (e.code === 'Escape') {
    toMenu();
  }
});
canvas.addEventListener('pointerdown', (e) => {
  if (playing) rt.press(e.timeStamp);
});

// ---- imported songs: analyze -> auto-chart -> play (src/autochart/) ----
const importPanel = $('import');
const impStatus = $('imp-status');
const impControls = $('imp-controls');
const dropHint = $('drop-hint');
let imported: { name: string; buffer: AudioBuffer; base: Analysis; grid: Analysis; chart: Chart; fromFile: boolean } | null = null;

const difficulty = () => (document.querySelector<HTMLInputElement>('input[name=diff]:checked')?.value ?? 'normal') as Difficulty;

function showImport() {
  if (!imported) return;
  const { grid, chart } = imported;
  $('imp-title').textContent = imported.name;
  $('imp-bpm').textContent = chart.bpm.toFixed(1);
  $('imp-offset').textContent = `${(chart.firstBeat * 1000).toFixed(0)}ms`;
  const mins = Math.floor(grid.duration / 60), secs = Math.round(grid.duration % 60).toString().padStart(2, '0');
  $('imp-summary').textContent =
    `${chart.cues.length} punches · ${mins}:${secs}` +
    (imported.fromFile ? ' · loaded chart file' : '') +
    (grid.confidence < 0.25 ? ' · beat detection unsure: check the BPM (autoplay helps)' : '');
  impStatus.textContent = imported.fromFile ? '' : `beat confidence ${(grid.confidence * 100).toFixed(0)}%`;
  impControls.hidden = false;
}

function regenerate() {
  if (!imported) return;
  imported.chart = generateChart(imported.grid, difficulty(), imported.name);
  imported.fromFile = false;
  showImport();
}

async function loadImported(buffer: AudioBuffer, name: string, chart?: Chart) {
  impStatus.textContent = 'Finding the beat…';
  const base = await analyzeAudio(buffer);
  let grid = base;
  if (chart) grid = adjustGrid(base, chart.bpm, chart.firstBeat);
  imported = { name, buffer, base, grid, chart: chart ?? generateChart(base, difficulty(), name), fromFile: !!chart };
  showImport();
}

// Built-in songs (public/songs/index.json): audio + a verified beat grid.
interface SongEntry {
  id: string;
  title: string;
  artist: string;
  audio: string;
  skin?: string;
  bpm: number;
  firstBeat: number;
}
let songs: SongEntry[] = [];

async function openSong(song: SongEntry) {
  if (song.skin && params.get('skin') !== song.skin) {
    // Songs can ask for their artist's skin; skins load at startup, so reload into it.
    location.search = `?skin=${encodeURIComponent(song.skin)}&song=${encodeURIComponent(song.id)}`;
    return;
  }
  menu.hidden = true;
  results.hidden = true;
  importPanel.hidden = false;
  impControls.hidden = true;
  $('imp-title').textContent = `${song.title} · ${song.artist}`;
  impStatus.textContent = 'Loading…';
  try {
    const actx = rt.sound.ctx ?? new OfflineAudioContext(2, 1, 44100);
    const buffer = await actx.decodeAudioData(await (await fetch(import.meta.env.BASE_URL + song.audio)).arrayBuffer());
    impStatus.textContent = 'Finding the beat…';
    const base = await analyzeAudio(buffer);
    const grid = adjustGrid(base, song.bpm, song.firstBeat);
    const name = `${song.title} · ${song.artist}`;
    imported = { name, buffer, base, grid, chart: generateChart(grid, difficulty(), name), fromFile: false };
    showImport();
    impStatus.textContent = 'built-in track';
  } catch (err) {
    impStatus.textContent = `Couldn't load ${song.title}: ${err instanceof Error ? err.message : err}`;
  }
}

async function loadSongList() {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}songs/index.json`, { cache: 'no-store' });
    if (!r.ok || !r.headers.get('content-type')?.includes('json')) return;
    songs = await r.json();
  } catch {
    return;
  }
  const list = $('song-list');
  list.replaceChildren(
    ...songs.map((s) => {
      const b = document.createElement('button');
      b.className = 'song';
      b.textContent = `♪ ${s.title} · ${s.artist}`;
      b.onclick = () => void openSong(s);
      return b;
    }),
  );
  list.hidden = songs.length === 0;
  const wanted = songs.find((s) => s.id === params.get('song'));
  if (wanted) void openSong(wanted);
}

async function importFiles(files: File[]) {
  if (playing) return;
  const audio = files.find((f) => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm)$/i.test(f.name));
  const json = files.find((f) => /\.json$/i.test(f.name));
  menu.hidden = true;
  results.hidden = true;
  importPanel.hidden = false;
  impControls.hidden = true;
  if (!audio) {
    $('imp-title').textContent = 'No audio file';
    impStatus.textContent = 'Drop an MP3, WAV or M4A (a saved chart .json can come along with it).';
    impControls.hidden = true;
    setTimeout(toMenu, 2500);
    return;
  }
  const name = audio.name.replace(/\.[^.]+$/, '');
  $('imp-title').textContent = name;
  impStatus.textContent = 'Decoding…';
  try {
    const actx = rt.sound.ctx ?? new OfflineAudioContext(2, 1, 44100);
    if (rt.sound.ctx?.state === 'suspended') await rt.sound.ctx.resume();
    const buffer = await actx.decodeAudioData(await audio.arrayBuffer());
    let chart: Chart | undefined;
    if (json) {
      const c = JSON.parse(await json.text());
      if (c?.version === 1 && Array.isArray(c.cues) && c.bpm > 0) chart = c;
    }
    await loadImported(buffer, name, chart);
  } catch (err) {
    impStatus.textContent = `Couldn't read that file: ${err instanceof Error ? err.message : err}`;
  }
}

$('import-song').onclick = () => $<HTMLInputElement>('import-file').click();
$<HTMLInputElement>('import-file').onchange = (e) => {
  const input = e.target as HTMLInputElement;
  void importFiles([...(input.files ?? [])]);
  input.value = '';
};
addEventListener('dragover', (e) => {
  if (playing) return;
  e.preventDefault();
  dropHint.hidden = false;
});
addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropHint.hidden = true;
});
addEventListener('drop', (e) => {
  e.preventDefault();
  dropHint.hidden = true;
  if (e.dataTransfer?.files.length) void importFiles([...e.dataTransfer.files]);
});
for (const b of importPanel.querySelectorAll<HTMLButtonElement>('[data-bpm]')) {
  b.onclick = () => {
    if (!imported) return;
    imported.grid = adjustGrid(imported.base, imported.chart.bpm * Number(b.dataset.bpm), imported.chart.firstBeat);
    regenerate();
  };
}
for (const b of importPanel.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
  b.onclick = () => {
    if (!imported) return;
    imported.grid = adjustGrid(imported.base, imported.chart.bpm, imported.chart.firstBeat + Number(b.dataset.nudge) / 1000);
    regenerate();
  };
}
for (const r of importPanel.querySelectorAll<HTMLInputElement>('input[name=diff]')) r.onchange = regenerate;
$('imp-back').onclick = () => {
  importPanel.hidden = true;
  toMenu();
};
$('imp-save').onclick = () => {
  if (!imported) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(imported.chart, null, 1)], { type: 'application/json' }));
  a.download = `${imported.name}.chart.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('imp-play').onclick = () => void playImported();

async function playImported() {
  if (!imported) return;
  await ensureGame('karate_man');
  const level = chartToLevel(imported.chart);
  Object.assign(rt.data.level.scripts, level.scripts);
  Object.assign(rt.data.level.structs, level.structs);
  Object.assign(rt.translations, CUSTOM_TEXT);
  rt.customAudio = imported.buffer;
  importPanel.hidden = true;
  await play(CUSTOM_SCRIPT);
}

// ---- latency calibration: tap along to 16 clicks, use the median offset ----
$('calibrate').onclick = async () => {
  const actx = rt.sound.ctx;
  if (!actx) return;
  await actx.resume();
  const panel = $('calib');
  const status = $('calib-status');
  menu.hidden = true;
  panel.hidden = false;
  const beat = 0.5;
  const start = actx.currentTime + 1;
  const clicks: number[] = [];
  for (let i = 0; i < 16; i++) {
    const t = start + i * beat;
    clicks.push(t);
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.value = i % 4 === 0 ? 1320 : 880;
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + 0.07);
  }
  const offsets: number[] = [];
  const onKey = (e: KeyboardEvent | PointerEvent) => {
    if (e instanceof KeyboardEvent && (e.repeat || !A_KEYS.has(e.code))) return;
    e.preventDefault();
    const heard = rt.perfToHeard(e.timeStamp);
    const nearest = clicks.reduce((a, b) => (Math.abs(b - heard) < Math.abs(a - heard) ? b : a));
    if (Math.abs(nearest - heard) < beat / 2 && nearest >= start + 4 * beat) offsets.push((heard - nearest) * 1000);
    status.textContent = `${offsets.length} taps`;
  };
  addEventListener('keydown', onKey);
  panel.addEventListener('pointerdown', onKey);
  status.textContent = 'Listen for 4 clicks, then tap along';
  await new Promise((r) => setTimeout(r, (1 + 16 * beat + 0.5) * 1000));
  removeEventListener('keydown', onKey);
  panel.removeEventListener('pointerdown', onKey);
  if (offsets.length >= 4) {
    offsets.sort((a, b) => a - b);
    rt.inputOffsetMs -= offsets[Math.floor(offsets.length / 2)];
    store.set('rh.inputOffsetMs', String(rt.inputOffsetMs));
  }
  showOffset();
  panel.hidden = true;
  menu.hidden = false;
};

// ---- main loop ----
function frame() {
  if (playing || rt.finished) {
    rt.tick();
    rt.render(ctx2d);
  }
  if (!debugEl.hidden && rt.sequencer && !pinnedDebug) {
    const beat = (rt.now - rt.t0) / (60 / rt.tempo);
    const recent = rt.gameplay.history.slice(-6).map((h) => {
      if (h.forgiven) return 'MISS   (forgiven: counts as barely)';
      const r = ['HIT', 'BARELY', 'MISS', '', 'stray'][h.result];
      return Number.isNaN(h.offset) ? r : `${r.padEnd(6)} ${h.offset >= 0 ? '+' : ''}${h.offset.toFixed(1)}f (${((h.offset / 60) * 1000).toFixed(0)}ms)`;
    });
    debugEl.textContent = [
      `frame ${rt.frame}  beat ${beat.toFixed(2)}  bpm ${rt.tempo}`,
      `cues ${rt.gameplay.cues.length}  audio lead ${(rt.lead * 1000).toFixed(0)}ms  out ${((rt.sound.ctx?.outputLatency ?? 0) * 1000).toFixed(0)}ms`,
      ...recent,
    ].join('\n');
  }
  requestAnimationFrame(frame);
}

// ---- boot ----
(async () => {
  const tuning = await loadTuning(params.get('skin') ?? undefined);
  theme = tuning.theme;
  rt.register(new KarateMan(tuning));
  pcTuning = await loadPcTuning();
  rt.register(new PowerCalligraphy(pcTuning));
  prologue = new PrologueCard(theme.prologueTitle);
  rt.register(prologue);
  menu.querySelector('h1')!.textContent = theme.title;
  menu.querySelector('.sub')!.textContent = theme.subtitle;
  document.title = theme.title;
  (window.__rh as Record<string, unknown>).tuning = tuning;
  await ensureGame('karate_man');
  const data = gameCache.get('karate_man')!;
  const skinStatus = $('skin-status');
  skinStatus.textContent = data.skinWarning ?? (data.skin ? `Playing as ${data.skin.name}` : '');
  skinStatus.hidden = !skinStatus.textContent;
  skinStatus.setAttribute('role', data.skinWarning ? 'alert' : 'status');
  $('loading').hidden = true;
  menu.querySelector<HTMLButtonElement>('button')?.focus();
  requestAnimationFrame(frame);
  void loadSongList();
  // Keep a failed request's fallback notice visible before the player starts.
  if (params.has('play') && !data.skinWarning) {
    const scene = params.get('play') || 'scene_karate_man_skipped_practice';
    if (rt.sound.ctx?.state === 'suspended') {
      // Browsers require a gesture to unlock sound. Keep a visible start prompt
      // instead of hiding the menu and awaiting resume() on a blank canvas.
      const prompt = $('loading');
      menu.hidden = true;
      prompt.hidden = false;
      prompt.textContent = `Press Space or tap to start ${data.skin?.name ?? 'Karate Man'}`;
      prompt.setAttribute('role', 'button');
      prompt.tabIndex = 0;
      const finish = (start: boolean) => {
        removeEventListener('keydown', onKey);
        prompt.removeEventListener('pointerdown', onTap);
        prompt.hidden = true;
        prompt.removeAttribute('role');
        prompt.removeAttribute('tabindex');
        if (start) void play(scene);
        else toMenu();
      };
      const onTap = () => finish(true);
      const onKey = (event: KeyboardEvent) => {
        if (A_KEYS.has(event.code) || event.code === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.code === 'Escape') finish(false);
      };
      prompt.addEventListener('pointerdown', onTap);
      addEventListener('keydown', onKey);
      prompt.focus();
    } else void play(scene);
  }
})().catch((err) => {
  $('loading').textContent = `Failed to load: ${err.message}. Run: npm run convert karate_man`;
  console.error(err);
});

// Test hook: drive the game deterministically (see ADAPTING.md → Testing).
declare global {
  interface Window {
    __rh: unknown;
  }
}
window.__rh = {
  rt,
  play,
  toMenu,
  importBuffer: async (buffer: AudioBuffer, name = 'test') => {
    $('import').hidden = false;
    menu.hidden = true;
    await loadImported(buffer, name);
    return imported;
  },
  playImported,
  selftest: async () => (await import('./selftest')).selftest(rt, play),
};
if (params.has('selftest') && rt.manual) {
  void (async () => {
    while ($('loading').hidden === false) await new Promise((r) => setTimeout(r, 100));
    const checks = await (window.__rh as { selftest: () => Promise<{ name: string; pass: boolean; detail: string }[]> }).selftest();
    toMenu();
    pinnedDebug = true;
    debugEl.hidden = false;
    debugEl.textContent = checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.pass ? '' : `\n      ${c.detail}`}`).join('\n');
    console.log('selftest', checks);
  })();
}
