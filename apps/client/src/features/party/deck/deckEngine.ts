import { BUILD_BEATS, channelOf, cueOf, DEFAULT_BPM, deckBeat, mixAt, sectionOf, type Deck, type DeckSide, type DeckTrackId } from "@cg/shared";
import { recordingOffset, RECORDING_URLS, STREAMED_RECORDINGS } from "./recordings";
import { StreamedRecording } from "./streamedRecording";
import { bassNote, chordVoicing, hitAt, LAYERS, leadNote, midiHz, TRACK_DEFS, type TrackDef } from "./tracks";

/**
 * The DJ deck's sound, made in Web Audio from the shared deck state. Notes are scheduled ahead by beat.
 * Recordings start at the offset given by the same clock and feed the same mixer.
 *
 *   deck A ─ EQ (low, mid, high) ─ gain A ─┬─ meter A
 *                                          ├──────────┐
 *                                          └─ echo send A ─┐
 *                                                     ├─ low-pass ─ high-pass ─┬──────────── out ─ compressor ─ speakers
 *   deck B ─ EQ ─ gain B ─ (the same) ────────────────┘                        └─ echo ───┘
 *
 * A deck's gain is the crossfader times its channel volume. Its EQ is its channel's, plus what a transition is doing
 * to it. Both are worked out again every tick, so a transition moves smoothly on every screen at once.
 */

/** How far ahead notes are scheduled (seconds). */
const LOOKAHEAD = 0.16;
const TICK_MS = 30;

/** Which sixteenths to schedule now: from `next` (the first not yet scheduled, never one already past) up to the horizon. */
export function stepsDue(next: number, nowBeat: number, horizonBeat: number): [from: number, to: number] {
  const from = Math.max(next, Math.ceil(nowBeat * 4 - 1e-6));
  const to = Math.ceil(horizonBeat * 4 - 1e-6);
  return [from, Math.max(from, to)];
}

/** Equal-power crossfade: how loud each deck is for a crossfader position. */
export const xfadeGains = (x: number): [number, number] => [Math.cos((x * Math.PI) / 2), Math.sin((x * Math.PI) / 2)];

/** An EQ knob (-1 to 1) in decibels: the left half cuts the band right down, the right half lifts it a little. */
export const eqDb = (v: number) => (v >= 0 ? v * 6 : v * 30);

/** Filter knob to cut-offs: left closes a low-pass down to 180 Hz, right opens a high-pass up to 2.4 kHz. */
export function filterCutoffs(k: number): { low: number; high: number } {
  return { low: k < 0 ? 20_000 * (180 / 20_000) ** -k : 20_000, high: k > 0 ? 20 * (2_400 / 20) ** k : 20 };
}

type RecordingStatus = "loading" | "error";
const PATTERNS: Readonly<Partial<Record<DeckTrackId, TrackDef>>> = TRACK_DEFS;

interface DeckBus {
  input: GainNode;
  /** The EQ, low to high; a new input feeds `eq[0]`. */
  eq: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
  gain: GainNode;
  echoSend: GainNode;
  meter: AnalyserNode;
  recording?: AudioBufferSourceNode;
  stream?: StreamedRecording;
}

export class DeckEngine {
  private ctx: AudioContext | null = null;
  private buses: [DeckBus, DeckBus] | null = null;
  private recordings = new Map<DeckTrackId, AudioBuffer | RecordingStatus>();
  private recordingRequests = new AbortController();
  private low!: BiquadFilterNode;
  private high!: BiquadFilterNode;
  private echoWet!: GainNode;
  private delay!: DelayNode;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private meterData = new Float32Array(512);
  private timer = 0;
  private next = 0;
  private deck: Deck | null = null;
  private anchorKey = "";
  private output = { volume: 0.6, mix: 1 };
  /** Asks the server clock for the time (ms). */
  constructor(private now: () => number) {}

  /** Make the sound (call from a click: browsers only allow sound after one). Reports whether it can play. */
  start(): boolean {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
      } catch {
        return false;
      }
      this.build(this.ctx);
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    }
    void this.ctx.resume().catch(() => {});
    for (const bus of this.buses ?? []) {
      if (bus.stream?.blocked) bus.stream.play();
    }
    this.apply();
    return true;
  }

  /** Whether the browser is letting it make sound. */
  get running() {
    return this.ctx?.state === "running" && !this.buses?.some((bus) => bus.stream?.blocked);
  }

  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
    const c = this.ctx;
    for (const bus of this.buses ?? []) bus.stream?.stop();
    this.ctx = null;
    this.buses = null;
    this.recordingRequests.abort();
    this.recordingRequests = new AbortController();
    this.recordings.clear();
    if (c) {
      this.out.gain.setTargetAtTime(0, c.currentTime, 0.05);
      window.setTimeout(() => void c.close().catch(() => {}), 300);
    }
  }

  /** The shared deck changed. */
  follow(deck: Deck | undefined) {
    const was = this.deck;
    this.deck = deck ?? null;
    const key = deck ? `${deck.playing}|${deck.t}|${deck.beat}|${deck.bpm}` : "";
    if (key !== this.anchorKey) {
      this.anchorKey = key;
      if (!was?.playing) this.next = 0;
    }
    if (was?.playing && this.buses) {
      for (const [index, side] of (["a", "b"] as const).entries()) {
        const bus = this.buses[index]!;
        if (!deck?.playing || deck[side] !== was[side]) this.cut(bus);
        else if (cueOf(deck, side) !== cueOf(was, side)) {
          if (bus.stream) bus.stream.requestSeek();
          else this.cut(bus);
        }
      }
    }
    this.apply();
  }

  recordingStatus(side: "a" | "b"): RecordingStatus | undefined {
    const id = this.deck?.[side];
    if (!id) return;
    if (STREAMED_RECORDINGS.has(id)) return this.buses?.[side === "a" ? 0 : 1].stream?.status;
    const state = this.recordings.get(id);
    return typeof state === "string" ? state : undefined;
  }

  /** This player's volume (0 to 1, after mute) and how near the speakers they are (0 to 1). */
  setOutput(volume: number, mix: number) {
    this.output = { volume, mix };
    if (this.ctx) this.out.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.08);
  }

  /** How loud each deck is right now, 0 to 1, for the meters: jumps up with each hit and falls back gently. */
  levels(): [number, number] {
    if (!this.buses) return [0, 0];
    const now = performance.now();
    const fall = Math.exp(-(now - this.peakAt) / 260);
    this.peakAt = now;
    this.buses.forEach((b, i) => {
      b.meter.getFloatTimeDomainData(this.meterData);
      let sum = 0;
      for (const v of this.meterData) sum += v * v;
      const level = Math.min(1, Math.sqrt(sum / this.meterData.length) * 3.2);
      this.peaks[i] = Math.max(level, this.peaks[i]! * fall);
    });
    return [this.peaks[0]!, this.peaks[1]!];
  }
  private peaks = [0, 0];
  private peakAt = 0;

  private level() {
    return this.output.volume * this.output.mix * 0.9;
  }

  private build(c: AudioContext) {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    comp.connect(c.destination);
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(comp);
    this.low = c.createBiquadFilter();
    this.low.type = "lowpass";
    this.low.Q.value = 0.9;
    this.high = c.createBiquadFilter();
    this.high.type = "highpass";
    this.high.Q.value = 0.9;
    this.low.connect(this.high);
    this.high.connect(this.out);
    // echo: a dotted-eighth delay feeding back on itself
    this.delay = c.createDelay(2);
    const feedback = c.createGain();
    feedback.gain.value = 0.38;
    const tone = c.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    this.echoWet = c.createGain();
    this.echoWet.gain.value = 0;
    this.high.connect(this.echoWet);
    this.echoWet.connect(this.delay);
    this.delay.connect(tone);
    tone.connect(feedback);
    feedback.connect(this.delay);
    tone.connect(this.out);
    const bus = (): DeckBus => {
      const input = c.createGain();
      const band = (type: BiquadFilterType, frequency: number) => {
        const f = c.createBiquadFilter();
        f.type = type;
        f.frequency.value = frequency;
        f.gain.value = 0;
        return f;
      };
      const eq: DeckBus["eq"] = [band("lowshelf", 220), band("peaking", 1100), band("highshelf", 3800)];
      eq[1].Q.value = 0.8;
      const gain = c.createGain();
      const echoSend = c.createGain();
      echoSend.gain.value = 0;
      const meter = c.createAnalyser();
      meter.fftSize = 512;
      input.connect(eq[0]);
      eq[0].connect(eq[1]);
      eq[1].connect(eq[2]);
      eq[2].connect(gain);
      gain.connect(meter);
      gain.connect(this.low);
      gain.connect(echoSend);
      echoSend.connect(this.delay);
      return { input, eq, gain, echoSend, meter };
    };
    this.buses = [bus(), bus()];
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Set the mixer from the deck at `beat` (now, if not given): crossfader, channels, transition, filter, echo, volume. */
  private apply(beat?: number) {
    const c = this.ctx;
    const d = this.deck;
    if (!c || !this.buses) return;
    const at = c.currentTime;
    const now = d ? mixAt(d, beat ?? deckBeat(d, this.now())) : null;
    const gains = now ? xfadeGains(now.xfade) : [0, 0];
    (["a", "b"] as DeckSide[]).forEach((side, i) => {
      const bus = this.buses![i]!;
      const ch = d ? channelOf(d, side) : null;
      const fx = now?.fx[side];
      bus.gain.gain.setTargetAtTime(d?.[side] && ch ? gains[i]! * ch.vol : 0, at, 0.04);
      const bands = [(ch?.low ?? 0) + (fx?.low ?? 0), (ch?.mid ?? 0) + (fx?.mid ?? 0), (ch?.high ?? 0) + (fx?.high ?? 0)];
      bus.eq.forEach((f, j) => f.gain.setTargetAtTime(eqDb(Math.max(-1, Math.min(1, bands[j]!))), at, 0.05));
      bus.echoSend.gain.setTargetAtTime((fx?.echo ?? 0) * 0.55, at, 0.08);
    });
    const { low, high } = filterCutoffs(d?.filter ?? 0);
    this.low.frequency.setTargetAtTime(low, at, 0.05);
    this.high.frequency.setTargetAtTime(high, at, 0.05);
    const beatS = 60 / (d?.bpm ?? 124);
    this.delay.delayTime.setTargetAtTime(beatS * 0.75, at, 0.05);
    this.echoWet.gain.setTargetAtTime(d?.echo ? 0.34 : 0, at, 0.06);
    this.out.gain.setTargetAtTime(this.level(), at, 0.08);
  }

  /** Fade out the current record and any synth notes already scheduled for this deck. */
  private cut(bus: DeckBus) {
    const c = this.ctx;
    if (!c) return;
    const old = bus.input;
    old.gain.setTargetAtTime(0, c.currentTime, 0.02);
    bus.recording?.stop(c.currentTime + 0.1);
    bus.recording = undefined;
    bus.stream?.stop();
    bus.stream = undefined;
    window.setTimeout(() => old.disconnect(), 300);
    bus.input = c.createGain();
    bus.input.connect(bus.eq[0]);
  }

  private async loadRecording(c: AudioContext, id: DeckTrackId, url: string) {
    const signal = this.recordingRequests.signal;
    this.recordings.set(id, "loading");
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error("Could not load DJ recording");
      const data = await response.arrayBuffer();
      if (signal.aborted) return;
      const buffer = await c.decodeAudioData(data);
      if (!signal.aborted) this.recordings.set(id, buffer);
    } catch {
      if (!signal.aborted) this.recordings.set(id, "error");
    }
  }

  private syncRecording(c: AudioContext, bus: DeckBus, id: DeckTrackId, cue: number, beat: number, bpm: number) {
    const url = RECORDING_URLS[id];
    if (!url) return;
    if (STREAMED_RECORDINGS.has(id)) {
      bus.stream ??= new StreamedRecording(c, bus.input, url);
      bus.stream.sync(beat, cue, bpm);
      return;
    }

    const buffer = this.recordings.get(id);
    if (!buffer) {
      void this.loadRecording(c, id, url);
      return;
    }
    if (typeof buffer === "string") return;

    const rate = bpm / DEFAULT_BPM;
    if (bus.recording?.playbackRate.value === rate) return;
    if (bus.recording) this.cut(bus);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    const at = c.currentTime;
    bus.input.gain.setValueAtTime(0, at);
    bus.input.gain.linearRampToValueAtTime(1, at + 0.02);
    source.connect(bus.input);
    source.start(at, recordingOffset(beat, cue, buffer.duration));
    bus.recording = source;
  }

  private tick() {
    const c = this.ctx;
    const d = this.deck;
    if (!c || !d?.playing || !this.buses || c.state !== "running") return;
    const serverMs = this.now();
    // server time to audio time: measured each tick, so a clock correction is followed
    const offset = c.currentTime - serverMs / 1000;
    const beatNow = deckBeat(d, serverMs);
    if (d.a) this.syncRecording(c, this.buses[0], d.a, cueOf(d, "a"), beatNow, d.bpm);
    if (d.b) this.syncRecording(c, this.buses[1], d.b, cueOf(d, "b"), beatNow, d.bpm);
    // the crossfader and EQ move with a transition
    this.apply(beatNow);
    const horizon = beatNow + (LOOKAHEAD * d.bpm) / 60;
    const [from, to] = stepsDue(this.next, beatNow, horizon);
    // a deck that's silent now and over the next moment gets no notes (a transition may be bringing it in)
    const xNow = mixAt(d, beatNow).xfade;
    const xAhead = mixAt(d, horizon).xfade;
    const [ga] = xfadeGains(Math.min(xNow, xAhead));
    const [, gb] = xfadeGains(Math.max(xNow, xAhead));
    const patternA = d.a ? PATTERNS[d.a] : undefined;
    const patternB = d.b ? PATTERNS[d.b] : undefined;
    // a built-in record plays from its own place: the deck's sixteenths, less where the record was cued
    const cueA = Math.round(cueOf(d, "a") * 4);
    const cueB = Math.round(cueOf(d, "b") * 4);
    for (let s = from; s < to; s++) {
      const serverAt = d.t + ((s / 4 - d.beat) * 60_000) / d.bpm;
      const at = Math.max(c.currentTime, serverAt / 1000 + offset);
      if (ga > 0.01 && patternA) this.step(c, this.buses[0].input, patternA, d, s - cueA, s, at);
      if (gb > 0.01 && patternB) this.step(c, this.buses[1].input, patternB, d, s - cueB, s, at);
      this.fx(c, d, s, at);
    }
    this.next = to;
  }

  /** One sixteenth of one record: `s` is the record's own sixteenth, `deckS` the deck's (a drop follows the deck). */
  private step(c: AudioContext, out: AudioNode, def: TrackDef, d: Deck, s: number, deckS: number, at: number) {
    const beat = deckS / 4;
    const bar = Math.floor(s / 16);
    const pos = ((s % 16) + 16) % 16;
    const section = sectionOf(s / 4, beat, d.drop);
    const L = LAYERS[section];
    const sixteenth = 15 / d.bpm;
    const t = at + (pos % 2 ? def.swing * sixteenth : 0);
    const k = hitAt(def.kick, pos);
    if (k && L.kick) this.kick(c, out, t, k * L.kick, def.kickTone);
    // the build: a snare roll that gets faster, bar by bar, and a last-beat gap before the drop
    if (section === "build" && d.drop !== null) {
      const into = beat - d.drop;
      const every = into < 4 ? 4 : into < 6 ? 2 : 1;
      if (into < BUILD_BEATS - 0.5 && pos % every === 0) this.clap(c, out, t, 0.35 + (0.55 * into) / BUILD_BEATS);
    } else {
      const cl = hitAt(def.clap, pos);
      if (cl && L.clap) this.clap(c, out, t, cl * L.clap);
    }
    const h = hitAt(def.hat, pos);
    if (h && L.hat) this.hat(c, out, t, h * L.hat, false);
    const o = hitAt(def.open, pos);
    if (o && L.open) this.hat(c, out, t, o * L.open, true);
    const b = bassNote(def, bar, pos);
    if (b !== null && L.bass) this.bass(c, out, t, b, sixteenth * 1.8, def, L.bass);
    const l = leadNote(def, bar, pos);
    if (l !== null && L.lead) this.pluck(c, out, t, l, def, L.lead);
    if (pos === 0 && L.pad && def.pad) this.pad(c, out, t, chordVoicing(def, bar), sixteenth * 16, def.pad * L.pad);
  }

  /** Whole-mix effects, once per sixteenth: the build's riser and the drop's crash. */
  private fx(c: AudioContext, d: Deck, s: number, at: number) {
    if (d.drop === null || !this.buses) return;
    const out = this.buses[0].gain.gain.value >= this.buses[1].gain.gain.value ? this.buses[0].input : this.buses[1].input;
    const beatS = 60 / d.bpm;
    if (s === d.drop * 4) this.riser(c, out, at, BUILD_BEATS * beatS);
    if (s === (d.drop + BUILD_BEATS) * 4) this.crash(c, out, at);
  }

  private env(c: AudioContext, out: AudioNode, at: number, peak: number, attack: number, decay: number) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(out);
    return g;
  }

  private noiseSource(c: AudioContext, at: number, dur: number) {
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.start(at, Math.random() * 1.5);
    src.stop(at + dur);
    return src;
  }

  private kick(c: AudioContext, out: AudioNode, at: number, vel: number, tone: number) {
    const o = c.createOscillator();
    o.frequency.setValueAtTime(tone, at);
    o.frequency.exponentialRampToValueAtTime(44, at + 0.12);
    o.connect(this.env(c, out, at, 0.95 * vel, 0.003, 0.38));
    o.start(at);
    o.stop(at + 0.45);
  }

  private clap(c: AudioContext, out: AudioNode, at: number, vel: number) {
    const src = this.noiseSource(c, at, 0.25);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 0.9;
    src.connect(bp);
    bp.connect(this.env(c, out, at, 0.5 * vel, 0.002, 0.16));
  }

  private hat(c: AudioContext, out: AudioNode, at: number, vel: number, open: boolean) {
    const src = this.noiseSource(c, at, open ? 0.3 : 0.08);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = open ? 6500 : 8000;
    src.connect(hp);
    hp.connect(this.env(c, out, at, (open ? 0.14 : 0.1) * vel, 0.001, open ? 0.22 : 0.04));
  }

  private bass(c: AudioContext, out: AudioNode, at: number, midi: number, dur: number, def: TrackDef, vel: number) {
    const o = c.createOscillator();
    o.type = def.bassWave;
    o.frequency.value = midiHz(midi);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(def.bassCut * 3.2, at);
    lp.frequency.exponentialRampToValueAtTime(def.bassCut, at + dur * 0.7);
    o.connect(lp);
    lp.connect(this.env(c, out, at, 0.34 * vel, 0.005, dur));
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private pluck(c: AudioContext, out: AudioNode, at: number, midi: number, def: TrackDef, vel: number) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = def.leadWave === "sawtooth" && def.leadCut < 1200 ? 9 : 2;
    lp.frequency.setValueAtTime(def.leadCut * 3, at);
    lp.frequency.exponentialRampToValueAtTime(def.leadCut, at + def.leadDecay);
    lp.connect(this.env(c, out, at, 0.1 * vel, 0.004, def.leadDecay));
    for (const detune of [-6, 6]) {
      const o = c.createOscillator();
      o.type = def.leadWave;
      o.frequency.value = midiHz(midi);
      o.detune.value = detune;
      o.connect(lp);
      o.start(at);
      o.stop(at + def.leadDecay + 0.05);
    }
  }

  private pad(c: AudioContext, out: AudioNode, at: number, notes: number[], dur: number, vel: number) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1300;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.045 * vel, at + dur * 0.25);
    g.gain.setValueAtTime(0.045 * vel, at + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, at + dur * 1.02);
    lp.connect(g);
    g.connect(out);
    for (const n of notes)
      for (const detune of [-8, 8]) {
        const o = c.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = midiHz(n);
        o.detune.value = detune;
        o.connect(lp);
        o.start(at);
        o.stop(at + dur * 1.05);
      }
  }

  private riser(c: AudioContext, out: AudioNode, at: number, dur: number) {
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(at);
    src.stop(at + dur);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(350, at);
    bp.frequency.exponentialRampToValueAtTime(7000, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.22, at + dur * 0.97);
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
  }

  private crash(c: AudioContext, out: AudioNode, at: number) {
    const src = this.noiseSource(c, at, 1.8);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3500;
    src.connect(hp);
    hp.connect(this.env(c, out, at, 0.22, 0.002, 1.6));
    const o = c.createOscillator();
    o.frequency.setValueAtTime(90, at);
    o.frequency.exponentialRampToValueAtTime(30, at + 0.6);
    o.connect(this.env(c, out, at, 0.7, 0.004, 0.8));
    o.start(at);
    o.stop(at + 0.9);
  }
}

export type { DeckTrackId };
