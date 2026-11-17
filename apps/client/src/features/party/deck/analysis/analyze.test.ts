import { describe, expect, it } from "vitest";
import { energyAt, Listener } from "./analyze";

const RATE = 11025;

/** A made-up dance record: a kick on every beat (louder on the bar), hats between, a quiet intro and a breakdown. */
function record(bpm: number, seconds: number, first: number, opts: { breakdown?: [number, number]; change?: [at: number, bpm: number] } = {}) {
  const out = new Float32Array(Math.round(seconds * RATE));
  let t = first;
  let n = 0;
  while (t < seconds) {
    const quiet = opts.breakdown && t >= opts.breakdown[0] && t < opts.breakdown[1];
    const start = Math.round(t * RATE);
    const amp = (n % 4 === 0 ? 1 : 0.75) * (quiet ? 0.08 : 1);
    for (let i = 0; i < 0.18 * RATE && start + i < out.length; i++) {
      const tt = i / RATE;
      out[start + i]! += amp * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 14);
    }
    const hat = Math.round((t + 30 / bpm) * RATE);
    for (let i = 0; i < 0.03 * RATE && hat + i < out.length; i++) out[hat + i]! += 0.15 * (Math.random() * 2 - 1) * Math.exp(-i / (0.008 * RATE));
    t += 60 / (opts.change && t >= opts.change[0] ? opts.change[1] : bpm);
    n++;
  }
  return out;
}

function listen(samples: Float32Array, pieces = 1) {
  const l = new Listener(RATE, samples.length / RATE);
  const size = Math.ceil(samples.length / pieces);
  for (let i = 0; i < samples.length; i += size) l.push(samples.subarray(i, i + size), i / RATE);
  return l.finish();
}

describe("listening to a record", () => {
  it("finds the tempo, the beat and the downbeat of a steady record", () => {
    const a = listen(record(128, 60, 0.31), 3);
    expect(a.bpm).toBeGreaterThan(127.5);
    expect(a.bpm).toBeLessThan(128.5);
    const p = 60 / 128;
    const off = (x: number) => Math.min((x - 0.31 + 10 * p) % p, p - ((x - 0.31 + 10 * p) % p));
    expect(off(a.beat)).toBeLessThan(0.03);
    expect(Math.abs(((a.downbeat - 0.31) / p) % 4)).toBeLessThan(0.1);
    expect(a.reliable).toBe(true);
    expect(a.peaks.length).toBe(60 * 25 + 1);
  });

  it("reads other tempos without halving or doubling them", () => {
    for (const bpm of [100, 140, 174]) {
      const a = listen(record(bpm, 45, 0.1));
      expect(Math.abs(a.bpm - bpm)).toBeLessThan(1);
    }
  });

  it("finds the bar line from where the record changes, even with claps on two and four", () => {
    // even kicks, a clap (with some body) on beats two and four, and a bass line that comes in on bar 9
    const bpm = 126;
    const p = 60 / bpm;
    const first = 0.2;
    const out = new Float32Array(Math.round(40 * RATE));
    for (let n = 0; first + n * p < 40; n++) {
      const start = Math.round((first + n * p) * RATE);
      for (let i = 0; i < 0.18 * RATE && start + i < out.length; i++) {
        const tt = i / RATE;
        out[start + i]! += 0.8 * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 14);
        if (n % 4 === 1 || n % 4 === 3) out[start + i]! += 0.5 * Math.sin(2 * Math.PI * 180 * tt) * Math.exp(-tt * 20) + 0.2 * (Math.random() * 2 - 1) * Math.exp(-tt * 25);
        if (n >= 32) out[start + i]! += 0.3 * Math.sin(2 * Math.PI * 49 * tt);
      }
    }
    const a = listen(out);
    const beats = (a.downbeat - first) / p;
    expect(Math.abs(beats - Math.round(beats))).toBeLessThan(0.1);
    expect((((Math.round(beats) % 4) + 4) % 4) === 0).toBe(true);
  });

  it("hears the quiet part in the energy", () => {
    const a = listen(record(124, 60, 0, { breakdown: [30, 40] }));
    expect(energyAt(a, 35)).toBeLessThan(energyAt(a, 20) - 0.3);
  });

  it("doesn't trust a grid when the tempo changes partway (a live set)", () => {
    const a = listen(record(126, 120, 0, { change: [60, 150] }));
    expect(a.reliable).toBe(false);
  });

  it("doesn't trust silence", () => {
    const a = listen(new Float32Array(20 * RATE));
    expect(a.reliable).toBe(false);
  });
});
