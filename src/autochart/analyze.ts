// Beat analysis for imported songs (runs in the browser, no dependencies).
//
//   mono + downsample (~11 kHz) -> STFT (512 / hop 64, ~5.8 ms) -> log-spectral flux (onset strength)
//   tempo: autocorrelation of the onset envelope with a log-normal prior around 120 BPM
//   grid:  joint fine search of BPM (±0.6%) and phase that best lines beats up with onsets
//   bars:  downbeat = the beat phase (mod 4) with the most low-frequency (kick) onset energy
// Assumes a steady tempo, which fits almost all produced music.

export interface Analysis {
  duration: number; // seconds
  bpm: number;
  period: number; // seconds per beat
  firstBeat: number; // time of beat 0 (seconds, >= 0)
  beatCount: number;
  downbeat: number; // index of the first beat that starts a bar (0-3)
  barEnergy: number[]; // loudness per bar starting at `downbeat`, ~0..1
  beatStrength: number[]; // onset strength on each beat, normalised
  offStrength: number[]; // onset strength halfway to the next beat
  confidence: number; // 0..1, how clearly the grid matches the onsets
}

const N = 512;
const HOP = 64;
// Correction from STFT frame time to the audible attack, measured on synthetic drums (see selftest):
// the flux jump lands when the attack is in the later part of the window: 13.5 ms after the frame centre (kick + bass test tracks at 94-150 BPM land within ±5 ms).
const ONSET_BIAS_S = -0.0135;

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

function interp(a: Float32Array, x: number) {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= a.length) return 0;
  const f = x - i;
  return a[i] * (1 - f) + a[i + 1] * f;
}

export async function analyzeAudio(buf: AudioBuffer): Promise<Analysis> {
  // Mono + boxcar downsample.
  const factor = Math.max(1, Math.round(buf.sampleRate / 11025));
  const sr = buf.sampleRate / factor;
  const len = Math.floor(buf.length / factor);
  const x = new Float32Array(len);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let k = 0; k < factor; k++) s += d[i * factor + k];
      x[i] += s / factor / buf.numberOfChannels;
    }
  }

  // Onset strength (log-spectral flux), full band and low band (< 150 Hz).
  const frames = Math.max(0, Math.floor((len - N) / HOP) + 1);
  const env = new Float32Array(frames);
  const low = new Float32Array(frames);
  const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const re = new Float64Array(N), im = new Float64Array(N);
  let prev = new Float64Array(N / 2), cur = new Float64Array(N / 2);
  const lowBins = Math.max(2, Math.round(150 / (sr / N)));
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < N; i++) {
      re[i] = x[f * HOP + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0, lflux = 0;
    for (let k = 1; k < N / 2; k++) {
      cur[k] = Math.log1p(100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      const d = cur[k] - prev[k];
      if (d > 0) {
        flux += d;
        if (k <= lowBins) lflux += d;
      }
    }
    env[f] = flux;
    low[f] = lflux;
    [prev, cur] = [cur, prev];
    if (f % 4000 === 0) await yieldToUi();
  }
  const fps = sr / HOP;

  // Remove the local mean (0.5 s) and normalise.
  const normalise = (a: Float32Array) => {
    const w = Math.round(fps * 0.25);
    const out = new Float32Array(a.length);
    let sum = 0;
    for (let i = 0; i < Math.min(a.length, w); i++) sum += a[i];
    for (let i = 0; i < a.length; i++) {
      if (i + w < a.length) sum += a[i + w];
      if (i - w - 1 >= 0) sum -= a[i - w - 1];
      const n = Math.min(a.length, i + w + 1) - Math.max(0, i - w);
      out[i] = Math.max(0, a[i] - sum / n);
    }
    let sq = 0;
    for (const v of out) sq += v * v;
    const sd = Math.sqrt(sq / Math.max(1, out.length)) || 1;
    for (let i = 0; i < out.length; i++) out[i] /= sd;
    return out;
  };
  const e = normalise(env);
  const lo = normalise(low);

  // Coarse tempo from autocorrelation (60-200 BPM) with a prior around 120.
  const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 60);
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = minLag; lag < ac.length; lag++) {
    let s = 0;
    for (let i = 0; i + lag < e.length; i++) s += e[i] * e[i + lag];
    ac[lag] = s / Math.max(1, e.length - lag);
  }
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (fps * 60) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
    const score = prior * (ac[lag] + 0.5 * (ac[lag * 2] ?? 0));
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  const [a0, a1, a2] = [ac[bestLag - 1], ac[bestLag], ac[bestLag + 1]];
  const shift = a0 - 2 * a1 + a2 !== 0 ? (0.5 * (a0 - a2)) / (a0 - 2 * a1 + a2) : 0;
  let bpm = (fps * 60) / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
  while (bpm < 80) bpm *= 2;
  while (bpm > 170) bpm /= 2;

  await yieldToUi();
  // Fine joint search of BPM and phase.
  let best = { bpm, phase: 0, score: -Infinity };
  for (let r = -0.006; r <= 0.006 + 1e-9; r += 0.0002) {
    const b = bpm * (1 + r);
    const P = (fps * 60) / b;
    for (let ph = 0; ph < P; ph += 0.25) {
      let s = 0, n = 0;
      for (let t = ph; t < e.length; t += P) {
        s += interp(e, t);
        n++;
      }
      s /= Math.max(1, n);
      if (s > best.score) best = { bpm: b, phase: ph, score: s };
    }
  }
  bpm = best.bpm;
  const P = (fps * 60) / bpm;
  const period = 60 / bpm;
  let firstBeat = (best.phase * HOP + N / 2) / sr - ONSET_BIAS_S;
  while (firstBeat - period >= 0) firstBeat -= period;
  if (firstBeat < 0) firstBeat += period;
  const duration = buf.duration;
  const beatCount = Math.max(0, Math.floor((duration - firstBeat) / period) + 1);

  // Confidence: grid score vs the average onset strength.
  let mean = 0;
  for (const v of e) mean += v;
  mean /= Math.max(1, e.length);
  const confidence = Math.max(0, Math.min(1, (best.score / Math.max(1e-6, mean) - 1) / 3));

  const frameOf = (t: number) => ((t + ONSET_BIAS_S) * sr - N / 2) / HOP;
  const beatStrength: number[] = [], offStrength: number[] = [];
  for (let k = 0; k < beatCount; k++) {
    const t = firstBeat + k * period;
    const peak = (arr: Float32Array, at: number) => Math.max(interp(arr, at - 1), interp(arr, at), interp(arr, at + 1));
    beatStrength.push(peak(e, frameOf(t)));
    offStrength.push(peak(e, frameOf(t + period / 2)));
  }

  // Downbeat: the beat phase (mod 4) with the most kick energy.
  let downbeat = 0, bestLow = -Infinity;
  for (let p = 0; p < 4; p++) {
    let s = 0;
    for (let k = p; k < beatCount; k += 4) s += interp(lo, frameOf(firstBeat + k * period));
    if (s > bestLow) {
      bestLow = s;
      downbeat = p;
    }
  }

  // Loudness per bar (RMS), normalised to the loud end of the song.
  const barEnergy: number[] = [];
  for (let k = downbeat; k + 4 <= beatCount + 1; k += 4) {
    const s0 = Math.floor((firstBeat + k * period) * sr), s1 = Math.min(len, Math.floor((firstBeat + (k + 4) * period) * sr));
    let sq = 0;
    for (let i = s0; i < s1; i++) sq += x[i] * x[i];
    barEnergy.push(Math.sqrt(sq / Math.max(1, s1 - s0)));
  }
  const sorted = [...barEnergy].sort((a, b) => a - b);
  const ref = sorted[Math.floor(sorted.length * 0.9)] || 1;
  for (let i = 0; i < barEnergy.length; i++) barEnergy[i] = Math.min(1.2, barEnergy[i] / ref);
  const sMax = [...beatStrength].sort((a, b) => a - b)[Math.floor(beatStrength.length * 0.9)] || 1;
  for (let i = 0; i < beatCount; i++) {
    beatStrength[i] = Math.min(1.5, beatStrength[i] / sMax);
    offStrength[i] = Math.min(1.5, offStrength[i] / sMax);
  }

  return { duration, bpm: +bpm.toFixed(3), period, firstBeat, beatCount, downbeat, barEnergy, beatStrength, offStrength, confidence };
}

// Re-derive the grid after the player changes BPM (×2, ÷2) or nudges the offset.
export function adjustGrid(a: Analysis, bpm: number, firstBeat: number): Analysis {
  const period = 60 / bpm;
  let fb = firstBeat;
  while (fb - period >= 0) fb -= period;
  while (fb < 0) fb += period;
  const beatCount = Math.max(0, Math.floor((a.duration - fb) / period) + 1);
  const scale = a.period / period;
  const resample = (arr: number[]) => Array.from({ length: beatCount }, (_, k) => arr[Math.min(arr.length - 1, Math.floor(k / scale))] ?? 0);
  return {
    ...a,
    bpm,
    period,
    firstBeat: fb,
    beatCount,
    downbeat: a.downbeat % 4,
    beatStrength: resample(a.beatStrength),
    offStrength: resample(a.offStrength),
    barEnergy: Array.from({ length: Math.ceil(beatCount / 4) }, (_, j) => a.barEnergy[Math.min(a.barEnergy.length - 1, Math.floor(j / scale))] ?? 0),
  };
}
