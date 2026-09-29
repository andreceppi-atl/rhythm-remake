// Decomp audio tables -> JSON sound pack.
//
// song header (s_xxx_seqData) -> { midi file, bank, volume }
// bank (inst_bank_NN[128])    -> instruments: pcm (sample + ADSR), psg (square/noise/wave), rhythm/split sub-banks
// sample_NNN_data             -> audio/samples/sample_NNN.wav + base pitch + loop points (sample_table.json)
import { fetchText, repoTree } from './decomp.mjs';

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');
}

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitchToMidi(p) {
  const m = p.match(/^([A-G])([#b]?)(-?\d+)$/);
  if (!m) throw new Error(`bad pitch ${p}`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + NOTE[m[1]] + acc;
}

let db = null;

// Loads every instrument definition in the decomp once (they cross-reference between bank files).
export function loadAudioDb() {
  if (db) return db;
  const headers = {};
  const hsrc = fetchText('audio/song_headers.inc.c');
  for (const m of hsrc.matchAll(/struct SongHeader (\w+)_seqData = \{([\s\S]*?)\};/g)) {
    const body = m[2];
    const midi = body.match(/MIDI Sequence \*\/\s*(\w+)_mid/)?.[1];
    const bank = body.match(/Bank Number\s*\*\/\s*(\w+)/)?.[1];
    const volume = Number(body.match(/Volume\s*\*\/\s*(\d+)/)?.[1] ?? 127);
    const priority = Number(body.match(/Priority\s*\*\/\s*(\d+)/)?.[1] ?? 0);
    const player = body.match(/Sound Player\s*\*\/\s*(\w+)/)?.[1];
    headers[m[1]] = { midi, bank, volume, priority, player };
  }

  // INST_BANK_xx enum index -> instrument_banks[] entry -> inst_bank_yy array name.
  const soundH = stripComments(fetchText('include/sound.h'));
  const enumBody = soundH.match(/enum\s+\w*\s*\{([^}]*INST_BANK_[^}]*)\}/)[1];
  const bankEnum = enumBody
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bankList = stripComments(fetchText('audio/instrument_bank_list.inc.c'))
    .match(/\{([\s\S]*)\}/)[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bankByEnum = {};
  bankEnum.forEach((name, i) => {
    if (bankList[i] && bankList[i] !== 'NULL') bankByEnum[name] = bankList[i];
  });

  const banks = {};
  const bsrc = stripComments(fetchText('audio/instrument_banks.inc.c'));
  for (const m of bsrc.matchAll(/union Instrument (\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    const entries = [];
    for (const e of m[2].matchAll(/NULL|\{\s*\.\w+\s*=\s*&(\w+)\s*\}/g)) entries.push(e[1] ?? null);
    banks[m[1]] = entries;
  }

  const keysplits = {};
  const ksrc = stripComments(fetchText('audio/keysplit_tables.inc.c'));
  for (const m of ksrc.matchAll(/u8 (\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    keysplits[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  }

  const psgWaves = {};
  const wsrc = stripComments(fetchText('audio/psg_wave_patterns.inc.c'));
  for (const m of wsrc.matchAll(/u32 (\w+)\[\]\s*=\s*\{([\s\S]*?)\};/g)) {
    psgWaves[m[1]] = m[2].split(',').map((s) => s.trim()).filter(Boolean).map((s) => Number(s) >>> 0);
  }

  const instruments = {};
  const files = repoTree().filter((p) => /^audio\/instruments\/.*\.inc\.c$/.test(p));
  for (const f of files) {
    const src = stripComments(fetchText(f));
    for (const m of src.matchAll(/struct Instrument(PCM|PSG|SubRhythm|SubSplit) (\w+) = \{([\s\S]*?)\};/g)) {
      const vals = m[3].split(',').map((s) => s.trim()).filter(Boolean);
      const num = (s) => Number(s);
      if (m[1] === 'PCM') {
        const [type, key, fastRead, pan, sample, init, sus, atk, dec, fade, rel] = vals;
        instruments[m[2]] = {
          kind: 'pcm',
          fixed: type === 'INSTRUMENT_PCM_FIXED',
          key: num(key),
          pan: num(pan),
          sample: sample.replace(/^&/, '').replace(/_data$/, ''),
          adsr: [init, sus, atk, dec, fade, rel].map(num),
        };
      } else if (m[1] === 'PSG') {
        const [type, key, pan, wave, init, sus, atk, dec, fade, rel, channel, len, sweep, duty, noise] = vals;
        instruments[m[2]] = {
          kind: 'psg',
          key: num(key),
          pan: num(pan),
          wave: wave === 'NULL' ? null : psgWaves[wave.replace(/^&/, '')] ?? null,
          adsr: [init, sus, atk, dec, fade, rel].map(num),
          channel,
          duty: num(duty) || 0,
          noise,
        };
      } else if (m[1] === 'SubRhythm') {
        instruments[m[2]] = { kind: 'rhythm', baseKey: num(vals[1]), bank: vals[2] };
      } else {
        instruments[m[2]] = { kind: 'split', baseKey: num(vals[1]), table: keysplits[vals[2]], bank: vals[3] };
      }
    }
  }

  const sampleTable = JSON.parse(fetchText('audio/sample_table.json')).samples;
  const samples = {};
  for (const s of sampleTable) {
    const id = s.sample.replace(/\.wav$/, '');
    samples[id] = { file: s.sample, pitch: pitchToMidi(s.pitch), loop: s.loop ?? null };
  }

  db = { headers, bankByEnum, banks, instruments, samples };
  return db;
}

// Build a self-contained sound pack for the given song names (without the s_ prefix / _seqData suffix).
export function buildSoundPack(songNames) {
  const { headers, bankByEnum, banks, instruments, samples } = loadAudioDb();
  const pack = { songs: {}, banks: {}, instruments: {}, samples: {} };
  const missing = [];

  const addInstrument = (name) => {
    if (!name || pack.instruments[name]) return;
    const inst = instruments[name];
    if (!inst) return missing.push(name);
    pack.instruments[name] = inst;
    if (inst.kind === 'pcm') pack.samples[inst.sample] = samples[inst.sample];
    if (inst.kind === 'rhythm' || inst.kind === 'split') addBank(inst.bank);
  };
  const addBank = (bank) => {
    if (pack.banks[bank]) return;
    pack.banks[bank] = banks[bank];
    if (!banks[bank]) return missing.push(bank);
    banks[bank].forEach(addInstrument);
  };

  for (const song of songNames) {
    const h = headers[`s_${song}`];
    if (!h) {
      missing.push(`s_${song}`);
      continue;
    }
    const bank = bankByEnum[h.bank];
    pack.songs[song] = { midi: h.midi, bank, volume: h.volume, priority: h.priority, player: h.player };
    if (bank) addBank(bank);
  }
  return { pack, missing };
}
