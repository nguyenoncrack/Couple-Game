/**
 * Listening to a record: its waveform, tempo, beat grid and energy, worked out from its samples.
 *
 * It takes the record in pieces (a long live set never has to sit in memory whole), each placed at its own time,
 * and keeps only small summaries: 25 waveform columns a second, a 100-a-second loudness track for finding beats,
 * and the loudness of every second. Mono at a low sample rate is plenty for all of it.
 *
 * Tempo comes from how the onsets (sudden rises in loudness, mostly kicks) repeat; the beat grid from where those
 * onsets land. A record whose tempo wanders (a live set) or has no steady beat is marked not `reliable`, and anything
 * built on its grid is called approximate.
 */

export const WAVE_RATE = 25;
const FRAME_RATE = 100;
const MIN_BPM = 70;
const MAX_BPM = 180;

export interface Analysis {
  /** The record's length (seconds). */
  duration: number;
  /** Waveform columns, `WAVE_RATE` a second: how loud (0 to 255), and how much of that is bass (0 to 255). */
  peaks: Uint8Array;
  lows: Uint8Array;
  /** Its tempo (beats a minute, at its own speed), where its first beat and first downbeat are (seconds). */
  bpm: number;
  beat: number;
  downbeat: number;
  /** How sure the tempo is (0 to 1), and whether the grid holds up across the record. */
  confidence: number;
  reliable: boolean;
  /** Loudness of every second, 0 to 255 (smoothed, relative to the record's own loud parts). */
  energy: Uint8Array;
}

/** A one-pole low-pass coefficient for a cut-off at `hz`. */
const onePole = (hz: number, rate: number) => 1 - Math.exp((-2 * Math.PI * hz) / rate);

/** Takes a record's samples piece by piece, then works out what it heard. */
export class Listener {
  private readonly rate: number;
  private readonly duration: number;
  private readonly peakAcc: Float32Array;
  private readonly lowAcc: Float32Array;
  private readonly lowCount: Uint32Array;
  private readonly fullE: Float32Array;
  private readonly lowE: Float32Array;
  private readonly heard: Uint8Array;

  constructor(rate: number, duration: number) {
    this.rate = rate;
    this.duration = duration;
    const cols = Math.ceil(duration * WAVE_RATE) + 1;
    const frames = Math.ceil(duration * FRAME_RATE) + 1;
    this.peakAcc = new Float32Array(cols);
    this.lowAcc = new Float32Array(cols);
    this.lowCount = new Uint32Array(cols);
    this.fullE = new Float32Array(frames);
    this.lowE = new Float32Array(frames);
    this.heard = new Uint8Array(frames);
  }

  /** Some mono samples, starting `at` seconds into the record. */
  push(samples: Float32Array, at: number) {
    const { rate } = this;
    const a = onePole(160, rate);
    let low = 0;
    const cols = this.peakAcc.length;
    const frames = this.fullE.length;
    const start = at * rate;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]!;
      low += a * (s - low);
      const t = (start + i) / rate;
      const c = Math.floor(t * WAVE_RATE);
      const f = Math.floor(t * FRAME_RATE);
      if (c < 0 || f < 0) continue;
      if (c >= cols || f >= frames) break;
      const abs = Math.abs(s);
      if (abs > this.peakAcc[c]!) this.peakAcc[c] = abs;
      this.lowAcc[c]! += low * low;
      this.lowCount[c]!++;
      this.fullE[f]! += s * s;
      this.lowE[f]! += low * low;
      this.heard[f] = 1;
    }
  }

  finish(): Analysis {
    const cols = this.peakAcc.length;
    // the waveform: loudness on a gentle curve (quiet parts still show), and the bass share of each column
    let top = 1e-6;
    for (const v of this.peakAcc) top = Math.max(top, v);
    const peaks = new Uint8Array(cols);
    const lows = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) {
      const p = this.peakAcc[c]! / top;
      peaks[c] = Math.round(Math.sqrt(p) * 255);
      const lowRms = this.lowCount[c] ? Math.sqrt(this.lowAcc[c]! / this.lowCount[c]!) : 0;
      lows[c] = Math.round(Math.min(1, (lowRms * 2.2) / Math.max(1e-6, this.peakAcc[c]!)) * 255);
    }
    const onset = onsetEnvelope(this.fullE, this.lowE, this.heard);
    const tempo = findTempo(onset);
    const period = (60 * FRAME_RATE) / tempo.bpm;
    const phase = findPhase(onset, period, 0, onset.length);
    // a grid that holds up: section by section (about 20 seconds each), the beats fall where it says
    const steady = gridHolds(onset, period, phase);
    const downPhase = findDownbeat(this.fullE, this.lowE, period, phase);
    return {
      duration: this.duration,
      peaks,
      lows,
      bpm: Math.round(tempo.bpm * 100) / 100,
      beat: phase / FRAME_RATE,
      downbeat: downPhase / FRAME_RATE,
      confidence: tempo.confidence,
      reliable: tempo.confidence >= 0.35 && steady,
      energy: energyCurve(this.fullE, this.heard),
    };
  }
}

/** Sudden rises in loudness (log-compressed, so a quiet kick counts too), from the full band and the bass. */
function onsetEnvelope(full: Float32Array, low: Float32Array, heard: Uint8Array): Float32Array {
  const n = full.length;
  const out = new Float32Array(n);
  const lf = (v: number) => Math.log1p(v * 1000);
  for (let i = 1; i < n; i++) {
    if (!heard[i] || !heard[i - 1]) continue;
    out[i] = Math.max(0, lf(full[i]!) - lf(full[i - 1]!)) + Math.max(0, lf(low[i]!) - lf(low[i - 1]!));
  }
  // take away the slow swell, leaving the hits
  const w = 25;
  const smooth = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += out[i]!;
    if (i >= w) sum -= out[i - w]!;
    smooth[i] = sum / Math.min(i + 1, w);
  }
  for (let i = 0; i < n; i++) out[i] = Math.max(0, out[i]! - smooth[i]!);
  return out;
}

/** How hard onsets land on a grid of beats `period` frames apart starting at `phase`, per beat (between `from` and `to`). */
function gridFit(onset: Float32Array, period: number, phase: number, from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let t = phase + Math.ceil((from - phase) / period) * period; t < to - 2; t += period) {
    const i = Math.floor(t);
    const f = t - i;
    // a little either side, so a hit a frame off still counts
    sum += onset[i]! * (1 - f) + onset[i + 1]! * f + 0.5 * Math.max(onset[i - 1] ?? 0, onset[i + 2] ?? 0);
    n++;
  }
  return n ? sum / n : 0;
}

/** The best-fitting phase for a beat length (frames from the start, under one beat), and how well it fits. */
function bestPhase(onset: Float32Array, period: number, from: number, to: number): { phase: number; fit: number } {
  const steps = Math.max(16, Math.round(period * 2));
  let phase = 0;
  let fit = -1;
  for (let k = 0; k < steps; k++) {
    const p = (k / steps) * period;
    const v = gridFit(onset, period, p, from, to);
    if (v > fit) {
      fit = v;
      phase = p;
    }
  }
  return { phase, fit };
}

/** How likely a tempo is for dance music: most sits between 110 and 150. */
const tempoPrior = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / 128) / 0.5) ** 2);

/**
 * The tempo: the beat length the onsets repeat at, between 70 and 180 BPM. Likely lengths come from how the onsets
 * repeat; each (and its double and half) is then tuned to the beat grid that fits the onsets best, leaning toward the
 * tempos DJs play at. Confidence is how much harder the onsets land on that grid than anywhere.
 */
export function findTempo(onset: Float32Array): { bpm: number; confidence: number } {
  // a long record: its middle eight minutes say enough
  const span = Math.min(onset.length, 8 * 60 * FRAME_RATE);
  const from = Math.floor((onset.length - span) / 2);
  const x = onset.subarray(from, from + span);
  let mean = 0;
  for (const v of x) mean += v;
  mean /= Math.max(1, x.length);
  if (mean <= 1e-9) return { bpm: 120, confidence: 0 };
  const minLag = Math.floor((60 * FRAME_RATE) / MAX_BPM);
  const maxLag = Math.ceil((60 * FRAME_RATE) / MIN_BPM);
  const acf: number[] = [];
  for (let lag = 0; lag <= maxLag + 1; lag++) {
    let s = 0;
    if (lag >= minLag - 1) for (let i = 0; i + lag < x.length; i++) s += (x[i]! - mean) * (x[i + lag]! - mean);
    acf.push(s);
  }
  // the strongest few repeats are the candidates
  const peaks: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) if (acf[lag]! > 0 && acf[lag]! >= acf[lag - 1]! && acf[lag]! >= acf[lag + 1]!) peaks.push(lag);
  peaks.sort((a, b) => acf[b]! - acf[a]!);
  const candidates = new Set<number>();
  for (const lag of peaks.slice(0, 4)) {
    for (const k of [1, 2, 0.5]) {
      const bpm = (60 * FRAME_RATE * k) / lag;
      if (bpm >= MIN_BPM && bpm <= MAX_BPM) candidates.add(Math.round(bpm * 10) / 10);
    }
  }
  if (!candidates.size) return { bpm: 120, confidence: 0 };
  let best = { bpm: 120, fit: 0, score: -1 };
  for (const c of candidates) {
    // tune it to a hundredth of a BPM
    let local = { bpm: c, fit: 0 };
    for (let step = 1; step >= 0.01; step /= 10) {
      const around = local.bpm;
      for (let b = around - step * 5; b <= around + step * 5 + 1e-9; b += step) {
        const fit = bestPhase(x, (60 * FRAME_RATE) / b, 0, x.length).fit;
        if (fit > local.fit) local = { bpm: b, fit };
      }
    }
    const score = local.fit * tempoPrior(local.bpm);
    if (score > best.score) best = { ...local, score };
  }
  const ratio = best.fit / mean;
  return { bpm: best.bpm, confidence: Math.max(0, Math.min(1, (ratio - 1.5) / 4)) };
}

/** Where in a beat the onsets land most (frames from the start, under one beat), between frames `from` and `to`. */
const findPhase = (onset: Float32Array, period: number, from: number, to: number) => bestPhase(onset, period, from, to).phase;

/** Whether most stretches of the record (those with a beat in them) have their beats where one grid says. */
function gridHolds(onset: Float32Array, period: number, phase: number): boolean {
  const seg = 20 * FRAME_RATE;
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= Math.max(1, onset.length);
  let counted = 0;
  let agree = 0;
  for (let from = 0; from + seg / 2 < onset.length; from += seg) {
    const to = Math.min(onset.length, from + seg);
    const local = bestPhase(onset, period, from, to);
    // (a quiet stretch with no beat to speak of says nothing)
    if (local.fit < mean * 1.5) continue;
    counted++;
    const d = Math.abs(local.phase - phase) % period;
    if (Math.min(d, period - d) < 0.05 * FRAME_RATE) agree++;
  }
  return counted > 0 && agree / counted >= 0.75;
}

/**
 * Which beat of the bar comes first. Mostly from where the record changes: a new part (the drop, a breakdown) starts
 * on a bar line, so the loudness just before and just after the true bar lines differs most. When nothing changes
 * much, the beat with the most bass leans it (claps on two and four add a little bass too, so it only leans).
 */
function findDownbeat(fullE: Float32Array, lowE: Float32Array, period: number, phase: number): number {
  // (the loudness of the stretch, in dB: full band and bass)
  const mean = (from: number, to: number) => {
    let full = 0;
    let low = 0;
    let n = 0;
    for (let i = Math.max(0, Math.round(from)); i < Math.min(fullE.length, Math.round(to)); i++) {
      full += fullE[i]!;
      low += lowE[i]!;
      n++;
    }
    return n ? 10 * Math.log10(full / n + 1e-10) + 10 * Math.log10(low / n + 1e-10) : 0;
  };
  const change: number[] = [];
  const bass: number[] = [];
  for (let j = 0; j < 4; j++) {
    let c = 0;
    let b = 0;
    for (let t = phase + j * period; t < fullE.length - 4; t += period * 4) {
      // the two beats before against the two after
      if (t >= 2 * period && t + 2 * period < fullE.length) c += Math.abs(mean(t, t + 2 * period) - mean(t - 2 * period, t));
      const i = Math.round(t);
      b += lowE[i]! + lowE[i + 1]! + lowE[i + 2]!;
    }
    change.push(c);
    bass.push(b);
  }
  const top = (xs: number[]) => Math.max(1e-9, ...xs);
  const score = (j: number) => change[j]! / top(change) + 0.2 * (bass[j]! / top(bass));
  let best = 0;
  for (let j = 1; j < 4; j++) if (score(j) > score(best)) best = j;
  return phase + best * period;
}

/** Loudness each second, smoothed over a few seconds and scaled to the record's own loud parts. */
function energyCurve(full: Float32Array, heard: Uint8Array): Uint8Array {
  const secs = Math.ceil(full.length / FRAME_RATE);
  const raw = new Float32Array(secs);
  for (let s = 0; s < secs; s++) {
    let sum = 0;
    let n = 0;
    for (let f = s * FRAME_RATE; f < Math.min(full.length, (s + 1) * FRAME_RATE); f++) {
      if (!heard[f]) continue;
      sum += full[f]!;
      n++;
    }
    raw[s] = n ? 10 * Math.log10(sum / n + 1e-10) : -100;
  }
  const smooth = new Float32Array(secs);
  for (let s = 0; s < secs; s++) {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, s - 2); k <= Math.min(secs - 1, s + 2); k++) {
      sum += raw[k]!;
      n++;
    }
    smooth[s] = sum / n;
  }
  const sorted = [...smooth].filter((v) => v > -99).sort((a, b) => a - b);
  const hi = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  // scaled to the record's own range (its quiet parts to its loud ones, never under 9 dB, never over 30), so a
  // breakdown or an intro stands out however loud the whole record was made
  const lo = sorted[Math.floor(sorted.length * 0.05)] ?? hi - 30;
  const range = Math.min(30, Math.max(9, hi - lo));
  const out = new Uint8Array(secs);
  for (let s = 0; s < secs; s++) out[s] = Math.round(Math.max(0, Math.min(1, (smooth[s]! - (hi - range)) / range)) * 255);
  return out;
}

/** Where the beats fall in a window of a record (seconds), from its grid. */
export function beatsIn(a: Pick<Analysis, "bpm" | "beat">, from: number, to: number): number[] {
  const p = 60 / a.bpm;
  const out: number[] = [];
  for (let t = a.beat + Math.ceil((from - a.beat) / p) * p; t <= to; t += p) out.push(t);
  return out;
}

/** The record's energy (0 to 1) at a time. */
export const energyAt = (a: Pick<Analysis, "energy">, t: number) => (a.energy[Math.max(0, Math.min(a.energy.length - 1, Math.floor(t)))] ?? 0) / 255;
