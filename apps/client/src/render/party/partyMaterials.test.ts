import { DEFAULT_LIGHTS, PRESETS, type Music, type PartyLights } from "@cg/shared";
import { describe, expect, it } from "vitest";
import { lookOf, paletteAt, partyTime, partyUniforms, stepParty, WRAP } from "./partyMaterials";

const lights = (over: Partial<PartyLights> = {}): PartyLights => ({ ...DEFAULT_LIGHTS, on: true, ...over });
const music = (playing: boolean): Music => ({ queue: [], current: { id: "t", videoId: "aaaaaaaaaaa", by: "a" }, playing, at: 0 });
const level = () => partyUniforms.uLevel.value;

/** Run the light for `seconds` at 60 frames a second, recording the brightness each frame. */
function run(l: PartyLights, seconds: number, from = 0, m?: Music) {
  const out: number[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    stepParty(l, m, (from + t) * 1000, 1 / 60);
    out.push(level());
  }
  return out;
}
const biggestStep = (xs: number[]) => Math.max(...xs.slice(1).map((x, i) => Math.abs(x - xs[i]!)));

describe("the party's shared light", () => {
  it("fades up when the lights go on and down when they go off, never jumping", () => {
    run(lights({ on: false }), 5);
    expect(level()).toBeLessThan(0.01);
    const up = run(lights({ on: true, brightness: 1 }), 3);
    expect(up.at(-1)!).toBeGreaterThan(0.95);
    expect(biggestStep(up)).toBeLessThan(0.06);
    const down = run(lights({ on: false }), 3);
    expect(down.at(-1)!).toBeLessThan(0.02);
    expect(biggestStep(down)).toBeLessThan(0.06);
  });

  it("follows the brightness setting", () => {
    expect(run(lights({ brightness: 0.2 }), 4).at(-1)!).toBeLessThan(run(lights({ brightness: 1 }), 4).at(-1)!);
    expect(run(lights({ brightness: 0.2 }), 4).at(-1)!).toBeGreaterThan(0.1);
  });

  it("dips and comes back for a new preset, instead of snapping", () => {
    run(lights({ preset: "neon" }), 4);
    const settled = level();
    const change = run(lights({ preset: "sunset" }), 4);
    expect(biggestStep(change)).toBeLessThan(0.06);
    expect(Math.min(...change)).toBeLessThan(settled);
    expect(Math.min(...change)).toBeGreaterThan(settled * 0.3);
    expect(change.at(-1)!).toBeCloseTo(settled, 1);
    expect(partyUniforms.uPeriod.value).toBe(PRESETS.find((p) => p.id === "sunset")!.period);
  });

  it("glides between colours rather than switching", () => {
    run(lights({ preset: "neon" }), 4);
    const before = paletteAt(0).clone();
    const steps: number[] = [];
    let last = before.clone();
    for (let t = 0; t < 3; t += 1 / 60) {
      stepParty(lights({ preset: "sunset" }), undefined, (10 + t) * 1000, 1 / 60);
      const now = paletteAt(0);
      steps.push(Math.abs(now.r - last.r) + Math.abs(now.g - last.g) + Math.abs(now.b - last.b));
      last = now.clone();
    }
    expect(Math.max(...steps)).toBeLessThan(0.12);
    expect(paletteAt(0).r).toBeGreaterThan(before.r);
  });

  it("never changes more slowly or faster than a gentle drift: no preset is quicker than six seconds a cycle", () => {
    for (const p of PRESETS) {
      run(lights({ preset: p.id }), 3);
      expect(partyUniforms.uPeriod.value).toBeGreaterThanOrEqual(6);
    }
    expect(lookOf(lights({ color: "#ff3d9a" })).palette).toEqual(["#ff3d9a", "#ff3d9a", "#ff3d9a"]);
  });

  it("holds the pattern still when steady", () => {
    run(lights({ steady: true }), 3);
    expect(partyUniforms.uSteady.value).toBe(1);
    run(lights({ steady: false }), 3);
    expect(partyUniforms.uSteady.value).toBe(0);
  });

  it("wraps the clock without a jump, for every period in use", () => {
    expect(partyTime(WRAP * 1000 * 3 + 1500)).toBeCloseTo(1.5);
    for (const p of PRESETS) expect(((WRAP / p.period) % 1)).toBe(0);
    // a colour position t/period is the same a whole wrap on
    for (const p of PRESETS) expect(((0 / p.period) % 1)).toBeCloseTo(((WRAP / p.period) % 1));
  });

  it("starts the speakers and records when the music plays, and eases them down when it stops", () => {
    run(lights(), 3, 0, music(false));
    expect(partyUniforms.uBeat.value).toBeLessThan(0.05);
    const spin = partyUniforms.uSpin.value;
    run(lights(), 3, 3, music(true));
    expect(partyUniforms.uBeat.value).toBeGreaterThan(0.9);
    expect(partyUniforms.uSpin.value).not.toBe(spin);
    run(lights(), 4, 6, music(false));
    expect(partyUniforms.uBeat.value).toBeLessThan(0.05);
  });
});
